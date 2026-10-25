import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { EventBus } from "../obs/bus.js";
import type { ServedRequest } from "../http/types.js";
import type { ServerState } from "../server/admin.js";

export interface DashboardOptions {
  port?: number;
  host?: string;
  bus: EventBus;
  state: () => ServerState;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function publicDir(): string {
  // dist/dashboard/server.js → dist/dashboard/public
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
}

/**
 * Live traffic dashboard: serves the static UI and pushes every served request
 * over a WebSocket (`/live`). The scenario switcher talks to the same admin
 * API the CLI exposes, so the dashboard adds no privileged endpoints.
 */
export class DashboardServer {
  private httpServer: http.Server | undefined;
  private readonly clients = new Set<WebSocket>();

  constructor(private readonly options: DashboardOptions) {
    options.bus.on("served", (request) => {
      this.broadcast({ type: "request", request });
    });
  }

  async start(): Promise<void> {
    const assets = publicDir();
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
        const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
        const body = await readFile(path.join(assets, safe));
        res.writeHead(200, {
          "content-type": MIME[path.extname(safe)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
    });

    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/live") {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        this.clients.add(ws);
        ws.send(JSON.stringify({ type: "snapshot", ...this.snapshotPayload() }));
        ws.on("close", () => this.clients.delete(ws));
        ws.on("error", () => this.clients.delete(ws));
      });
    });

    const port = this.options.port ?? 0;
    await new Promise<void>((resolve) => {
      server.listen(port, this.options.host ?? "127.0.0.1", () => resolve());
    });
    this.httpServer = server;
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.close();
    this.clients.clear();
    const server = this.httpServer;
    if (server === undefined) return; // idempotent close
    this.httpServer = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  get port(): number {
    const address = this.httpServer?.address();
    if (typeof address === "object" && address !== null) return address.port;
    return this.options.port ?? 0;
  }

  get url(): string {
    return `http://${this.options.host ?? "127.0.0.1"}:${this.port}`;
  }

  private snapshotPayload(): {
    recent: ServedRequest[];
    stats: ReturnType<ServerState["stats"]>;
    routes: ReturnType<ServerState["routes"]>;
    scenarios: Record<string, string>;
    resources: Array<{ name: string; count: number }>;
  } {
    const state = this.options.state();
    return {
      recent: state.recent().slice(-100),
      stats: state.stats(),
      routes: state.routes(),
      scenarios: state.scenarios(),
      resources: state.resources(),
    };
  }

  private broadcast(message: object): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
