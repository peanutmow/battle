import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import { P2PPeer } from "../p2p/P2PPeer";
import { createPeerConnection } from "../p2p/Signaling";
import { SignalingClient } from "../p2p/SignalingClient";
import type { P2PPlayerInfo } from "../p2p/types";
import type { JoinLobbyEvent } from "./Main";
import { p2pContext } from "./P2PContext";
import "./P2PLobbyScreen";
import type { P2PLobbyConfig } from "./P2PLobbyScreen";
import { UsernameInput } from "./UsernameInput";

const SIGNALING_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

type JoinPhase = "hidden" | "form" | "connecting" | "lobby";

@customElement("p2p-join-modal")
export class P2PJoinModal extends LitElement {
  @state() private phase: JoinPhase = "hidden";
  @state() private codeInput = "";
  @state() private statusMsg = "";
  @state() private roomCode = "";
  @state() private players: P2PPlayerInfo[] = [];

  private peer: P2PPeer | null = null;
  private sig: SignalingClient | null = null;
  private playerName = "";

  createRenderRoot() {
    return this;
  }

  open() {
    this.phase = "form";
    this.codeInput = "";
    this.statusMsg = "";
    this.roomCode = "";
    this.players = [];
    this.peer = null;
    this.sig = null;
  }

  close() {
    this.phase = "hidden";
    this.sig?.close();
  }

  private async connect() {
    const code = this.codeInput.trim().toUpperCase();
    if (!code) {
      this.statusMsg = "Enter a room code";
      return;
    }

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    this.playerName = usernameInput?.getUsername() ?? "Player";

    this.phase = "connecting";
    this.roomCode = code;
    this.statusMsg = "Connecting...";

    try {
      const sig = new SignalingClient(SIGNALING_URL);
      this.sig = sig;

      const peer = new P2PPeer();
      this.peer = peer;

      const pc = createPeerConnection();
      let myPeerId = "";

      pc.onicecandidate = (e) => {
        if (e.candidate)
          sig.send({
            type: "candidate",
            candidate: e.candidate.toJSON(),
            peerId: myPeerId,
          });
      };

      pc.ondatachannel = (event) => {
        peer.setChannel(event.channel);
        this.players = [
          {
            clientID: peer.clientID ?? "",
            username: this.playerName,
            connected: true,
          },
        ];
        this.phase = "lobby";
        this.statusMsg = "Connected! Waiting for host to start...";
        this.requestUpdate();
      };

      sig.onMessage(async (msg: any) => {
        if (msg.type === "peer_id") {
          myPeerId = msg.peerId;
        }
        if (msg.type === "offer") {
          await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sig.send({
            type: "answer",
            sdp: answer.sdp ?? "",
            peerId: myPeerId,
          });
        }
        if (msg.type === "candidate" && pc.remoteDescription) {
          await pc.addIceCandidate(msg.candidate).catch(() => {});
        }
      });

      await sig.joinRoom(code);

      peer.onMessage((msg) => {
        if (msg.type === "p2p_joined") {
          this.players = msg.players ?? this.players;
          this.requestUpdate();
        }
        if (msg.type === "p2p_start") this.joinGame();
      });
    } catch (e) {
      this.statusMsg = `Failed: ${e}`;
      this.phase = "form";
    }
  }

  private async joinGame() {
    const peer = this.peer;
    if (!peer) return;

    p2pContext.setPeer(peer);
    peer.send({
      type: "p2p_join",
      username: this.playerName,
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

  private defaultConfig(): P2PLobbyConfig {
    return {
      gameMap: GameMapType.World,
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
    };
  }

  render() {
    if (this.phase === "hidden") return html``;
    return html`
      <!-- Join form -->
      ${this.phase === "form"
        ? html`
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
      ${this.phase === "lobby"
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
                  .isHost=${false}
                  .roomCode=${this.roomCode}
                  .players=${this.players}
                  .config=${this.defaultConfig()}
                  .statusMsg=${this.statusMsg}
                  .canStart=${false}
                  .onLeave=${() => this.close()}
                ></p2p-lobby-screen>
              </div>
            </div>
          `
        : ""}
    `;
  }
}
