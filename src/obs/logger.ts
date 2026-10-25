import pc from "picocolors";
import type { ServedRequest } from "../http/types.js";

export interface Logger {
  request(request: ServedRequest): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  silent?: boolean;
  /** Called for non-request messages (defaults to console). */
  write?: (line: string) => void;
}

const STATUS_COLORS: Array<[number, (s: string) => string]> = [
  [199, pc.green],
  [299, pc.green],
  [399, pc.cyan],
  [499, pc.yellow],
  [599, pc.red],
];

function colorStatus(status: number): string {
  for (const [max, color] of STATUS_COLORS) {
    if (status <= max) return color(String(status));
  }
  return String(status);
}

function sourceBadge(source: ServedRequest["source"]): string {
  switch (source) {
    case "route":
      return pc.dim("route");
    case "resource":
      return pc.dim("resource");
    case "replay":
      return pc.blue("replay");
    case "proxy":
      return pc.magenta("proxy");
    case "admin":
      return pc.dim("admin");
    case "miss":
      return pc.red("MISS");
  }
}

function formatQuery(query: Record<string, string>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) return "";
  return `?${entries.map(([k, v]) => `${k}=${v}`).join("&")}`;
}

/**
 * Terminal logger. Request lines look like:
 *   14:03:22 ▶ GET /users/1 → 200 (12ms) [resource:users]
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => console.log(line));
  const log = (line: string) => {
    if (!options.silent) write(line);
  };

  return {
    request(request) {
      const time = new Date(request.time).toTimeString().slice(0, 8);
      const target = `${request.method} ${pc.bold(request.path)}${pc.dim(formatQuery(request.query))}`;
      const status = request.status !== undefined ? colorStatus(request.status) : pc.red("—");
      const duration = pc.dim(`(${request.durationMs}ms)`);
      const origin = request.origin ? pc.dim(`[${request.origin}]`) : "";
      let line = `${pc.dim(time)} ▶ ${target} → ${status} ${duration} ${sourceBadge(request.source)} ${origin}`;
      if (request.miss?.closest) {
        const { method, path, score } = request.miss.closest;
        line += `\n      ${pc.red("closest match")}: ${method} ${path} ${pc.dim(`(${Math.round(score * 100)}% similar)`)}`;
      }
      log(line);
    },
    info(message) {
      log(`${pc.blue("ℹ")} ${message}`);
    },
    warn(message) {
      log(`${pc.yellow("⚠")} ${message}`);
    },
    error(message) {
      log(`${pc.red("✖")} ${message}`);
    },
  };
}
