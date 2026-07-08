import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { DoomsdayClockSpeed } from "../core/game/DoomsdayClock";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../core/game/Game";
import type { ClientInfo } from "../core/Schemas";
import { P2PHost } from "../p2p/P2PHost";
import { createPeerConnection } from "../p2p/Signaling";
import { SignalingClient } from "../p2p/SignalingClient";
import type { GameConfigSettingsData } from "./components/GameConfigSettings";
import type { JoinLobbyEvent } from "./Main";
import { p2pContext } from "./P2PContext";
import "./P2PLobbyScreen";
import { UsernameInput } from "./UsernameInput";

const SIGNALING_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

interface PeerConnection {
  peerId: string;
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  connected: boolean;
}

type HostPhase = "hidden" | "setup" | "connecting" | "lobby";

@customElement("p2p-host-modal")
export class P2PHostModal extends LitElement {
  @state() private phase: HostPhase = "hidden";
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private roomCode = "";
  @state() private statusMsg = "";
  @state() private peerConnected = false;
  @state() private peerCount = 0;

  // Game config state
  @state() private selectedDifficulty: Difficulty = Difficulty.Easy;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private bots: number = 400;
  @state() private nations: number = 0;
  @state() private randomSpawn: boolean = false;
  @state() private infiniteGold: boolean = false;
  @state() private donateGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private donateTroops: boolean = false;
  @state() private instantBuild: boolean = false;
  @state() private spawnImmunity: boolean = false;
  @state() private spawnImmunityDurationMinutes: number | undefined = undefined;
  @state() private goldMultiplier: boolean = false;
  @state() private goldMultiplierValue: number | undefined = undefined;
  @state() private startingGold: boolean = false;
  @state() private startingGoldValue: number | undefined = undefined;
  @state() private disableAlliances: boolean = false;
  @state() private doomsdayClock: boolean = false;
  @state() private doomsdayClockSpeed: DoomsdayClockSpeed = "normal";
  @state() private waterNukes: boolean = false;
  @state() private maxTimer: boolean = false;
  @state() private maxTimerValue: number | undefined = undefined;
  @state() private startDelayValue: number | undefined = 3;
  @state() private disabledUnits: UnitType[] = [];
  @state() private compactMap: boolean = false;

