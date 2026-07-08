/**
 * Signaling Worker — relays WebRTC handshake messages between host and peer.
 *
 * Deploy this as a Cloudflare Worker. The host and peer connect via WebSocket
 * using a shared room code. The worker matches them and relays SDP + ICE
 * messages. Once connected, game data flows directly P2P via WebRTC.
 *
 * Flow:
 *   Host:  ws://host/connect?room=ABC123&role=host
 *   Peer:  ws://host/connect?room=ABC123&role=peer
 *
 * The worker generates the room code when a host connects without one.
 */

/* global WebSocketPair */

// Map of room codes -> { host: WebSocket, peer: WebSocket }
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

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Simple status endpoint
    if (url.pathname === "/" || url.pathname === "/status") {
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

      // Host without a code: generate one
      if (role === "host" && !room) {
        room = generateCode();
      }

      if (!room) {
        return new Response("Missing ?room=CODE", { status: 400 });
      }

      const webSocketPair = new WebSocketPair();
      const client = webSocketPair[0];

      // Accept the WebSocket
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
        // Tell the host what code they got
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
        // Notify host that a peer joined
        roomData.host.send(JSON.stringify({ type: "peer_joined" }));
      }

      ws.addEventListener("message", (event) => {
        try {
          JSON.parse(event.data);
        } catch {
          return;
        }

        // Relay signaling messages to the other peer
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

    return new Response("Not found", { status: 404 });
  },
};
