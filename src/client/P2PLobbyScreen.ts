import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMode } from "../core/game/Game";
import type { ClientInfo } from "../core/Schemas";
import type { GameConfigSettingsData } from "./components/GameConfigSettings";
import { translateText } from "./Utils";

@customElement("p2p-lobby-screen")
export class P2PLobbyScreen extends LitElement {
  @property({ type: Boolean }) isHost = false;
  @property({ type: String }) roomCode = "";
  @property({ type: Object }) config: GameConfigSettingsData | null = null;
  @property({ type: String }) statusMsg = "";
  @property({ type: Boolean }) canStart = false;
  @property({ type: Object }) onStartGame?: () => void;
  @property({ type: Object }) onLeave?: () => void;
  @property({ type: Object }) onCopyInvite?: () => void;
  @property({ type: Array }) clients: ClientInfo[] = [];
  @property({ type: String }) lobbyCreatorClientID = "";
  @property({ type: String }) currentClientID = "";

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="flex flex-col gap-4">
        <!-- Room code banner -->
        <div
          class="bg-zinc-900/80 rounded-xl py-3 px-4 text-center border border-green-500/20"
        >
          <p class="text-xs text-white/50 mb-1">
            ${translateText("host_modal.share_code")}
          </p>
          <p
            class="text-2xl font-mono font-bold tracking-[0.2em] text-green-400 select-all"
          >
            ${this.roomCode}
          </p>
          ${this.isHost
            ? html`
                <button
                  @click=${() => this.onCopyInvite?.()}
                  class="mt-2 text-xs bg-green-700 hover:bg-green-600 px-3 py-1.5 rounded-lg font-semibold transition-colors"
                >
                  Copy Invite Link
                </button>
              `
            : ""}
        </div>

        <!-- Player list -->
        <lobby-player-view
          .gameMode=${GameMode.FFA}
          .clients=${this.clients}
          .lobbyCreatorClientID=${this.lobbyCreatorClientID}
          .currentClientID=${this.currentClientID}
        ></lobby-player-view>

        <!-- Game config settings (host only) -->
        ${this.isHost && this.config
          ? html`
              <game-config-settings
                .settings=${this.config}
              ></game-config-settings>
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
            @click=${() => this.onLeave?.()}
            class="flex-1 py-2.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 font-semibold text-sm text-white/80 transition-colors"
          >
            ${translateText("common.leave")}
          </button>
          ${this.isHost
            ? html`
                <button
                  @click=${() => this.onStartGame?.()}
                  ?disabled=${!this.canStart}
                  class="flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all ${this
                    .canStart
                    ? "bg-green-600 hover:bg-green-500 text-white cursor-pointer"
                    : "bg-zinc-700 text-white/30 cursor-not-allowed"}"
                >
                  ${translateText("host_modal.start")}
                </button>
              `
            : ""}
        </div>
      </div>
    `;
  }
}
