/**
 * Signaling client — connects to the Cloudflare Worker signaling relay
 * to exchange WebRTC handshake messages via a simple lobby code.
 *
 * Usage:
 *   const sig = new SignalingClient("wss://your-worker.workers.dev");
 *   const roomCode = await sig.createRoom();       // host
 *   await sig.joinRoom("ABC123");                   // peer
 *   sig.onSignal((data) => peer.addIceCandidate(data.candidate));
 *   sig.send({ type: "offer", sdp: pc.localDescription.sdp });
 */

export type SignalMessage =
  | { type: "room_code"; code: string }
  | { type: "peer_id"; peerId: string }
  | { type: "peer_joined"; peerId?: string }
  | { type: "peer_left"; peerId?: string }
  | { type: "offer"; sdp: string; targetPeer?: string; peerId?: string }
  | { type: "answer"; sdp: string; targetPeer?: string; peerId?: string }
  | {
      type: "candidate";
      candidate: RTCIceCandidateInit;
      targetPeer?: string;
      peerId?: string;
    };

export class SignalingClient {
  private ws: WebSocket | null = null;
  private msgCallbacks: Array<(msg: SignalMessage) => void> = [];
  private stateCallbacks: Array<(state: string) => void> = [];
  private _roomCode: string | null = null;
  private _closed = false;

  constructor(private serverUrl: string) {}

  get roomCode(): string | null {
    return this._roomCode;
  }

  onMessage(cb: (msg: SignalMessage) => void): void {
    this.msgCallbacks.push(cb);
  }

  onStateChange(cb: (state: string) => void): void {
    this.stateCallbacks.push(cb);
  }

  private setState(state: string): void {
    for (const cb of this.stateCallbacks) cb(state);
  }

  /**
   * Create a new room as host. Returns the room code.
   */
  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      this._closed = false;
      this.setState("connecting");
      const ws = new WebSocket(`${this.serverUrl}/connect?role=host`);
      this.ws = ws;

      ws.onopen = () => this.setState("connected");

      ws.onmessage = (event) => {
        let msg: SignalMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === "room_code") {
          this._roomCode = msg.code;
          resolve(msg.code);
        }
        for (const cb of this.msgCallbacks) cb(msg);
      };

      ws.onerror = () => {
        this.setState("error");
        reject(new Error("WebSocket error"));
      };

      ws.onclose = () => {
        if (!this._closed) this.setState("disconnected");
      };
    });
  }

  /**
   * Join an existing room as peer.
   */
  joinRoom(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this._closed = false;
      this._roomCode = code;
      this.setState("connecting");
      const ws = new WebSocket(
        `${this.serverUrl}/connect?role=peer&room=${code}`,
      );
      this.ws = ws;

      ws.onopen = () => this.setState("connected");

      ws.onmessage = (event) => {
        let msg: SignalMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        for (const cb of this.msgCallbacks) cb(msg);
      };

      ws.onerror = () => {
        this.setState("error");
        reject(new Error("WebSocket error"));
      };

      ws.onclose = () => {
        if (!this._closed) this.setState("disconnected");
      };

      // Resolve once we get any message (meaning we're paired)
      const check = (msg: SignalMessage) => {
        if (
          msg.type === "offer" ||
          msg.type === "answer" ||
          msg.type === "candidate"
        ) {
          resolve();
        }
      };
      this.msgCallbacks.push(check);
    });
  }

  /**
   * Send a signaling message to the other peer.
   */
  send(msg: SignalMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Wait until a peer joins (host side).
   */
  waitForPeer(timeoutMs = 60000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timeout waiting for peer")),
        timeoutMs,
      );
      const cb = (msg: SignalMessage) => {
        if (msg.type === "peer_joined") {
          clearTimeout(timeout);
          resolve();
        }
      };
      this.msgCallbacks.push(cb);
    });
  }

  /**
   * Close the connection.
   */
  close(): void {
    this._closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
