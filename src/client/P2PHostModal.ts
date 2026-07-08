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
import { p2pContext } from "./P2PContext";
import { UsernameInput } from "./UsernameInput";
import type { JoinLobbyEvent } from "./Main";

@customElement("p2p-host-modal")
export class P2PHostModal extends LitElement {
  @state() private isOpen = false;
  @state() private step: "config" | "waiting" | "connecting" | "playing" = "config";
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private offerSDP = "";
  @state() private answerInput = "";
  @state() private peerClientID: string | null = null;
  @state() private peerCount = 0;
  @state() private statusMsg = "";

  private host: P2PHost | null = null;

  createRenderRoot() {
    return this;
  }

  open() {
    this.step = "config";
    this.isOpen = true;
    this.selectedMap = GameMapType.World;
    this.offerSDP = "";
    this.peerCount = 0;
    this.statusMsg = "";
    this.host = null;
  }

  close() {
    this.isOpen = false;
    if (this.host) {
      this.host.stop();
      this.host = null;
    }
  }

  private async startHosting() {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const playerName = usernameInput?.getUsername() ?? "Host";

    this.statusMsg = "Creating game...";
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

    try {
      const result = await host.createOfferForPeer("peer");
      this.offerSDP = result.offer;
      this.peerClientID = result.clientID;
      this.host = host;
      this.step = "waiting";
      this.statusMsg = "Share the offer below, then paste the peer's answer";

      host.onEvent((event) => {
        if (event.type === "peer_joined") {
          this.peerCount = host.peerCount;
          this.statusMsg = `${host.peerCount} peer(s) connected — you can start the game`;
          this.requestUpdate();
        }
      });
    } catch (e) {
      this.statusMsg = `Error: ${e}`;
    }
  }

  private async startGame() {
    if (!this.host) return;

    this.statusMsg = "Starting game...";
    this.step = "playing";

    // Dispatch join-lobby event
    const gameID = this.host.gameID;
    const clientID = this.host.hostClientID;
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const playerName = usernameInput?.getUsername() ?? "Host";

    // Store host in global context before triggering join-lobby
    p2pContext.setHost(this.host);

    this.host.start();

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID,
          p2pMode: "host",
          gameStartInfo: {
            gameID,
            players: [
              {
                clientID,
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

    // Begin the turn loop after a short delay to let the client initialize
    setTimeout(() => {
      this.host?.beginTurnLoop(100);
    }, 1000);

    this.close();
  }

  private async connectPeer() {
    if (!this.host || !this.peerClientID || !this.answerInput.trim()) return;
    this.statusMsg = "Connecting peer...";
    try {
      await this.host.completePeerConnection(
        this.peerClientID,
        this.answerInput.trim(),
      );
      this.statusMsg = "Peer connected!";
      this.requestUpdate();
    } catch (e) {
      this.statusMsg = `Connection failed: ${e}`;
    }
  }

  private copyOffer() {
    navigator.clipboard.writeText(this.offerSDP).catch(() => {});
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
          class="bg-zinc-800 rounded-xl p-6 w-full max-w-md mx-4 text-white shadow-2xl"
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

          ${this.step === "config"
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
                    class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold text-sm transition-colors"
                  >
                    Start Hosting
                  </button>
                </div>
              `
            : html`
                <div class="space-y-3">
                  <p class="text-sm text-white/70">${this.statusMsg}</p>

                  ${this.offerSDP
                    ? html`
                        <div>
                          <p class="text-xs text-white/50 mb-1">
                            1. Share this offer with your friend:
                          </p>
                          <textarea
                            readonly
                            .value=${this.offerSDP}
                            rows="4"
                            class="w-full bg-zinc-900 rounded-lg px-3 py-2 text-xs font-mono text-green-400 resize-none"
                          ></textarea>
                          <button
                            @click=${this.copyOffer}
                            class="mt-1 text-xs text-blue-400 hover:text-blue-300"
                          >
                            Copy to clipboard
                          </button>
                        </div>
                        <div>
                          <p class="text-xs text-white/50 mb-1">
                            2. Paste your friend's answer here:
                          </p>
                          <textarea
                            .value=${this.answerInput}
                            @input=${(e: Event) => {
                              this.answerInput = (e.target as HTMLTextAreaElement).value;
                            }}
                            rows="4"
                            class="w-full bg-zinc-700 rounded-lg px-3 py-2 text-xs font-mono resize-none"
                            placeholder="Paste answer from friend..."
                          ></textarea>
                          <button
                            @click=${this.connectPeer}
                            ?disabled=${!this.answerInput.trim()}
                            class="mt-1 w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold text-xs transition-colors disabled:opacity-50"
                          >
                            Connect Peer
                          </button>
                        </div>
                      `
                    : html`<p class="text-sm">Generating connection offer...</p>`}

                  <p class="text-sm text-white/60">
                    Peers connected: ${this.peerCount}
                  </p>

                  <button
                    @click=${this.startGame}
                    ?disabled=${this.peerCount < 1}
                    class="w-full py-3 rounded-lg bg-green-600 hover:bg-green-500 font-semibold text-sm transition-colors disabled:opacity-50"
                  >
                    Start Game
                  </button>
                </div>
              `}
        </div>
      </div>
    `;
  }
}
