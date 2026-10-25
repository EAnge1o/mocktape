import type { ResponseSpec, RouteSpec } from "../config/schema.js";
import type { RequestContext } from "../http/types.js";

/** Per-request override: `x-mocktape-scenario: declined` flips the response. */
export const SCENARIO_HEADER = "x-mocktape-scenario";

export type ScenarioResolution =
  { ok: true; spec: ResponseSpec; state: string } | { ok: false; error: string };

/**
 * Tracks the active scenario state per route (set via the admin API or the
 * dashboard). The request header always wins over the stored state.
 */
export class ScenarioRegistry {
  private readonly states = new Map<string, string>();

  constructor(private readonly validStates: (routeName: string) => string[] | undefined) {}

  get(routeName: string): string | undefined {
    return this.states.get(routeName);
  }

  set(routeName: string, state: string): { ok: boolean; error?: string } {
    const valid = this.validStates(routeName);
    if (valid === undefined) return { ok: false, error: `no route named "${routeName}"` };
    if (!valid.includes(state)) {
      return { ok: false, error: `unknown state "${state}" (available: ${valid.join(", ")})` };
    }
    this.states.set(routeName, state);
    return { ok: true };
  }

  list(): Record<string, string> {
    return Object.fromEntries(this.states);
  }

  reset(): void {
    this.states.clear();
  }
}

/**
 * Resolve which response a route should produce: the per-request scenario from
 * the header, else the stored state, else the `default` scenario (or the
 * route's inline response when it has no scenarios at all).
 */
export function resolveScenario(
  route: { spec: RouteSpec; name: string; scenarioStates: string[] },
  request: RequestContext,
  registry: { get: (routeName: string) => string | undefined },
): ScenarioResolution {
  if (route.spec.scenarios === undefined) {
    // RouteSpec is a structural superset of ResponseSpec.
    return { ok: true, spec: route.spec as ResponseSpec, state: "default" };
  }
  const requested = request.headers[SCENARIO_HEADER] ?? registry.get(route.name);
  if (requested === undefined || requested === "") {
    const fallback = route.spec.scenarios["default"];
    if (fallback === undefined) {
      return {
        ok: false,
        error: `route "${route.name}" has scenarios but no "default" (available: ${route.scenarioStates.join(", ")})`,
      };
    }
    return { ok: true, spec: fallback, state: "default" };
  }
  const spec = route.spec.scenarios[requested];
  if (spec === undefined) {
    return {
      ok: false,
      error: `unknown scenario state "${requested}" for route "${route.name}" (available: ${route.scenarioStates.join(", ")})`,
    };
  }
  return { ok: true, spec, state: requested };
}
