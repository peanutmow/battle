/**
 * P2PPeer — Browser-based peer client that connects to a P2PHost.
 *
 * The peer receives an SDP offer from the host (copy-pasted), creates an
 * answer, and establishes a WebRTC DataChannel for game message exchange.
 *
 * Messages flow identically to the original WebSocket protocol from the
 * peer's perspective:
 *   - The host sends turns (p2p_turn) → feeds into local Worker
 *   - The peer sends intents (p2p_intent) → host collects them
 */

import { createAnswer, createPeerConnection, waitForConnection } from "./Signaling";
import type { P2PMessage } from "./types";

export type P2PPeerState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export class P2PPeer {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private _state: P2PPeerState = "idle";
  private messageCallbacks: Array<(msg: P2PMessage) => void> = [];
  private stateCallbacks: Array<(state: P2PPeerState) => void> = [];
  private _answerSDP: string | null = null;

  /** The clientID assigned by the host */
  public clientID: string | null = null;

  get state(): P2PPeerState {
    return this._state;
  }

  /** The answer SDP that should be shared back to the host */
  get answerSDP(): string | null {
    return this._answerSDP;
  }

  onMessage(cb: (msg: P2PMessage) => void): void {
    this.messageCallbacks.push(cb);
  }

  onStateChange(cb: (state: P2PPeerState) => void): void {
    this.stateCallbacks.push(cb);
  }

  private setState(state: P2PPeerState): void {
    this._state = state;
    for (const cb of this.stateCallbacks) cb(state);
  }

  /**
   * Connect to a host using their SDP offer.
   * Returns the answer SDP that must be shared back with the host.
   */
  async connect(offerSdp: string): Promise<string> {
    this.setState("connecting");

    try {
      this.pc = createPeerConnection();

      // Set up the data channel listener
      this.pc.ondatachannel = (event) => {
        this.channel = event.channel;
        this.setupChannel();
      };

      // Create answer from the host's offer
      this._answerSDP = await createAnswer(this.pc, offerSdp);

      // Wait for connection
      await waitForConnection(this.pc, 15000);

      this.setState("connected");
      return this._answerSDP;
    } catch (err) {
      this.setState("error");
      throw err;
    }
  }

  private setupChannel(): void {
    if (!this.channel) return;

    this.channel.onmessage = (event) => {
      try {
        const msg: P2PMessage = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (e) {
        console.error("P2PPeer: failed to parse message", e);
      }
    };

    this.channel.onclose = () => {
      this.setState("disconnected");
    };

    this.channel.onerror = () => {
      this.setState("error");
    };
  }

  private handleMessage(msg: P2PMessage): void {
    switch (msg.type) {
      case "p2p_joined":
        this.clientID = msg.clientID;
        break;
    }

    for (const cb of this.messageCallbacks) cb(msg);
  }

  /**
   * Send a message to the host.
   */
  send(msg: P2PMessage): void {
    if (!this.channel || this.channel.readyState !== "open") {
      console.warn("P2PPeer: cannot send, channel not open");
      return;
    }
    this.channel.send(JSON.stringify(msg));
  }

  /**
   * Disconnect from the host.
   */
  disconnect(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.setState("disconnected");
  }
}
