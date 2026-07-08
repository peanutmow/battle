import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import { P2PHost } from "../p2p/P2PHost";
import { createPeerConnection } from "../p2p/Signaling";
import { SignalingClient } from "../p2p/SignalingClient";
import type { P2PPlayerInfo } from "../p2p/types";
import type { JoinLobbyEvent } from "./Main";
import { p2pContext } from "./P2PContext";
import "./P2PLobbyScreen";
import type { P2PLobbyConfig } from "./P2PLobbyScreen";
import { UsernameInput } from "./UsernameInput";

const SIGNALING_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

interface PeerConnection {
  peerId: string;
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  connected: boolean;
}

type HostPhase = "setup" | "connecting" | "lobby";

@customElement("p2p-host-modal")
export class P2PHostModal extends LitElement {
  @state() private phase: HostPhase = "setup";
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private roomCode = "";
  @state() private statusMsg = "";
  @state() private players: P2PPlayerInfo[] = [];
  @state() private peerConnected = false;
  @state() private peerCount = 0;

  private host: P2PHost | null = null;
  private sig: SignalingClient | null = null;
  private peerConnections: Map<string, PeerConnection> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();

  createRenderRoot() {
    return this;
  }

  open() {
    this.phase = "setup";
    this.selectedMap = GameMapType.World;
    this.roomCode = "";
    this.statusMsg = "";
    this.players = [];
    this.peerConnected = false;
    this.peerCount = 0;
    this.host = null;
    this.sig = null;
    this.peerConnections.clear();
    this.pendingCandidates.clear();
  }

  close() {
    this.phase = "setup";
    this.host?.stop();
    this.sig?.close();
    for (const [, p] of this.peerConnections) p.pc.close();
    this.peerConnections.clear();
  }

  private getLobbyConfig(): P2PLobbyConfig {
    return {
      gameMap: this.selectedMap,
      gameMapSize: GameMapSize.Normal,
      gameType: GameType.Singleplayer,
      gameMode: GameMode.FFA,
      difficulty: Difficulty.Medium,
      bots: 3,
      nations: "default" as const,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      donateGold: false,
      donateTroops: false,
      randomSpawn: false,
    };
  }

  private async startHosting() {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const playerName = usernameInput?.getUsername() ?? "Host";

    this.phase = "connecting";
    this.statusMsg = "Creating room...";

    const host = new P2PHost(this.getLobbyConfig(), playerName);
    this.host = host;

    try {
      const sig = new SignalingClient(SIGNALING_URL);
      this.sig = sig;
      const code = await sig.createRoom();
      this.roomCode = code;
      this.statusMsg = "Waiting for players to join...";
      this.players = [
        { clientID: host.hostClientID, username: playerName, connected: true },
      ];

      // Listen for new peers on the signaling WS
      sig.onMessage(async (msg: any) => {
        if (msg.type === "peer_joined" && msg.peerId) {
          await this.handleNewPeer(msg.peerId);
        }
        if (msg.type === "peer_left" && msg.peerId) {
          this.handlePeerLeft(msg.peerId);
        }
        // WebRTC answers/candidates from any peer are routed through sig
        if (msg.type === "answer" && msg.peerId) {
          const pc = this.peerConnections.get(msg.peerId)?.pc;
          if (pc?.remoteDescription) {
            // Already set local description, now set remote
          }
          if (pc && !pc.remoteDescription) {
            await pc
              .setRemoteDescription({
                type: "answer",
                sdp: msg.sdp,
              })
              .catch(() => {});
            // Flush pending candidates
            const cans = this.pendingCandidates.get(msg.peerId) ?? [];
            for (const c of cans) {
              await pc.addIceCandidate(c).catch(() => {});
            }
            this.pendingCandidates.delete(msg.peerId);
          }
        }
        if (msg.type === "candidate" && msg.peerId) {
          const pc = this.peerConnections.get(msg.peerId)?.pc;
          if (pc?.remoteDescription) {
            await pc.addIceCandidate(msg.candidate).catch(() => {});
          } else {
            // Queue until remote description is set
            const cans = this.pendingCandidates.get(msg.peerId) ?? [];
            cans.push(msg.candidate);
            this.pendingCandidates.set(msg.peerId, cans);
          }
        }
      });
    } catch (e) {
      this.statusMsg = `Error: ${e}`;
      this.phase = "setup";
    }
  }

  private async handleNewPeer(peerId: string) {
    if (this.peerConnections.has(peerId)) return; // already handling

    const host = this.host;
    if (!host) return;

    this.statusMsg = `Peer ${peerId} joining...`;

    const pc = createPeerConnection();
    const entry: PeerConnection = {
      peerId,
      pc,
      dataChannel: null,
      connected: false,
    };
    this.peerConnections.set(peerId, entry);

    const dataChannel = pc.createDataChannel("game");
    entry.dataChannel = dataChannel;

    // Send offer tagged with this peer's ID
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sig?.send({
      type: "offer",
      sdp: offer.sdp ?? "",
      targetPeer: peerId,
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sig?.send({
          type: "candidate",
          candidate: e.candidate.toJSON(),
          targetPeer: peerId,
        });
      }
    };

    dataChannel.onopen = () => {
      entry.connected = true;
      const clientID = crypto.randomUUID();
      host.addPeerConnection(
        dataChannel,
        clientID,
        `Player ${this.peerCount + 1}`,
      );

      this.peerCount++;
      this.peerConnected = true;
      this.players = [
        {
          clientID: host.hostClientID,
          username: host.hostUsername,
          connected: true,
        },
        ...host.players,
      ];
      this.phase = "lobby";
      this.statusMsg = `${this.peerCount} player${this.peerCount > 1 ? "s" : ""} connected`;
      this.requestUpdate();
    };

    dataChannel.onclose = () => {
      entry.connected = false;
      this.players = [
        {
          clientID: host.hostClientID,
          username: host.hostUsername,
          connected: true,
        },
        ...host.players,
      ];
      this.requestUpdate();
    };
  }

