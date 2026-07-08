import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/IOSAddToHomeScreenBanner";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { P2PHostModal } from "./P2PHostModal";
import { P2PJoinModal } from "./P2PJoinModal";
import { UsernameInput } from "./UsernameInput";
import { translateText } from "./Utils";

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private inputValid: boolean = true;

  createRenderRoot() {
    return this;
  }

  private validateUsername(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.canPlay() : true;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (usernameInput) {
      this.inputValid = usernameInput.canPlay();
    }
  }

  disconnectedCallback() {
    window.removeEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    super.disconnectedCallback();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  public stop() {}

  private openSinglePlayerModal = () => {
    if (!this.validateUsername()) return;
    (
      document.querySelector("single-player-modal") as SinglePlayerModal
    )?.open();
  };

  private openP2PHost = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("p2p-host-modal") as P2PHostModal)?.open();
  };

  private openP2PJoin = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("p2p-join-modal") as P2PJoinModal)?.open();
  };

  render() {
    const btn =
      "relative flex items-center justify-center w-full h-full rounded-lg transition-all duration-200 text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center";
    const disabledClass = this.inputValid
      ? ""
      : "opacity-50 cursor-not-allowed pointer-events-none";

    return html`
      <div class="flex flex-col gap-4 w-full max-w-md mx-auto px-4 pb-4">
        <ios-add-to-home-screen-banner></ios-add-to-home-screen-banner>

        <!-- Soloplayer -->
        <div class="h-16">
          <button
            @click=${this.openSinglePlayerModal}
            ?disabled=${!this.inputValid}
            class="${btn} ${disabledClass} bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 hover:scale-[1.02]"
          >
            ${translateText("main.solo")}
          </button>
        </div>

        <!-- P2P Host & Join side by side -->
        <div class="grid grid-cols-2 gap-4 h-16">
          <button
            @click=${this.openP2PHost}
            ?disabled=${!this.inputValid}
            class="${btn} ${disabledClass} bg-purple-700 hover:bg-purple-600 hover:scale-[1.02]"
          >
            HOST P2P
          </button>
          <button
            @click=${this.openP2PJoin}
            ?disabled=${!this.inputValid}
            class="${btn} ${disabledClass} bg-emerald-700 hover:bg-emerald-600 hover:scale-[1.02]"
          >
            JOIN P2P
          </button>
        </div>
      </div>
    `;
  }
}
