import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import type { P2PPlayerInfo } from "../p2p/types";
import { translateText } from "./Utils";

export interface P2PLobbyConfig {
  gameMap: GameMapType;
  gameMapSize: GameMapSize;
  gameType: GameType;
  gameMode: GameMode;
  difficulty: Difficulty;
  bots: number;
  nations: number | "default" | "disabled";
  infiniteGold: boolean;
  infiniteTroops: boolean;
  instantBuild: boolean;
  donateGold: boolean;
  donateTroops: boolean;
  randomSpawn: boolean;
}

@customElement("p2p-lobby-screen")
export class P2PLobbyScreen extends LitElement {
  @property({ type: Boolean }) isHost = false;
  @property({ type: String }) roomCode = "";
  @property({ type: Array }) players: P2PPlayerInfo[] = [];
  @property({ type: Object }) config: P2PLobbyConfig | null = null;
  @property({ type: String }) statusMsg = "";
  @property({ type: Boolean }) canStart = false;
  @property({ type: Object }) onStartGame?: () => void;
  @property({ type: Object }) onLeave?: () => void;
  @property({ type: Object }) onMapChange?: (map: GameMapType) => void;
  @property({ type: Boolean }) showMapSelector = false;
  @property({ type: String }) hostClientID = "";

  createRenderRoot() {
    return this;
  }

  private mapName(map: GameMapType): string {
    const names: Partial<Record<GameMapType, string>> = {
      [GameMapType.World]: "World",
      [GameMapType.EuropeClassic]: "Europe",
      [GameMapType.Asia]: "Asia",
      [GameMapType.Africa]: "Africa",
      [GameMapType.Australia]: "Australia",
      [GameMapType.Iceland]: "Iceland",
    };
    return names[map] ?? "Unknown";
  }

  render() {
    return html`
      <div class="flex flex-col gap-4">
        <!-- Room code banner -->
        <div
          class="bg-zinc-900/80 rounded-xl py-4 px-4 text-center border border-green-500/20"
        >
          <p class="text-xs text-white/50 mb-1">
            ${translateText("host_modal.share_code")}
          </p>
          <p
            class="text-3xl font-mono font-bold tracking-[0.2em] text-green-400 select-all"
          >
            ${this.roomCode}
          </p>
        </div>

        <!-- Player list -->
        <div>
          <div
            class="text-xs font-bold text-white/40 uppercase tracking-widest mb-2"
          >
            ${this.players.length}
            ${this.players.length === 1 ? "Player" : "Players"}
          </div>
          <div
            class="rounded-lg border border-white/10 bg-white/5 p-2 space-y-1"
          >
            ${this.players.map(
              (p) => html`
                <div
                  class="flex items-center gap-2 px-3 py-2 rounded-md text-sm ${p.connected
                    ? "bg-malibu-blue/20 border border-sky-500/40 text-white"
                    : "bg-zinc-700/50 text-white/40"}"
                >
                  <span
                    class="w-2 h-2 rounded-full shrink-0 ${p.connected
                      ? "bg-green-400"
                      : "bg-zinc-500"}"
                  ></span>
                  <span class="font-medium">${p.username}</span>
                  ${p.clientID === this.hostClientID
                    ? html`<span
                        class="text-[10px] font-bold uppercase tracking-wider text-amber-400 ml-auto"
                        >Host</span
                      >`
                    : ""}
                  ${!p.connected
                    ? html`<span class="text-xs text-white/40 ml-auto"
                        >Disconnected</span
                      >`
                    : ""}
                </div>
              `,
            )}
          </div>
        </div>

        <!-- Game settings -->
        ${this.config
          ? html`
              <div>
                <div
                  class="text-xs font-bold text-white/40 uppercase tracking-widest mb-2"
                >
                  Game Settings
                </div>
                <div
                  class="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2 text-sm"
                >
                  ${this.isHost && this.showMapSelector
                    ? html`
                        <div class="flex items-center justify-between">
                          <span class="text-white/60">Map</span>
                          <select
                            .value=${String(this.config.gameMap)}
                            @change=${(e: Event) => {
                              const val = Number(
                                (e.target as HTMLSelectElement).value,
                              );
                              this.onMapChange?.(val as unknown as GameMapType);
                            }}
                            class="bg-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white w-36"
                          >
                            <option value=${GameMapType.World}>World</option>
                            <option value=${GameMapType.EuropeClassic}>
                              Europe
                            </option>
                            <option value=${GameMapType.Asia}>Asia</option>
                            <option value=${GameMapType.Africa}>Africa</option>
                            <option value=${GameMapType.Australia}>
                              Australia
                            </option>
                            <option value=${GameMapType.Iceland}>
                              Iceland
                            </option>
                          </select>
                        </div>
                      `
                    : html`
                        <div class="flex items-center justify-between">
                          <span class="text-white/60">Map</span>
                          <span class="text-white font-medium"
                            >${this.mapName(this.config.gameMap)}</span
                          >
                        </div>
                      `}
                  <div class="flex items-center justify-between">
                    <span class="text-white/60">Mode</span>
                    <span class="text-white font-medium">FFA</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-white/60">Difficulty</span>
                    <span class="text-white font-medium"
                      >${Difficulty[this.config.difficulty] ?? "Medium"}</span
                    >
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-white/60">Bots</span>
                    <span class="text-white font-medium"
                      >${this.config.bots}</span
                    >
                  </div>
                </div>
              </div>
            `
          : ""}

        <!-- Status message -->
        ${this.statusMsg
          ? html`
              <div
                class="text-center text-sm ${this.statusMsg.includes("Error")
                  ? "text-red-400"
                  : "text-yellow-400"}"
              >
                ${this.statusMsg}
              </div>
            `
          : ""}

        <!-- Action buttons -->
        <div class="flex gap-3">
          <button
            @click=${this.onLeave}
            class="flex-1 py-2.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 font-semibold text-sm text-white/80 transition-colors"
          >
            Leave
          </button>
          ${this.isHost
            ? html`
                <button
                  @click=${this.onStartGame}
                  ?disabled=${!this.canStart}
                  class="flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all ${this
                    .canStart
                    ? "bg-green-600 hover:bg-green-500 text-white cursor-pointer"
                    : "bg-zinc-700 text-white/30 cursor-not-allowed"}"
                >
                  Start Game
                </button>
              `
            : ""}
        </div>
      </div>
    `;
  }
}
