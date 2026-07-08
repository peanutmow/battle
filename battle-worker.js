/**
 * battle-worker.js — Combined game assets + WebSocket signaling relay
 *
 * Uses a Durable Object with WebSocket Hibernation to reliably route
 * messages between host and peer across Cloudflare Workers isolates.
 */

/* global WebSocketPair */

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ── Signaling Durable Object ─────────────────────────────────────────

export class SignalingRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // WebSocket tags: "host" and "peer"
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    let room = url.searchParams.get("room");

    if (!role || (role !== "host" && role !== "peer")) {
      return new Response("Invalid role", { status: 400 });
    }

    const webSocketPair = new WebSocketPair();
    const client = webSocketPair[0];
    const ws = webSocketPair[1];

    if (role === "host") {
      // Host connects — accept and send room code
      this.ctx.acceptWebSocket(ws, ["host"]);
      ws.send(JSON.stringify({ type: "room_code", code: room }));
    } else {
      // Peer connects — generate unique peer ID
      const peerId = crypto.randomUUID().slice(0, 8);
      this.ctx.acceptWebSocket(ws, ["peer", peerId]);

      // Notify host that a new peer joined
      const hostSockets = this.ctx.getWebSockets("host");
      if (hostSockets.length === 0) {
        ws.close(4003, "Room has no host yet");
        return new Response(null, { status: 101, webSocket: client });
      }
      hostSockets[0].send(JSON.stringify({ type: "peer_joined", peerId }));

      // Send the peer their ID so they can tag outgoing messages
      ws.send(JSON.stringify({ type: "peer_id", peerId }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const tags = this.ctx.getTags(ws);
    const role = tags[0];

    if (role === "host") {
      // Host sending — route to a specific peer by targetPeer field
      const targetPeerId = parsed.targetPeer;
      if (targetPeerId) {
        const peers = this.ctx.getWebSockets("peer");
        for (const p of peers) {
          const pTags = this.ctx.getTags(p);
          if (pTags[1] === targetPeerId) {
            try {
              p.send(message);
            } catch {
              /* ignore */
            }
            return;
          }
        }
      } else {
        // No targetPeer specified — broadcast to all peers
        const peers = this.ctx.getWebSockets("peer");
        for (const p of peers) {
          try {
            p.send(message);
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      // Peer sending — route to host
      const hostSockets = this.ctx.getWebSockets("host");
      for (const h of hostSockets) {
        try {
          h.send(message);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async webSocketClose(ws) {
    const tags = this.ctx.getTags(ws);
    const role = tags[0];
    // Notify host that a peer disconnected
    if (role === "peer") {
      const peerId = tags[1];
      const hostSockets = this.ctx.getWebSockets("host");
      for (const h of hostSockets) {
        try {
          h.send(JSON.stringify({ type: "peer_left", peerId }));
        } catch {
          /* ignore */
        }
      }
    }
  }

  static generateCode() {
    let code = "";
    for (let i = 0; i < 5; i++)
      code +=
        ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    return code;
  }
}

// ── Fetch handler ────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Status endpoint
    if (url.pathname === "/status") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // WebSocket upgrade — route through Durable Object
    if (url.pathname === "/connect") {
      const role = url.searchParams.get("role");
      let room = url.searchParams.get("room");

      if (!role || (role !== "host" && role !== "peer")) {
        return new Response("Missing or invalid ?role=host|peer", {
          status: 400,
        });
      }

      if (role === "host" && !room) {
        room = generateCode();
      }

      if (!room) {
        return new Response("Missing ?room=CODE", { status: 400 });
      }

      // Forward to the Durable Object for this room, ensuring room code
      // is in the request URL so the DO knows which room this is for
      const doId = env.SIGNALING_ROOM.idFromName(room);
      const stub = env.SIGNALING_ROOM.get(doId);
      const doUrl = new URL(request.url);
      doUrl.searchParams.set("room", room);
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    // Not a signaling path — serve static assets
    return env.assets.fetch(request);
  },
};

// ── Helper ───────────────────────────────────────────────────────────

function generateCode() {
  let code = "";
  for (let i = 0; i < 5; i++)
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return code;
}
