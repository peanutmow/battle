/**
 * battle-worker.js — Combined game proxy + WebSocket signaling relay
 *
 * Serves the OpenFront game assets AND handles P2P signaling handshakes
 * on the /connect endpoint, all from a single Cloudflare Worker.
 *
 * Deploy with:
 *   wrangler deploy --assets static/
 */

/* global WebSocketPair */

// ── Signaling relay ─────────────────────────────────────────────────

const rooms = new Map();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 5; i++)
      code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

async function handleSignaling(request, env) {
  const url = new URL(request.url);

  // Status endpoint
  if (url.pathname === "/status") {
    return new Response(JSON.stringify({ ok: true, rooms: rooms.size }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // WebSocket upgrade
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

    const webSocketPair = new WebSocketPair();
    const client = webSocketPair[0];
    const ws = webSocketPair[1];
    ws.accept();

    let roomData = rooms.get(room);
    if (!roomData) {
      roomData = { host: null, peer: null, createdAt: Date.now() };
      rooms.set(room, roomData);
    }

    if (role === "host") {
      if (roomData.host) {
        ws.close(4001, "Room already has a host");
        return new Response(null, { status: 101, webSocket: client });
      }
      roomData.host = ws;
      ws.send(JSON.stringify({ type: "room_code", code: room }));
    } else {
      if (roomData.peer) {
        ws.close(4002, "Room already has a peer");
        return new Response(null, { status: 101, webSocket: client });
      }
      if (!roomData.host) {
        ws.close(4003, "Room has no host yet");
        return new Response(null, { status: 101, webSocket: client });
      }
      roomData.peer = ws;
      roomData.host.send(JSON.stringify({ type: "peer_joined" }));
    }

    ws.addEventListener("message", (event) => {
      try {
        JSON.parse(event.data);
      } catch {
        return;
      }
      const target = role === "host" ? roomData.peer : roomData.host;
      if (target && target.readyState === 1) {
        target.send(event.data);
      }
    });

    const cleanup = () => {
      if (role === "host") roomData.host = null;
      else roomData.peer = null;
      if (!roomData.host && !roomData.peer) {
        rooms.delete(room);
      }
    };

    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Not a signaling path — fall through to static assets
  return env.assets.fetch(request);
}

export default {
  fetch(request, env) {
    return handleSignaling(request, env);
  },
};