  @state() private clients: ClientInfo[] = [];

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
    this.selectedDifficulty = Difficulty.Easy;
    this.gameMode = GameMode.FFA;
    this.bots = 400;
    this.nations = 0;
    this.roomCode = "";
    this.statusMsg = "";
    this.peerConnected = false;
    this.peerCount = 0;
    this.host = null;
    this.sig = null;
    this.peerConnections.clear();
    this.pendingCandidates.clear();
    this.clients = [];
  }

  close() {
    this.phase = "hidden";
    this.host?.stop();
    this.sig?.close();
    for (const [, p] of this.peerConnections) p.pc.close();
    this.peerConnections.clear();
  }

  private updateClients() {
    if (!this.host) return;
    this.clients = [
      {
        clientID: this.host.hostClientID,
        username: this.host.hostUsername,
        clanTag: null,
      },
      ...this.host.players.map((p) => ({
        clientID: p.clientID,
        username: p.username,
        clanTag: null as string | null,
      })),
    ];
  }

  private buildConfigData(): GameConfigSettingsData {
    return {
      map: {
        selected: this.selectedMap,
        useRandom: false,
      },
      difficulty: {
        selected: this.selectedDifficulty,
        disabled: false,
      },
      gameMode: {
        selected: this.gameMode,
      },
      teamCount: {
        selected: 2,
      },
      options: {
        titleKey: "host_modal.options_title",
        bots: {
          value: this.bots,
          labelKey: "host_modal.bots",
          disabledKey: "host_modal.bots_global",
        },
        nations: {
          value: this.nations,
          defaultValue: this.bots,
          labelKey: "host_modal.nations",
          disabledKey: "host_modal.disabled",
          hidden: false,
        },
        toggles: [
          { labelKey: "host_modal.infinite_gold", checked: this.infiniteGold },
          { labelKey: "host_modal.donations_gold", checked: this.donateGold },
          {
            labelKey: "host_modal.infinite_troops",
            checked: this.infiniteTroops,
          },
          {
            labelKey: "host_modal.donations_troops",
            checked: this.donateTroops,
          },
          { labelKey: "host_modal.instant_build", checked: this.instantBuild },
          {
            labelKey: "host_modal.spawn_immunity",
            checked: this.spawnImmunity,
          },
          { labelKey: "host_modal.random_spawn", checked: this.randomSpawn },
          { labelKey: "host_modal.compact_map", checked: this.compactMap },
          {
            labelKey: "host_modal.disable_alliances",
            checked: this.disableAlliances,
          },
          {
            labelKey: "host_modal.doomsday_clock",
            checked: this.doomsdayClock,
            doomsdayClockSpeed: this.doomsdayClockSpeed,
          },
          { labelKey: "host_modal.water_nukes", checked: this.waterNukes },
        ],
        inputCards: [],
      },
      unitTypes: {
        titleKey: "host_modal.disabled_units",
        disabledUnits: this.disabledUnits,
      },
    };
  }

  private async startHosting() {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const playerName = usernameInput?.getUsername() ?? "Host";

    this.phase = "connecting";
    this.statusMsg = "Creating room...";

    const host = new P2PHost(
      {
        gameMap: this.selectedMap,
        gameMapSize: GameMapSize.Normal,
        gameType: GameType.Singleplayer,
        gameMode: this.gameMode,
        difficulty: this.selectedDifficulty,
        bots: this.bots,
        nations: "default",
        infiniteGold: this.infiniteGold,
        infiniteTroops: this.infiniteTroops,
        instantBuild: this.instantBuild,
        donateGold: this.donateGold,
        donateTroops: this.donateTroops,
        randomSpawn: this.randomSpawn,
      },
      playerName,
    );
    this.host = host;

    try {
      const sig = new SignalingClient(SIGNALING_URL);
      this.sig = sig;
      const code = await sig.createRoom();
      this.roomCode = code;
      this.statusMsg = "Waiting for players to join...";
      this.updateClients();

      sig.onMessage(async (msg: any) => {
        if (msg.type === "peer_joined" && msg.peerId) {
          await this.handleNewPeer(msg.peerId);
        }
        if (msg.type === "peer_left" && msg.peerId) {
          this.handlePeerLeft(msg.peerId);
        }
        if (msg.type === "answer" && msg.peerId) {
          const pc = this.peerConnections.get(msg.peerId)?.pc;
          if (pc && !pc.remoteDescription) {
            await pc
              .setRemoteDescription({ type: "answer", sdp: msg.sdp })
              .catch(() => {});
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
    if (this.peerConnections.has(peerId)) return;
    const host = this.host;
    if (!host) return;

    this.statusMsg = `Player joining...`;
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

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sig?.send({ type: "offer", sdp: offer.sdp ?? "", targetPeer: peerId });

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

      host.onEvent((evt) => {
        if (evt.type === "peer_joined" && evt.clientID === clientID) {
          this.updateClients();
          this.requestUpdate();
        }
      });

      this.peerCount++;
      this.peerConnected = true;
      this.updateClients();
      this.phase = "lobby";
      this.statusMsg = `${this.peerCount} player${this.peerCount > 1 ? "s" : ""} connected`;
      this.requestUpdate();
    };

    dataChannel.onclose = () => {
      entry.connected = false;
      this.updateClients();
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
    this.updateClients();
    if (this.peerCount === 0) this.peerConnected = false;
    this.requestUpdate();
  }

  private getInviteUrl(): string {
    return `${window.location.origin}${window.location.pathname}?p2p_join=${this.roomCode}`;
  }

  private async copyInviteLink() {
    const url = this.getInviteUrl();
    try {
      await navigator.clipboard.writeText(url);
      this.statusMsg = "Invite link copied!";
      setTimeout(() => {
        if (this.statusMsg === "Invite link copied!") {
          this.statusMsg = `${this.peerCount} player${this.peerCount > 1 ? "s" : ""} connected`;
        }
      }, 2000);
      this.requestUpdate();
    } catch {
      this.statusMsg = "Failed to copy link";
    }
  }

  private async startGame() {
    if (!this.host) return;

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
              gameMode: this.gameMode,
              difficulty: this.selectedDifficulty,
              bots: this.bots,
              nations: "default",
              infiniteGold: this.infiniteGold,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
              donateGold: this.donateGold,
              donateTroops: this.donateTroops,
              randomSpawn: this.randomSpawn,
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
    if (this.phase === "hidden") return html``;

    return html`
      <!-- Setup with full game config -->
      ${this.phase === "setup"
        ? html`
            <div
              class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
              @click=${(e: MouseEvent) => {
                if (e.target === e.currentTarget) this.close();
              }}
            >
              <div
                class="bg-zinc-800 rounded-xl p-6 w-full max-w-lg mx-4 text-white shadow-2xl max-h-[90vh] overflow-y-auto"
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
                <game-config-settings
                  .settings=${this.buildConfigData()}
                  @map-selected=${(e: CustomEvent) => {
                    this.selectedMap = e.detail.map;
                    this.requestUpdate();
                  }}
                  @difficulty-selected=${(e: CustomEvent) => {
                    this.selectedDifficulty = e.detail.difficulty;
                  }}
                  @game-mode-selected=${(e: CustomEvent) => {
                    this.gameMode = e.detail.mode;
                  }}
                  @bots-changed=${(e: CustomEvent) => {
                    this.bots = e.detail.value;
                  }}
                  @nations-changed=${(e: CustomEvent) => {
                    this.nations = e.detail.value;
                  }}
                  @option-toggle-changed=${(e: CustomEvent) => {
                    const d = e.detail;
                    if (d.key === "host_modal.infinite_gold")
                      this.infiniteGold = d.checked;
                    if (d.key === "host_modal.donations_gold")
                      this.donateGold = d.checked;
                    if (d.key === "host_modal.infinite_troops")
                      this.infiniteTroops = d.checked;
                    if (d.key === "host_modal.donations_troops")
                      this.donateTroops = d.checked;
                    if (d.key === "host_modal.instant_build")
                      this.instantBuild = d.checked;
                    if (d.key === "host_modal.spawn_immunity")
                      this.spawnImmunity = d.checked;
                    if (d.key === "host_modal.random_spawn")
                      this.randomSpawn = d.checked;
                    if (d.key === "host_modal.compact_map")
                      this.compactMap = d.checked;
                    if (d.key === "host_modal.disable_alliances")
                      this.disableAlliances = d.checked;
                    if (d.key === "host_modal.doomsday_clock")
                      this.doomsdayClock = d.checked;
                    if (d.key === "host_modal.water_nukes")
                      this.waterNukes = d.checked;
                  }}
                  @doomsday-clock-speed-selected=${(e: CustomEvent) => {
                    this.doomsdayClockSpeed = e.detail.speed;
                  }}
                  @unit-toggle-changed=${(e: CustomEvent) => {
                    const d = e.detail;
                    if (d.checked)
                      this.disabledUnits = [...this.disabledUnits, d.unit];
                    else
                      this.disabledUnits = this.disabledUnits.filter(
                        (u: UnitType) => u !== d.unit,
                      );
                  }}
                ></game-config-settings>
                <div class="mt-4">
                  <button
                    @click=${this.startHosting}
                    class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold text-sm"
                  >
                    Start Hosting
                  </button>
                </div>
              </div>
            </div>
          `
        : ""}

      <!-- Connecting -->
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
                      <button
                        @click=${this.copyInviteLink}
                        class="mt-3 w-full py-2 rounded-lg bg-green-700 hover:bg-green-600 font-semibold text-sm transition-colors"
                      >
                        Copy Invite Link
                      </button>
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
                  .config=${this.buildConfigData()}
                  .statusMsg=${this.statusMsg}
                  .canStart=${this.peerConnected}
                  .clients=${this.clients}
                  .lobbyCreatorClientID=${this.host.hostClientID}
                  .currentClientID=${this.host.hostClientID}
                  .onStartGame=${() => this.startGame()}
                  .onLeave=${() => this.close()}
                  .onCopyInvite=${() => this.copyInviteLink()}
                ></p2p-lobby-screen>
              </div>
            </div>
          `
        : ""}
    `;
  }
}
