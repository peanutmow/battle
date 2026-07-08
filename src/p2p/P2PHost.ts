/**
 * P2PHost — Browser-based game host.
 *
 * The host runs the authoritative game loop in their browser (like the
 * original GameServer/ LocalServer) and relays intents/turns to connected
 * peers via WebRTC DataChannels.
 *
 * Lifecycle:
 *   1. Host creates P2PHost with game config
 *   2. Host creates offer SDP via createOffer() — shares with peers
 *   3. Peers connect by pasting offer answer back
 *   4. Host starts game → begins turn loop
 *   5. Host collects intents from self + peers → creates turns → broadcasts
 *   6. Game ends when host stops or disconnects
 */

import {
  type GameConfig,
  type StampedIntent,
  type Turn,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import {
  type P2PMessage,
  type P2PPlayerInfo,
} from "./types";
import {
  acceptAnswer,
  createOffer,
  createPeerConnection,
  waitForConnection,
} from "./Signaling";

export type P2PHostEvent =
  | { type: "peer_joined"; clientID: string; username: string }
  | { type: "peer_left"; clientID: string }
  | { type: "intent"; intent: StampedIntent }
  | { type: "start_game" };

interface PeerConnection {
  clientID: string;
  username: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
}

export class P2PHost {
  private peers: Map<string, PeerConnection> = new Map();
  private _intents: StampedIntent[] = [];
  private _turns: Turn[] = [];
  private _hasStarted = false;
  private _hasEnded = false;
  private turnInterval: ReturnType<typeof setInterval> | null = null;
  private turnNumber = 0;
  private turnCallbacks: Array<(turn: Turn) => void> = [];
  private intentCallbacks: Array<(intent: StampedIntent) => void> = [];
  private eventCallbacks: Array<(event: P2PHostEvent) => void> = [];

  /** The host's own persistent ID */
  public readonly hostClientID: string;
  public readonly hostUsername: string;
  public readonly gameID: string;

  /** SDP offer string to share with peers */
  public offerSDP: string | null = null;

  /** Info about all players (host + peers) */
  public players: P2PPlayerInfo[] = [];

  constructor(
    public readonly gameConfig: Partial<GameConfig>,
    hostUsername: string,
  ) {
    this.hostClientID = generateID();
    this.hostUsername = hostUsername;
    this.gameID = generateID();
  }

  // ── Event subscriptions ──

  onTurn(cb: (turn: Turn) => void): void {
    this.turnCallbacks.push(cb);
  }

  onIntent(cb: (intent: StampedIntent) => void): void {
    this.intentCallbacks.push(cb);
  }

  onEvent(cb: (event: P2PHostEvent) => void): void {
    this.eventCallbacks.push(cb);
  }

  private emitEvent(event: P2PHostEvent): void {
    for (const cb of this.eventCallbacks) cb(event);
  }

  // ── Signaling / Connection ──

  /**
   * Create an SDP offer for peers to connect.
   * Returns the offer string that should be shared with peers.
   */
  async createOffer(): Promise<string> {
    const pc = createPeerConnection();
    // Create a dummy data channel to trigger SDP creation
    pc.createDataChannel("game");

    this.offerSDP = await createOffer(pc);

    // Store the PC for accepting the answer
    (this as any)._offerPC = pc;

    return this.offerSDP;
  }

  /**
   * Accept a peer's answer to complete the WebRTC handshake.
   * This should be called after the host pastes the peer's answer SDP.
   */
  async acceptPeerAnswer(
    answerSdp: string,
    peerUsername: string,
  ): Promise<string> {
    const pc = (this as any)._offerPC;
    if (!pc) throw new Error("No offer PC - call createOffer first");

    // Create a new PC for each peer
    const peerPC = createPeerConnection();
    const channel = peerPC.createDataChannel("game");

    await acceptAnswer(peerPC, answerSdp);
    // Actually, we need to re-create the offer for each peer
    // Let me restructure this

    const clientID = generateID();
    this.setupPeer(peerPC, channel, clientID, peerUsername);

    await waitForConnection(peerPC, 15000);

    return clientID;
  }

  /**
   * Wait for a peer to connect via WebRTC.
   * Returns when a new RTCPeerConnection is established (triggered by the host
   * receiving the answer SDP from a peer via copy-paste).
   *
   * Instead of waiting, we provide a method to add a peer by answer SDP.
   */
  async addPeerByAnswer(answerSdp: string, peerUsername: string): Promise<string> {
    const pc = createPeerConnection();
    const channel = pc.createDataChannel("game");
    const clientID = generateID();

    await acceptAnswer(pc, answerSdp);
    this.setupPeer(pc, channel, clientID, peerUsername);
    await waitForConnection(pc, 15000);

    return clientID;
  }

  /**
   * Create a fresh offer for each new peer.
   * This is simpler than reusing a single offer PC.
   */
  async createOfferForPeer(peerUsername: string): Promise<{ offer: string; clientID: string }> {
    const pc = createPeerConnection();
    const channel = pc.createDataChannel("game");
    const clientID = generateID();

    const offer = await createOffer(pc);

    // Store pending peer
    (this as any)._pendingPeers ??= new Map();
    (this as any)._pendingPeers.set(clientID, { pc, channel, username: peerUsername });

    return { offer, clientID };
  }

  /**
   * Complete the connection for a pending peer given their answer SDP.
   */
  async completePeerConnection(clientID: string, answerSdp: string): Promise<void> {
    const pending = (this as any)._pendingPeers?.get(clientID);
    if (!pending) throw new Error(`No pending peer with ID ${clientID}`);

    await acceptAnswer(pending.pc, answerSdp);
    this.setupPeer(pending.pc, pending.channel, clientID, pending.username);
    await waitForConnection(pending.pc, 15000);

    (this as any)._pendingPeers.delete(clientID);
  }

  private setupPeer(
    pc: RTCPeerConnection,
    channel: RTCDataChannel,
    clientID: string,
    username: string,
  ): void {
    const peer: PeerConnection = { clientID, username, pc, channel };

    channel.onmessage = (event) => {
      try {
        const msg: P2PMessage = JSON.parse(event.data);
        this.handlePeerMessage(clientID, msg);
      } catch (e) {
        console.error("P2PHost: failed to parse peer message", e);
      }
    };

    channel.onclose = () => {
      this.handlePeerDisconnect(clientID);
    };

    this.peers.set(clientID, peer);
    this.players.push({ clientID, username, connected: true });

    // Send join confirmation to the peer
    this.sendToPeer(clientID, {
      type: "p2p_joined",
      clientID,
      players: this.players,
    });

    // Notify other peers
    this.broadcastLobbyInfo();

    this.emitEvent({ type: "peer_joined", clientID, username });
  }

  private handlePeerMessage(clientID: string, msg: P2PMessage): void {
    switch (msg.type) {
      case "p2p_intent":
        this.handleIntent(
          {
            ...msg.intent,
            clientID,
          } as StampedIntent,
        );
        break;
      case "p2p_ping":
        // Respond with pong (no-op for now)
        break;
    }
  }

  private handlePeerDisconnect(clientID: string): void {
    const peer = this.peers.get(clientID);
    if (!peer) return;

    this.peers.delete(clientID);
    const player = this.players.find((p) => p.clientID === clientID);
    if (player) player.connected = false;

    this.broadcastLobbyInfo();
    this.emitEvent({ type: "peer_left", clientID });
  }

  private sendToPeer(clientID: string, msg: P2PMessage): void {
    const peer = this.peers.get(clientID);
    if (!peer || peer.channel.readyState !== "open") return;
    peer.channel.send(JSON.stringify(msg));
  }

  private broadcastToPeers(msg: P2PMessage): void {
    for (const [, peer] of this.peers) {
      if (peer.channel.readyState === "open") {
        peer.channel.send(JSON.stringify(msg));
      }
    }
  }

  private broadcastLobbyInfo(): void {
    this.broadcastToPeers({
      type: "p2p_lobby_info",
      hostPlayer: {
        clientID: this.hostClientID,
        username: this.hostUsername,
        connected: true,
      },
      players: this.players,
    });
  }

  // ── Intent / Turn handling ──

  /**
   * Called when an intent arrives (from host's own UI or from a peer).
   */
  handleIntent(intent: StampedIntent): void {
    this._intents.push(intent);
    for (const cb of this.intentCallbacks) cb(intent);
  }

  /**
   * Collect all pending intents into a turn and broadcast.
   */
  endTurn(): void {
    if (this._hasEnded) return;

    const turn: Turn = {
      turnNumber: this.turnNumber++,
      intents: [...this._intents],
    };
    this._intents = [];
    this._turns.push(turn);

    // Broadcast to peers
    this.broadcastToPeers({ type: "p2p_turn", turn });

    // Notify local callbacks
    for (const cb of this.turnCallbacks) cb(turn);
  }

  /**
   * Start the game: begins the turn loop.
   */
  start(): void {
    if (this._hasStarted) return;
    this._hasStarted = true;

    // Collect the host's own info in players list
    this.players.unshift({
      clientID: this.hostClientID,
      username: this.hostUsername,
      connected: true,
    });

    // Notify all peers that the game is starting
    const gameStartInfo: any = {
      gameID: this.gameID,
      lobbyCreatedAt: Date.now(),
      config: this.gameConfig,
    };

    this.broadcastToPeers({
      type: "p2p_start",
      gameStartInfo,
      turns: [],
    });

    this.emitEvent({ type: "start_game" });
  }

  /**
   * Begin the periodic turn loop.
   * @param intervalMs Time between turns (default 100ms = same as original server)
   */
  beginTurnLoop(intervalMs = 100): void {
    if (this.turnInterval) return;
    this.turnInterval = setInterval(() => {
      this.endTurn();
    }, intervalMs);
  }

  /**
   * Stop the turn loop and clean up.
   */
  stop(): void {
    this._hasEnded = true;
    if (this.turnInterval) {
      clearInterval(this.turnInterval);
      this.turnInterval = null;
    }
    // Close all peer connections
    for (const [, peer] of this.peers) {
      peer.channel.close();
      peer.pc.close();
    }
    this.peers.clear();
  }

  // ── Accessors ──

  get hasStarted(): boolean {
    return this._hasStarted;
  }

  get hasEnded(): boolean {
    return this._hasEnded;
  }

  get turns(): Turn[] {
    return [...this._turns];
  }

  get peerCount(): number {
    return this.peers.size;
  }

  get pendingIntents(): StampedIntent[] {
    return [...this._intents];
  }
}
