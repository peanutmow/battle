/**
 * P2PHost — Browser-based game host.
 *
 * Runs the authoritative game loop and relays turns to connected peers
 * via WebRTC DataChannels.
 *
 * Lifecycle:
 *   1. Create P2PHost with game config
 *   2. Call addPeerConnection(channel, clientID, username) for each connected peer
 *   3. Call start() then beginTurnLoop()
 *   4. Host sends intents via handleIntent()
 *   5. endTurn() collects intents and broadcasts turns to all peers
 */

import {
  type GameConfig,
  type StampedIntent,
  type Turn,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import type { P2PMessage, P2PPlayerInfo } from "./types";

export type P2PHostEvent =
  | { type: "peer_joined"; clientID: string; username: string }
  | { type: "peer_left"; clientID: string }
  | { type: "intent"; intent: StampedIntent }
  | { type: "start_game" };

export class P2PHost {
  private peers: Map<string, { username: string; channel: RTCDataChannel }> =
    new Map();
  private _intents: StampedIntent[] = [];
  private _turns: Turn[] = [];
  private _hasStarted = false;
  private _hasEnded = false;
  private turnInterval: ReturnType<typeof setInterval> | null = null;
  private turnNumber = 0;
  private turnCallbacks: Array<(turn: Turn) => void> = [];
  private eventCallbacks: Array<(event: P2PHostEvent) => void> = [];

  public readonly hostClientID: string;
  public readonly hostUsername: string;
  public readonly gameID: string;
  public players: P2PPlayerInfo[] = [];

  constructor(
    public readonly gameConfig: Partial<GameConfig>,
    hostUsername: string,
  ) {
    this.hostClientID = generateID();
    this.hostUsername = hostUsername;
    this.gameID = generateID();
  }

  onTurn(cb: (turn: Turn) => void): void {
    this.turnCallbacks.push(cb);
  }
  onEvent(cb: (event: P2PHostEvent) => void): void {
    this.eventCallbacks.push(cb);
  }
  private emitEvent(event: P2PHostEvent): void {
    for (const cb of this.eventCallbacks) cb(event);
  }

  /** Add a connected WebRTC peer */
  addPeerConnection(
    channel: RTCDataChannel,
    clientID: string,
    username: string,
  ): void {
    const peer = { username, channel };

    channel.onmessage = (event) => {
      try {
        const msg: P2PMessage = JSON.parse(event.data);
        if (msg.type === "p2p_intent") {
          this._intents.push({ ...msg.intent, clientID } as StampedIntent);
        } else if (msg.type === "p2p_join") {
          // Peer sent their real username — update it
          const newName = msg.username || username;
          peer.username = newName;
          const p = this.players.find((p) => p.clientID === clientID);
          if (p) p.username = newName;
          this.emitEvent({ type: "peer_joined", clientID, username: newName });
        }
      } catch {
        /* ignore */
      }
    };

    channel.onclose = () => {
      this.peers.delete(clientID);
      const p = this.players.find((p) => p.clientID === clientID);
      if (p) p.connected = false;
      this.emitEvent({ type: "peer_left", clientID });
    };

    this.peers.set(clientID, peer);
    this.players.push({ clientID, username, connected: true });
    this.sendToPeer(clientID, {
      type: "p2p_joined",
      clientID,
      players: [...this.players],
    });
    this.emitEvent({ type: "peer_joined", clientID, username });
  }

  private sendToPeer(clientID: string, msg: P2PMessage): void {
    const peer = this.peers.get(clientID);
    if (peer?.channel.readyState === "open")
      peer.channel.send(JSON.stringify(msg));
  }

  private broadcastToPeers(msg: P2PMessage): void {
    for (const [, peer] of this.peers) {
      if (peer.channel.readyState === "open")
        peer.channel.send(JSON.stringify(msg));
    }
  }

  handleIntent(intent: StampedIntent): void {
    this._intents.push(intent);
  }

  endTurn(): void {
    if (this._hasEnded) return;
    const turn: Turn = {
      turnNumber: this.turnNumber++,
      intents: [...this._intents],
    };
    this._intents = [];
    this._turns.push(turn);
    this.broadcastToPeers({ type: "p2p_turn", turn });
    for (const cb of this.turnCallbacks) cb(turn);
  }

  start(): void {
    if (this._hasStarted) return;
    this._hasStarted = true;
    this.players.unshift({
      clientID: this.hostClientID,
      username: this.hostUsername,
      connected: true,
    });
    this.broadcastToPeers({
      type: "p2p_start",
      gameStartInfo: {
        gameID: this.gameID,
        lobbyCreatedAt: Date.now(),
        config: this.gameConfig,
      },
      turns: [],
    });
    this.emitEvent({ type: "start_game" });
  }

  beginTurnLoop(intervalMs = 100): void {
    if (this.turnInterval) return;
    this.turnInterval = setInterval(() => this.endTurn(), intervalMs);
  }

  stop(): void {
    this._hasEnded = true;
    if (this.turnInterval) {
      clearInterval(this.turnInterval);
      this.turnInterval = null;
    }
    for (const [, peer] of this.peers) peer.channel.close();
    this.peers.clear();
  }

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
}