  private handlePeerLeft(peerId: string) {
    const entry = this.peerConnections.get(peerId);
    if (entry) {
      entry.pc.close();
      this.peerConnections.delete(peerId);
    }
    this.peerCount = this.peerConnections.size;
    this.players = [
      {
        clientID: this.host?.hostClientID ?? "",
        username: this.host?.hostUsername ?? "",
        connected: true,
      },
      ...(this.host?.players ?? []),
    ];
    if (this.peerCount === 0) this.peerConnected = false;
    this.requestUpdate();
  }

  private async startGame() {
    if (!this.host) return;
    this.statusMsg = "Starting game...";

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const playerName = usernameInput?.getUsername() ?? "Host";

    p2pContext.setHost(this.host);
    this.host.start();

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: this.host.gameID,
          p2pMode: "host",
          gameStartInfo: {
            gameID: this.host.gameID,
            players: [
              {
                clientID: this.host.hostClientID,
                username: playerName,
                clanTag: null,
              },
            ],
            config: {
              ...this.getLobbyConfig(),
              nations: this.getLobbyConfig().nations,
            },
            lobbyCreatedAt: Date.now(),
          },
          source: "p2p_host",
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );

    setTimeout(() => this.host?.beginTurnLoop(100), 1000);
    this.close();
  }

  private hasPlayers(): boolean {
    return this.peerConnections.size > 0 || this.peerConnected;
  }

  render() {
    return html`
      <div
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 ${this
          .phase === "setup"
          ? ""
          : "hidden"}"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div
          class="bg-zinc-800 rounded-xl p-6 w-full max-w-sm mx-4 text-white shadow-2xl"
        >
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-bold">Host P2P Game</h2>
            <button
              @click=${this.close}
              class="text-white/60 hover:text-white text-xl"
            >
              ✕
            </button>
          </div>
          <div class="space-y-3">
            <label class="block text-sm text-white/70">Map</label>
            <select
              .value=${this.selectedMap}
              @change=${(e: Event) => {
                this.selectedMap = Number(
                  (e.target as HTMLSelectElement).value,
                ) as unknown as GameMapType;
              }}
              class="w-full bg-zinc-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value=${GameMapType.World}>World</option>
              <option value=${GameMapType.EuropeClassic}>Europe</option>
              <option value=${GameMapType.Asia}>Asia</option>
              <option value=${GameMapType.Africa}>Africa</option>
              <option value=${GameMapType.Australia}>Australia</option>
              <option value=${GameMapType.Iceland}>Iceland</option>
            </select>
            <button
              @click=${this.startHosting}
              class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold text-sm"
            >
              Start Hosting
            </button>
          </div>
        </div>
      </div>

      <!-- Connecting overlay -->
      ${this.phase === "connecting"
        ? html`
            <div
              class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
            >
              <div
                class="bg-zinc-800 rounded-xl p-6 w-full max-w-sm mx-4 text-white shadow-2xl text-center"
              >
                <div
                  class="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"
                ></div>
                <p class="text-sm text-white/70">${this.statusMsg}</p>
                ${this.roomCode
                  ? html`
                      <div class="mt-4 bg-zinc-900 rounded-xl py-4 px-4">
                        <p class="text-xs text-white/50 mb-1">
                          Share this code with a friend:
                        </p>
                        <p
                          class="text-3xl font-mono font-bold tracking-[0.2em] text-green-400 select-all"
                        >
                          ${this.roomCode}
                        </p>
                      </div>
                    `
                  : ""}
                <button
                  @click=${this.close}
                  class="mt-4 text-sm text-white/40 hover:text-white/70"
                >
                  Cancel
                </button>
              </div>
            </div>
          `
        : ""}

      <!-- Lobby -->
      ${this.phase === "lobby" && this.host
        ? html`
            <div
              class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
            >
              <div
                class="bg-zinc-800 rounded-xl p-6 w-full max-w-lg mx-4 text-white shadow-2xl max-h-[90vh] overflow-y-auto"
              >
                <div class="flex justify-between items-center mb-4">
                  <h2 class="text-lg font-bold">Game Lobby</h2>
                  <button
                    @click=${this.close}
                    class="text-white/60 hover:text-white text-xl"
                  >
                    ✕
                  </button>
                </div>
                <p2p-lobby-screen
                  .isHost=${true}
                  .roomCode=${this.roomCode}
                  .players=${this.players}
                  .config=${this.getLobbyConfig()}
                  .statusMsg=${this.statusMsg}
                  .canStart=${this.hasPlayers()}
                  .showMapSelector=${true}
                  .hostClientID=${this.host?.hostClientID ?? ""}
                  .onStartGame=${() => this.startGame()}
                  .onLeave=${() => this.close()}
                  .onMapChange=${(map: GameMapType) => {
                    this.selectedMap = map;
                  }}
                ></p2p-lobby-screen>
              </div>
            </div>
          `
        : ""}
    `;
  }
}
