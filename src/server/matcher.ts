import { pathToRegexp, type Key } from "path-to-regexp";
import type { RouteSpec } from "../config/schema.js";
import type { RequestContext } from "../http/types.js";
import { deepIncludes } from "../util/json.js";
import { requestSimilarity, type SimilarityResult } from "../util/similarity.js";

export interface PreparedRoute {
  name: string;
  spec: RouteSpec;
  methods: string[];
  regexp: RegExp;
  keys: Key[];
  specificity: number;
  /** Original order in the config, used as the stable tiebreaker. */
  order: number;
  scenarioStates: string[];
}

export interface RouteMatch {
  route: PreparedRoute;
  params: Record<string, string>;
}

/**
 * Compiles route specs into matchers and picks the best one for a request.
 *
 * Candidates are scored by specificity: explicit methods beat wildcards, static
 * path segments beat params, and routes with `when` predicates beat plain ones.
 * User-supplied `priority` shifts a route relative to its peers. Ties keep
 * config order, so the least surprising route wins.
 */
export class Router {
  private routes: PreparedRoute[] = [];

  constructor(routes: RouteSpec[]) {
    this.replace(routes);
  }

  replace(routes: RouteSpec[]): void {
    const usedNames = new Set<string>();
    this.routes = routes.map((spec, order) => {
      const methods = (Array.isArray(spec.method) ? spec.method : [spec.method ?? "GET"]).map((m) =>
        m.toUpperCase(),
      );
      const compiled = compile(spec.path);
      const name = uniqueName(spec.name ?? `${methods.join("|")} ${spec.path}`, usedNames);
      return {
        name,
        spec,
        methods,
        regexp: compiled.regexp,
        keys: compiled.keys,
        specificity: specificityOf(spec, methods, compiled.keys.length),
        order,
        scenarioStates: spec.scenarios ? Object.keys(spec.scenarios) : [],
      };
    });
  }

  get all(): readonly PreparedRoute[] {
    return this.routes;
  }

  find(name: string): PreparedRoute | undefined {
    return this.routes.find((route) => route.name === name);
  }

  match(request: RequestContext): RouteMatch | undefined {
    let best: (RouteMatch & { score: number }) | undefined;
    for (const route of this.routes) {
      if (!matchesMethod(route, request.method)) continue;
      const result = route.regexp.exec(request.path);
      if (result === null) continue;
      if (!predicatesMatch(route.spec, request)) continue;
      const params = extractParams(route.keys, result);
      const score = route.specificity + (route.spec.priority ?? 0);
      // > keeps the earlier route on ties: routes are pre-sorted by
      // specificity, so strictly greater score is required to displace.
      if (best === undefined || score > best.score) {
        best = { route, params, score };
      }
    }
    if (best === undefined) return undefined;
    return { route: best.route, params: best.params };
  }

  /** Closest configured routes to a request, used to explain 404s. */
  closest(
    request: RequestContext,
    count = 3,
  ): Array<{ route: PreparedRoute; similarity: SimilarityResult }> {
    return this.routes
      .map((route) => ({
        route,
        similarity: requestSimilarity(
          {
            method: request.method,
            path: request.path,
            query: request.query,
            body: request.body,
          },
          {
            method: route.methods.includes("*") ? request.method : route.methods[0]!,
            path: route.spec.path,
            query: stringifyValues(route.spec.when?.query ?? {}),
            body: route.spec.when?.body,
          },
        ),
      }))
      .sort((a, b) => b.similarity.score - a.similarity.score)
      .slice(0, count);
  }
}

function matchesMethod(route: PreparedRoute, method: string): boolean {
  return route.methods.includes("*") || route.methods.includes(method === "HEAD" ? "GET" : method);
}

function predicatesMatch(spec: RouteSpec, request: RequestContext): boolean {
  const when = spec.when;
  if (when === undefined) return true;
  if (when.headers !== undefined) {
    for (const [key, expected] of Object.entries(when.headers)) {
      if (request.headers[key.toLowerCase()] !== expected) return false;
    }
  }
  if (when.query !== undefined) {
    for (const [key, expected] of Object.entries(when.query)) {
      if (request.query[key] !== String(expected)) return false;
    }
  }
  if (when.body !== undefined && !deepIncludes(request.body, when.body)) return false;
  return true;
}

function extractParams(keys: Key[], execResult: RegExpExecArray): Record<string, string> {
  const params: Record<string, string> = {};
  keys.forEach((key, index) => {
    const value = execResult[index + 1];
    if (value !== undefined) params[key.name] = decodeURIComponent(value);
  });
  return params;
}

function compile(path: string): { regexp: RegExp; keys: Key[] } {
  return pathToRegexp(path);
}

function specificityOf(spec: RouteSpec, methods: string[], paramCount: number): number {
  let score = methods.includes("*") ? 0 : 4;
  for (const segment of spec.path.replace(/^\//, "").split("/")) {
    if (segment === "") continue;
    if (segment.startsWith(":")) score += 1;
    else if (segment.startsWith("*")) score += 0.5;
    else score += 2;
  }
  score -= paramCount * 0.01; // prefer literal segments over equally-shaped params
  const when = spec.when;
  if (when !== undefined) {
    score += Object.keys(when.query ?? {}).length;
    score += Object.keys(when.headers ?? {}).length;
    if (when.body !== undefined) score += 2;
  }
  return score;
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let counter = 2;
  while (used.has(`${base}#${counter}`)) counter++;
  const name = `${base}#${counter}`;
  used.add(name);
  return name;
}

function stringifyValues(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v)]));
}
