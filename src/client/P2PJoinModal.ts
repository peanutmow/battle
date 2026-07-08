import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { P2PPeer } from "../p2p/P2PPeer";
import { createPeerConnection } from "../p2p/Signaling";
import { SignalingClient } from "../p2p/SignalingClient";
import type { JoinLobbyEvent } from "./Main";
import { p2pContext } from "./P2PContext";
import { UsernameInput } from "./UsernameInput";

const SIGNALING_URL = "wss://openfront-signaling.alice-646.workers.dev";

@customElement("p2p-join-modal")
export class P2PJoinModal extends LitElement {
  @state() private isOpen = false;
  @state() private codeInput = "";
  @state() private statusMsg = "";
  @state() private connected = false;

  private peer: P2PPeer | null = null;
  private sig: SignalingClient | null = null;

  createRenderRoot() {
    return this;
  }

  open() {
    this.isOpen = true;
    this.codeInput = "";
    this.statusMsg = "";
    this.connected = false;
    this.peer = null;
    this.sig = null;
  }

  close() {
    this.isOpen = false;
    this.sig?.close();
  }

  private async connect() {
    const code = this.codeInput.trim().toUpperCase();
    if (!code) {
      this.statusMsg = "Enter a room code";
      return;
    }

    this.statusMsg = "Connecting...";

    try {
      const sig = new SignalingClient(SIGNALING_URL);
      this.sig = sig;

      const peer = new P2PPeer();
      this.peer = peer;

      const pc = createPeerConnection();

      pc.onicecandidate = (e) => {
        if (e.candidate)
          sig.send({ type: "candidate", candidate: e.candidate.toJSON() });
      };

      pc.ondatachannel = (event) => {
        peer.setChannel(event.channel);
        this.connected = true;
        this.statusMsg = "Connected! Waiting for host to start...";
        this.requestUpdate();
      };

      sig.onMessage(async (msg) => {
        if (msg.type === "offer") {
          await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sig.send({ type: "answer", sdp: answer.sdp ?? "" });
        }
        if (msg.type === "candidate" && pc.remoteDescription) {
          await pc.addIceCandidate(msg.candidate).catch(() => {});
        }
      });

      await sig.joinRoom(code);
      this.statusMsg = "Joining...";

      peer.onMessage((msg) => {
        if (msg.type === "p2p_start") this.joinGame();
      });
    } catch (e) {
      this.statusMsg = `Failed: ${e}`;
    }
  }

  private async joinGame() {
    const peer = this.peer;
    if (!peer) return;

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const playerName = usernameInput?.getUsername() ?? "Player";

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
            <h2 class="text-lg font-bold">Join P2P Game</h2>
            <button
              @click=${this.close}
              class="text-white/60 hover:text-white text-xl"
            >
              ✕
            </button>
          </div>

          ${!this.connected
            ? html`
                <div class="space-y-3">
                  <p class="text-sm text-white/70">
                    Enter the host's room code:
                  </p>
                  <input
                    type="text"
                    .value=${this.codeInput}
                    @input=${(e: Event) => {
                      this.codeInput = (e.target as HTMLInputElement).value;
                    }}
                    placeholder="e.g. ABC12"
                    maxlength="5"
                    class="w-full bg-zinc-700 rounded-lg px-4 py-3 text-lg font-mono font-bold tracking-widest text-center uppercase"
                  />
                  ${this.statusMsg
                    ? html`<p class="text-sm text-yellow-400">
                        ${this.statusMsg}
                      </p>`
                    : ""}
                  <button
                    @click=${this.connect}
                    class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold text-sm"
                  >
                    Connect
                  </button>
                </div>
              `
            : html`
                <div class="space-y-3 text-center">
                  <p class="text-sm">${this.statusMsg}</p>
                  <div
                    class="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto"
                  ></div>
                </div>
              `}
        </div>
      </div>
    `;
  }
}
