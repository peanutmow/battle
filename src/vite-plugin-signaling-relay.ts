/**
 * Vite plugin: signaling-relay
 *
 * Embeds a WebSocket signaling relay into the Vite dev server so P2P host/peer
 * handshakes work during local development (no separate Cloudflare Worker needed).
 *
 * The relay is protocol-compatible with signaling-worker.js — host and peer
 * connect via WebSocket, get a room code, and have signaling messages relayed.
 *
 * In production, deploy signaling-worker.js as a Cloudflare Worker instead.
 */

import crypto from "node:crypto";
import type { Plugin, ViteDevServer } from "vite";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(existing: Set<string>): string {
  let code: string;
  do {
    code = "";
    for (let i = 0; i < 5; i++)
      code += ROOM_CODE_CHARS[crypto.randomInt(ROOM_CODE_CHARS.length)];
  } while (existing.has(code));
  return code;
}

interface RoomData {
  host: WsWebSocket | null;
  peer: WsWebSocket | null;
}

export function signalingRelay(): Plugin {
  const rooms = new Map<string, RoomData>();

  return {
    name: "signaling-relay",
    configureServer(server: ViteDevServer) {
      // Clean up stale rooms periodically
      setInterval(() => {
        for (const [code, room] of rooms) {
          if (
            (!room.host || room.host.readyState === WsWebSocket.CLOSED) &&
            (!room.peer || room.peer.readyState === WsWebSocket.CLOSED)
          ) {
            rooms.delete(code);
          }
        }
      }, 60_000);

      server.httpServer?.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "", "http://localhost");
        if (url.pathname !== "/connect") return;

        const role = url.searchParams.get("role");
        let room = url.searchParams.get("room");

        if (!role || (role !== "host" && role !== "peer")) {
          socket.destroy();
          return;
        }

        const wss = new WebSocketServer({ noServer: true });
        wss.handleUpgrade(request, socket, head, (ws) => {
          if (role === "host" && !room) {
            room = generateCode(new Set(rooms.keys()));
          }

          if (!room) {
            ws.close(4000, "Missing room code");
            return;
          }

          let roomData = rooms.get(room);
          if (!roomData) {
            roomData = { host: null, peer: null };
            rooms.set(room, roomData);
          }

          if (role === "host") {
            if (roomData.host) {
              ws.close(4001, "Room already has a host");
              return;
            }
            roomData.host = ws;
            ws.send(JSON.stringify({ type: "room_code", code: room }));
          } else {
            if (roomData.peer) {
              ws.close(4002, "Room already has a peer");
              return;
            }
            if (!roomData.host) {
              ws.close(4003, "Room has no host yet");
              return;
            }
            roomData.peer = ws;
            roomData.host.send(JSON.stringify({ type: "peer_joined" }));
          }

          ws.on("message", (raw) => {
            const data = raw.toString();
            try {
              JSON.parse(data);
            } catch {
              return;
            }
            const target = role === "host" ? roomData!.peer : roomData!.host;
            if (target && target.readyState === WsWebSocket.OPEN) {
              target.send(data);
            }
          });

          const cleanup = () => {
            if (role === "host") roomData!.host = null;
            else roomData!.peer = null;
            if (!roomData!.host && !roomData!.peer) {
              rooms.delete(room!);
            }
          };
          ws.on("close", cleanup);
          ws.on("error", cleanup);
        });
      });
    },
  };
}
