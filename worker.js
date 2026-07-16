import { DurableObject } from "cloudflare:workers";
import page from "./index.html";

const WORLD_MIN = -2048;
const WORLD_MAX = 2047;
const COLORS = ["#5eead4", "#60a5fa", "#a78bfa", "#f472b6", "#f59e0b", "#84cc16"];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clampCoordinate(value) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return 0;
  return Math.max(WORLD_MIN, Math.min(WORLD_MAX, number));
}

export class SharedWorld extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tiles (
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        color TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (x, y)
      )
    `);
  }

  async fetch(request) {
    const upgrade = request.headers.get("Upgrade");

    if (upgrade?.toLowerCase() !== "websocket") {
      const [{ count }] = this.sql.exec("SELECT COUNT(*) AS count FROM tiles").toArray();
      return json({
        ok: true,
        storedTiles: Number(count),
        connectedPlayers: this.ctx.getWebSockets().length,
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const player = {
      id: crypto.randomUUID().slice(0, 8),
      x: 0,
      y: 0,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };

    server.serializeAttachment(player);
    this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify({
      type: "init",
      self: player,
      players: this.getPlayers(),
      tiles: this.sql.exec("SELECT x, y, color FROM tiles").toArray(),
      bounds: { min: WORLD_MIN, max: WORLD_MAX },
    }));

    this.broadcast({ type: "playerJoin", player }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, rawMessage) {
    if (typeof rawMessage !== "string") return;

    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      return;
    }

    const player = socket.deserializeAttachment();
    if (!player?.id) return;

    if (message.type === "move") {
      const nextX = clampCoordinate(message.x);
      const nextY = clampCoordinate(message.y);

      if (Math.abs(nextX - player.x) > 1 || Math.abs(nextY - player.y) > 1) return;

      player.x = nextX;
      player.y = nextY;
      socket.serializeAttachment(player);
      this.broadcast({ type: "playerMove", player });
      return;
    }

    if (message.type === "paint" && COLORS.includes(message.color)) {
      const savedAt = Date.now();
      this.sql.exec(
        `INSERT INTO tiles (x, y, color, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (x, y) DO UPDATE SET
           color = excluded.color,
           updated_at = excluded.updated_at`,
        player.x,
        player.y,
        message.color,
        savedAt,
      );

      this.broadcast({
        type: "tilePainted",
        x: player.x,
        y: player.y,
        color: message.color,
        savedAt,
      });
    }
  }

  webSocketClose(socket) {
    const player = socket.deserializeAttachment();
    if (player?.id) this.broadcast({ type: "playerLeave", playerId: player.id }, socket);
  }

  webSocketError(socket) {
    const player = socket.deserializeAttachment();
    if (player?.id) this.broadcast({ type: "playerLeave", playerId: player.id }, socket);
    try {
      socket.close(1011, "Connection error");
    } catch {
      // The connection may already be closed.
    }
  }

  getPlayers() {
    return this.ctx.getWebSockets()
      .map((socket) => socket.deserializeAttachment())
      .filter((player) => player?.id);
  }

  broadcast(message, except = null) {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(encoded);
      } catch {
        // A closing connection will disappear from getWebSockets shortly.
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws" || url.pathname === "/api/status") {
      const world = env.WORLD.getByName("main-world");
      return world.fetch(request);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(page, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};

