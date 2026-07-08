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

    // Accept the WebSocket (Hibernation API)
    this.ctx.acceptWebSocket(ws, [role]);

    if (role === "host") {
      ws.send(JSON.stringify({ type: "room_code", code: room }));
    } else {
      // Notify host that a peer joined
      const hostSockets = this.ctx.getWebSockets("host");
      if (hostSockets.length === 0) {
        ws.close(4003, "Room has no host yet");
        return new Response(null, { status: 101, webSocket: client });
      }
      hostSockets[0].send(JSON.stringify({ type: "peer_joined" }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const tags = this.ctx.getTags(ws);
    const role = tags[0];
    const targetTag = role === "host" ? "peer" : "host";
    const targets = this.ctx.getWebSockets(targetTag);
    for (const target of targets) {
      try {
        target.send(message);
      } catch {
        // Ignore send errors (peer may have disconnected)
      }
    }
  }

  async webSocketClose(_ws) {
    // WebSocket closed — nothing extra to do
    return; // satisfy lint
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
