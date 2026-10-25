import type { MocktapeConfig } from "../config/schema.js";
import type { RequestContext, ServedRequest } from "../http/types.js";
import type { StatsSnapshot } from "../obs/stats.js";

export interface RouteInfo {
  name: string;
  methods: string[];
  path: string;
  scenarioStates: string[];
  activeScenario?: string;
}

/** Everything the admin API and dashboard need from a running server. */
export interface ServerState {
  mode: string;
  config: MocktapeConfig;
  routes: () => RouteInfo[];
  scenarios: () => Record<string, string>;
  setScenario: (routeName: string, state: string) => { ok: boolean; error?: string };
  reset: () => void;
  resources: () => Array<{ name: string; count: number }>;
  stats: () => StatsSnapshot;
  recent: () => ServedRequest[];
}

export const ADMIN_PREFIX = "/__mocktape__";

const CONTROL_CHARS = /[\r\n\0]/;

/**
 * Control-plane API under `/__mocktape__/*`:
 *   GET  /health              liveness + mode
 *   GET  /routes              route table with scenario states
 *   GET  /scenarios           active scenario per route
 *   PUT  /scenarios/:route    { "state": "declined" }
 *   POST /reset               restore seeds and scenario defaults
 *   GET  /resources           resource names and item counts
 *   GET  /stats               request statistics
 *   GET  /recent              last 50 served requests
 */
export function handleAdmin(
  request: RequestContext,
  state: ServerState,
): { status: number; body: unknown } {
  const sub = request.path.slice(ADMIN_PREFIX.length) || "/";

  if (sub === "/health")
    return json(200, { ok: true, mode: state.mode, uptimeMs: state.stats().uptimeMs });
  if (sub === "/routes") return json(200, state.routes());
  if (sub === "/scenarios") return json(200, state.scenarios());
  if (sub === "/reset") {
    state.reset();
    return json(200, { ok: true });
  }
  if (sub === "/resources") return json(200, state.resources());
  if (sub === "/stats") return json(200, state.stats());
  if (sub === "/recent") return json(200, state.recent().slice(-50));

  if (sub.startsWith("/scenarios/")) {
    let routeName: string;
    try {
      routeName = decodeURIComponent(sub.slice("/scenarios/".length));
    } catch {
      return json(400, { error: "malformed route name" });
    }
    if (CONTROL_CHARS.test(routeName)) return json(400, { error: "invalid route name" });
    if (request.method !== "PUT") return json(405, { error: "use PUT" });
    const newState = (request.body as { state?: string } | undefined)?.state;
    if (typeof newState !== "string") return json(400, { error: 'body must be {"state": "..."}' });
    const result = state.setScenario(routeName, newState);
    return result.ok
      ? json(200, { ok: true, route: routeName, state: newState })
      : json(400, { error: result.error });
  }

  return json(404, { error: `unknown admin endpoint: ${sub}` });
}

function json(status: number, body: unknown): { status: number; body: unknown } {
  return { status, body };
}
