/**
 * P2PPeer — Wraps a WebRTC DataChannel for receiving game messages from the host.
 *
 * The channel is established externally (via SignalingClient). P2PPeer just
 * provides the message dispatch layer.
 */

import type { P2PMessage } from "./types";

export class P2PPeer {
  private channel: RTCDataChannel | null = null;
  private messageCallbacks: Array<(msg: P2PMessage) => void> = [];
  public clientID: string | null = null;

  onMessage(cb: (msg: P2PMessage) => void): void {
    this.messageCallbacks.push(cb);
  }

  /** Set the DataChannel after it's established */
  setChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onmessage = (event) => {
      try {
        const msg: P2PMessage = JSON.parse(event.data);
        if (msg.type === "p2p_joined") this.clientID = msg.clientID;
        for (const cb of this.messageCallbacks) cb(msg);
      } catch {
        /* ignore */
      }
    };
  }

  send(msg: P2PMessage): void {
    if (this.channel?.readyState === "open")
      this.channel.send(JSON.stringify(msg));
  }

  disconnect(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}
