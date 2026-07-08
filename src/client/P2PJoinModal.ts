import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { P2PPeer } from "../p2p/P2PPeer";
import { p2pContext } from "./P2PContext";
import { UsernameInput } from "./UsernameInput";
import type { JoinLobbyEvent } from "./Main";

@customElement("p2p-join-modal")
export class P2PJoinModal extends LitElement {
  @state() private isOpen = false;
  @state() private offerInput = "";
  @state() private step: "input" | "connecting" | "connected" = "input";
  @state() private statusMsg = "";

  private peer: P2PPeer | null = null;
  private answerSDP: string | null = null;

  createRenderRoot() {
    return this;
  }

  open() {
    this.isOpen = true;
    this.step = "input";
    this.offerInput = "";
    this.statusMsg = "";
    this.peer = null;
    this.answerSDP = null;
  }

  close() {
    this.isOpen = false;
    if (this.peer) {
      this.peer.disconnect();
      this.peer = null;
    }
  }

  private async connect() {
    if (!this.offerInput.trim()) {
      this.statusMsg = "Please paste the host's offer first";
      return;
    }

    this.step = "connecting";
    this.statusMsg = "Connecting...";

    try {
      const peer = new P2PPeer();
      this.answerSDP = await peer.connect(this.offerInput.trim());
      this.peer = peer;
      this.step = "connected";
      this.statusMsg = "Connected! Wait for the host to start the game.";
      this.requestUpdate();

      // Listen for game start
      peer.onMessage((msg) => {
        if (msg.type === "p2p_start") {
          this.joinGame(peer);
        }
      });
    } catch (e) {
      this.statusMsg = `Connection failed: ${e}`;
      this.step = "input";
    }
  }

  private async joinGame(peer: P2PPeer) {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const playerName = usernameInput?.getUsername() ?? "Player";

    // Send join message to host
    // Store peer in global context before triggering join-lobby
    p2pContext.setPeer(peer);

    peer.send({
      type: "p2p_join",
      username: playerName,
      clientID: peer.clientID ?? "",
    });

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: "p2p-game",
          p2pMode: "peer",
          source: "p2p_peer",
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );

    this.close();
  }

  private copyAnswer() {
    if (this.answerSDP) {
      navigator.clipboard.writeText(this.answerSDP).catch(() => {});
    }
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
            <h2 class="text-lg font-bold">Join P2P Game</h2>
            <button
              @click=${this.close}
              class="text-white/60 hover:text-white text-xl"
            >
              ✕
            </button>
          </div>

          ${this.step === "input"
            ? html`
                <div class="space-y-3">
                  <p class="text-sm text-white/70">
                    Paste the host's connection offer:
                  </p>
                  <textarea
                    .value=${this.offerInput}
                    @input=${(e: Event) => {
                      this.offerInput = (e.target as HTMLTextAreaElement).value;
                    }}
                    placeholder="Paste SDP offer here..."
                    rows="6"
                    class="w-full bg-zinc-700 rounded-lg px-3 py-2 text-xs font-mono resize-none"
                  ></textarea>
                  ${this.statusMsg
                    ? html`<p class="text-sm text-yellow-400">
                        ${this.statusMsg}
                      </p>`
                    : ""}
                  <button
                    @click=${this.connect}
                    class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold text-sm transition-colors"
                  >
                    Connect
                  </button>
                </div>
              `
            : html`
                <div class="space-y-3">
                  <p class="text-sm">${this.statusMsg}</p>

                  ${this.answerSDP
                    ? html`
                        <div>
                          <p class="text-xs text-white/50 mb-1">
                            Send this answer back to the host:
                          </p>
                          <textarea
                            readonly
                            .value=${this.answerSDP}
                            rows="4"
                            class="w-full bg-zinc-900 rounded-lg px-3 py-2 text-xs font-mono text-green-400 resize-none"
                          ></textarea>
                          <button
                            @click=${this.copyAnswer}
                            class="mt-1 text-xs text-blue-400 hover:text-blue-300"
                          >
                            Copy to clipboard
                          </button>
                        </div>
                      `
                    : ""}

                  ${this.step === "connecting"
                    ? html`<div
                        class="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto"
                      ></div>`
                    : ""}
                </div>
              `}
        </div>
      </div>
    `;
  }
}
