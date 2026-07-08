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
import type { JoinLobbyEvent } from "./Main";
import { p2pContext } from "./P2PContext";
import { UsernameInput } from "./UsernameInput";

const SIGNALING_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

@customElement("p2p-host-modal")
export class P2PHostModal extends LitElement {
  @state() private isOpen = false;
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private roomCode: string | null = null;
  @state() private peerConnected = false;
  @state() private statusMsg = "";

  private host: P2PHost | null = null;
  private sig: SignalingClient | null = null;

  createRenderRoot() {
    return this;
  }

  open() {
    this.isOpen = true;
    this.selectedMap = GameMapType.World;
    this.roomCode = null;
    this.peerConnected = false;
    this.statusMsg = "";
    this.host = null;
    this.sig = null;
  }

  close() {
    this.isOpen = false;
    this.host?.stop();
    this.sig?.close();
  }

  private async startHosting() {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const playerName = usernameInput?.getUsername() ?? "Host";

    this.statusMsg = "Creating room...";
    const host = new P2PHost(
      {
        gameMap: this.selectedMap,
        gameMapSize: GameMapSize.Normal,
        gameType: GameType.Singleplayer,
        gameMode: GameMode.FFA,
        difficulty: Difficulty.Medium,
        bots: 3,
        nations: "default",
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        donateGold: false,
        donateTroops: false,
      },
      playerName,
    );
    this.host = host;

    try {
      const sig = new SignalingClient(SIGNALING_URL);
      this.sig = sig;
      const code = await sig.createRoom();
      this.roomCode = code;
      this.statusMsg = "Waiting for someone to join...";

      // Set up WebRTC — host creates an offer, peer answers
      const pc = createPeerConnection();
      const dataChannel = pc.createDataChannel("game");

      // Wait for a peer to join the room
      await sig.waitForPeer();

      // Create the WebRTC offer and send it to the peer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sig.send({ type: "offer", sdp: offer.sdp ?? "" });

      sig.onMessage(async (msg) => {
        if (msg.type === "answer") {
          await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        }
        if (msg.type === "candidate" && pc.remoteDescription) {
          await pc.addIceCandidate(msg.candidate).catch(() => {});
        }
      });

      pc.onicecandidate = (e) => {
        if (e.candidate)
          sig.send({ type: "candidate", candidate: e.candidate.toJSON() });
      };

      dataChannel.onopen = () => {
        const clientID = crypto.randomUUID();
        host.addPeerConnection(dataChannel, clientID, "Peer");
        this.peerConnected = true;
        this.statusMsg = "Peer connected! You can start the game.";
        this.requestUpdate();
      };
    } catch (e) {
      this.statusMsg = `Error: ${e}`;
    }
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
              gameMap: this.selectedMap,
              gameMapSize: GameMapSize.Normal,
              gameType: GameType.Singleplayer,
              gameMode: GameMode.FFA,
              difficulty: Difficulty.Medium,
              bots: 3,
              nations: "default",
              infiniteGold: false,
              infiniteTroops: false,
              instantBuild: false,
              donateGold: false,
              donateTroops: false,
              randomSpawn: false,
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

  render() {
    if (!this.isOpen) return html``;

    return html`
      <div
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
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

          ${!this.roomCode
            ? html`
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
              `
            : html`
                <div class="space-y-4 text-center">
                  <p class="text-sm text-white/70">${this.statusMsg}</p>
                  <div class="bg-zinc-900 rounded-xl py-6 px-4">
                    <p class="text-xs text-white/50 mb-2">
                      Share this code with a friend:
                    </p>
                    <p
                      class="text-3xl font-mono font-bold tracking-widest text-green-400 select-all"
                    >
                      ${this.roomCode}
                    </p>
                  </div>
                  ${this.peerConnected
                    ? html`
                        <button
                          @click=${this.startGame}
                          class="w-full py-3 rounded-lg bg-green-600 hover:bg-green-500 font-semibold text-sm"
                        >
                          Start Game
                        </button>
                      `
                    : html`
                        <div
                          class="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto"
                        ></div>
                      `}
                </div>
              `}
        </div>
      </div>
    `;
  }
}
