import http from "node:http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MocktapeConfig } from "../config/schema.js";
import { corsHeaders } from "../http/cors.js";
import { parseContext, BodyTooLargeError } from "../http/parse.js";
import type { RequestContext, ServedRequest, RequestSource } from "../http/types.js";
import type { EventBus } from "../obs/bus.js";
import type { Logger } from "../obs/logger.js";
import { StatsTracker } from "../obs/stats.js";
import { decodeBody } from "../tape/cassette.js";
import { UpstreamProxy, UpstreamError } from "../tape/proxy.js";
import { CassetteWriter } from "../tape/recorder.js";
import { ReplayMatcher } from "../tape/replay.js";
import { ADMIN_PREFIX, handleAdmin, type RouteInfo, type ServerState } from "./admin.js";
import { Router, type PreparedRoute } from "./matcher.js";
import { buildResponseFromSpec, type ResolvedResponse } from "./responder.js";
import { resolveScenario } from "./scenario.js";
import { ResourceStore } from "./store.js";
import type { RecordedInteraction } from "../tape/cassette.js";

export type ServerMode =
  | { type: "dev"; upstream?: string }
  | { type: "record"; upstream: string; cassettePath: string }
  | { type: "replay"; passthrough?: { upstream: string; cassettePath: string } };

export interface MockServerOptions {
  config: MocktapeConfig;
  configDir: string;
  mode: ServerMode;
  logger: Logger;
  bus: EventBus;
}

export interface SendResult {
  status: number | undefined;
  headers: Record<string, string>;
  responseBody?: unknown;
}

export interface ClosestMatch {
  method: string;
  path: string;
  score: number;
  breakdown: unknown;
}

const MAX_RECENT = 300;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADERS.has(name) ? "[redacted]" : value,
    ]),
  );
}

/**
 * The mock server pipeline:
 *
 *   parse → CORS preflight → admin API → mode pipeline → serve → observe
 *
 * Mode pipelines:
 *   dev    configured routes → CRUD resources → upstream fallback → 404+closest
 *   record configured routes → CRUD resources → proxy upstream + record
 *   replay cassette match → (passthrough proxy) → 404+closest
 */
export class MockServer {
  router: Router;
  store: ResourceStore;
  readonly scenarios: ScenarioRegistryShim;
  readonly stats = new StatsTracker();
  replay: ReplayMatcher | undefined;

  private readonly config: MocktapeConfig;
  private readonly configDir: string;
  private readonly mode: ServerMode;
  private readonly logger: Logger;
  private readonly bus: EventBus;
  private readonly recent: ServedRequest[] = [];
  private proxy: UpstreamProxy | undefined;
  private recorder: CassetteWriter | undefined;
  private httpServer: http.Server | undefined;
  private listeningPort: number | undefined;

  constructor(options: MockServerOptions) {
    this.config = options.config;
    this.configDir = options.configDir;
    this.mode = options.mode;
    this.logger = options.logger;
    this.bus = options.bus;

    this.router = new Router(options.config.routes);
    this.store = new ResourceStore(options.config.resources, options.configDir);
    this.scenarios = new ScenarioRegistryShim(this);

    const effectiveUpstream =
      options.mode.type === "dev" ? (options.mode.upstream ?? options.config.upstream) : undefined;
    if (effectiveUpstream !== undefined) this.proxy = new UpstreamProxy(effectiveUpstream);
    if (options.mode.type === "record") {
      this.proxy = new UpstreamProxy(options.mode.upstream);
      this.recorder = new CassetteWriter(options.mode.cassettePath, options.mode.upstream);
    }
    if (options.mode.type === "replay") {
      this.replay = new ReplayMatcher([]);
      if (options.mode.passthrough !== undefined) {
        this.proxy = new UpstreamProxy(options.mode.passthrough.upstream);
        this.recorder = new CassetteWriter(
          options.mode.passthrough.cassettePath,
          options.mode.passthrough.upstream,
        );
      }
    }
  }

  async start(): Promise<void> {
    await this.store.hydrate();
    const server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.port ?? 0, this.config.host ?? "127.0.0.1", () => {
        const address = server.address();
        resolve(
          typeof address === "object" && address !== null ? address.port : (this.config.port ?? 0),
        );
      });
    });
    this.listeningPort = port;
    this.httpServer = server;
    this.logger.info(
      `mocktape ${this.mode.type} server listening on ${this.url}` +
        (this.mode.type === "record" ? ` → upstream ${this.mode.upstream}` : ""),
    );
  }

  async stop(): Promise<void> {
    if (this.httpServer === undefined) return; // idempotent close
    await this.store.flush();
    await this.recorder?.flush();
    const server = this.httpServer;
    this.httpServer = undefined;
    this.listeningPort = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  get started(): boolean {
    return this.httpServer !== undefined;
  }

  get port(): number {
    if (this.listeningPort === undefined) throw new Error("server is not started");
    return this.listeningPort;
  }

  get url(): string {
    return `http://${this.config.host ?? "127.0.0.1"}:${this.listeningPort ?? this.config.port ?? 0}`;
  }

  get recorderInteractions(): readonly unknown[] {
    return this.recorder?.interactions ?? [];
  }

  /** Load cassettes into the replay matcher (replay mode). */
  setTape(matcher: ReplayMatcher): void {
    this.replay = matcher;
  }

  /**
   * Hot-reload support: swap the router for new routes and only rebuild the
   * resource store when the resource specs actually changed (so in-memory CRUD
   * state survives unrelated edits).
   */
  applyConfig(config: MocktapeConfig): void {
    this.router.replace(config.routes);
    if (JSON.stringify(config.resources) !== JSON.stringify(this.config.resources)) {
      this.store = new ResourceStore(config.resources, this.configDir);
      void this.store.hydrate();
    }
    Object.assign(this.config, config);
    this.logger.info("config reloaded");
    this.bus.emit("reloaded");
  }

  setScenario(routeName: string, state: string): { ok: boolean; error?: string } {
    return this.scenarios.set(routeName, state);
  }

  // ------------------------------------------------------------------ pipeline

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startedAt = Date.now();
    let context: RequestContext;
    try {
      context = await parseContext(req);
    } catch (error) {
      const tooLarge = error instanceof BodyTooLargeError;
      this.sendRaw(
        res,
        tooLarge ? 413 : 400,
        { "content-type": "application/json; charset=utf-8" },
        {
          error: (error as Error).message,
        },
      );
      return;
    }

    if (this.config.cors && context.method === "OPTIONS") {
      const headers = corsHeaders(context.headers);
      this.sendRaw(res, 204, headers, undefined);
      this.emitServed(context, {
        status: 204,
        headers,
        source: "admin",
        origin: "cors-preflight",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    if (context.path === ADMIN_PREFIX || context.path.startsWith(`${ADMIN_PREFIX}/`)) {
      const result = handleAdmin(context, this.state());
      const headers = { "content-type": "application/json; charset=utf-8", ...this.cors() };
      this.sendRaw(res, result.status, headers, result.body);
      this.emitServed(context, {
        status: result.status,
        headers,
        responseBody: result.body,
        source: "admin",
        origin: "admin",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    try {
      switch (this.mode.type) {
        case "dev":
          await this.handleDev(context, res, startedAt);
          return;
        case "record":
          await this.handleRecord(context, res, startedAt);
          return;
        case "replay":
          await this.handleReplay(context, res, startedAt);
          return;
      }
    } catch (error) {
      const status = error instanceof UpstreamError ? 502 : 500;
      const body = { error: (error as Error).message };
      const headers = { "content-type": "application/json; charset=utf-8", ...this.cors() };
      this.sendRaw(res, status, headers, body);
      this.emitServed(context, {
        status,
        headers,
        responseBody: body,
        source: "miss",
        origin: "error",
        durationMs: Date.now() - startedAt,
      });
    }
  }

  /** dev: configured routes → resources → upstream fallback → 404. */
  private async handleDev(
    context: RequestContext,
    res: ServerResponse,
    startedAt: number,
  ): Promise<void> {
    if (await this.serveConfigured(context, res, startedAt)) return;
    if (this.proxy !== undefined) {
      await this.serveProxied(context, res, startedAt, false);
      return;
    }
    this.serveMiss(context, res, startedAt, this.closestRoutes(context));
  }

  /** record: configured routes → resources → always proxy + record. */
  private async handleRecord(
    context: RequestContext,
    res: ServerResponse,
    startedAt: number,
  ): Promise<void> {
    if (await this.serveConfigured(context, res, startedAt)) return;
    await this.serveProxied(context, res, startedAt, true);
  }

  /** replay: cassette → configured routes → optional passthrough → 404. */
  private async handleReplay(
    context: RequestContext,
    res: ServerResponse,
    startedAt: number,
  ): Promise<void> {
    const result = this.replay?.match(context);
    if (result !== undefined && result.type === "hit") {
      const sent = this.sendRecorded(context, res, result.interaction);
      this.emitServed(context, {
        ...sent,
        source: "replay",
        origin: result.interaction.id.slice(0, 8),
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    if (await this.serveConfigured(context, res, startedAt)) return;
    if (this.proxy !== undefined) {
      await this.serveProxied(context, res, startedAt, true);
      return;
    }
    const closest = (result?.type === "miss" ? result.closest : []).map((entry) => ({
      method: entry.interaction.request.method,
      path: entry.interaction.request.path,
      score: entry.similarity.score,
      breakdown: entry.similarity.breakdown,
    }));
    this.serveMiss(context, res, startedAt, closest);
  }

  /** Try configured routes, then CRUD resources. Returns true when served. */
  private async serveConfigured(
    context: RequestContext,
    res: ServerResponse,
    startedAt: number,
  ): Promise<boolean> {
    const match = this.router.match(context);
    if (match !== undefined) {
      context.params = match.params;
      const resolution = resolveScenario(match.route, context, this.scenarios);
      const response = await buildResponseFromSpec({
        spec: resolution.ok ? resolution.spec : undefined,
        scenarioError: resolution.ok ? undefined : resolution.error,
        scenario: resolution.ok ? resolution.state : "",
        route: match.route,
        request: context,
        config: this.config,
        configDir: this.configDir,
      });
      if (await this.sendResolved(context, res, startedAt, response, "route", match.route.name))
        return true;
      // 'reset' fault destroyed the socket — nothing left to do.
      return true;
    }

    const stored = this.store.handle(context);
    if (stored !== undefined) {
      const headers = { "content-type": "application/json; charset=utf-8", ...this.cors() };
      const sent = this.sendRaw(res, stored.status, headers, stored.body);
      this.emitServed(context, {
        ...sent,
        source: "resource",
        origin: stored.origin,
        durationMs: Date.now() - startedAt,
      });
      return true;
    }
    return false;
  }

  private async serveProxied(
    context: RequestContext,
    res: ServerResponse,
    startedAt: number,
    record: boolean,
  ): Promise<void> {
    const proxied = await this.proxy!.forward(context);
    let origin = "upstream";
    if (record && this.recorder !== undefined) {
      const interaction = await this.recorder.record(context, proxied);
      origin = interaction.id.slice(0, 8);
    }
    const headers = { ...proxied.headers, ...this.cors() };
    const sent = this.sendRaw(res, proxied.status, headers, proxied.raw);
    this.emitServed(context, {
      ...sent,
      source: "proxy",
      origin,
      durationMs: Date.now() - startedAt,
    });
  }

  private sendRecorded(
    context: RequestContext,
    res: ServerResponse,
    interaction: RecordedInteraction,
  ): SendResult {
    const raw = decodeBody(interaction.response.body, interaction.response.bodyEncoding);
    const headers = { ...interaction.response.headers, ...this.cors() };
    return this.sendRaw(res, interaction.response.status, headers, raw);
  }

  private async sendResolved(
    context: RequestContext,
    res: ServerResponse,
    startedAt: number,
    response: ResolvedResponse,
    source: RequestSource,
    origin: string,
  ): Promise<boolean> {
    if (response.delayMs > 0) await sleep(response.delayMs);
    if (response.appliedFault?.type === "reset") {
      res.socket?.destroy();
      this.emitServed(context, {
        status: undefined,
        headers: {},
        source,
        origin: `${origin} (reset fault)`,
        durationMs: Date.now() - startedAt,
      });
      return false;
    }
    const headers = { ...response.headers, ...this.cors() };
    if (response.appliedFault !== undefined) {
      headers["x-mocktape-fault"] = response.appliedFault.type;
    }
    const sent = this.sendRaw(res, response.status, headers, response.raw ?? response.body);
    this.emitServed(context, {
      ...sent,
      source,
      origin,
      durationMs: Date.now() - startedAt,
      requestHeaders: maskHeaders(context.headers),
      requestBody: context.body ?? truncateBody(context.rawBody?.toString("utf8")),
      responseBody: sent.responseBody,
    });
    return true;
  }

  private serveMiss(
    context: RequestContext,
    res: ServerResponse,
    startedAt: number,
    closest: ClosestMatch[],
  ): void {
    const body = {
      error: "no route matched this request",
      method: context.method,
      path: context.path,
      query: context.query,
      hint: "check the spelling of the path, or add a route for it; the closest configured routes are listed below",
      closest,
    };
    const headers = { "content-type": "application/json; charset=utf-8", ...this.cors() };
    const sent = this.sendRaw(res, 404, headers, body);
    const nearest = closest[0];
    this.emitServed(context, {
      ...sent,
      source: "miss",
      origin: closest.length > 0 ? "no-match" : "no-routes",
      durationMs: Date.now() - startedAt,
      miss: nearest !== undefined ? { closest: nearest } : undefined,
      requestHeaders: maskHeaders(context.headers),
      requestBody: context.body ?? truncateBody(context.rawBody?.toString("utf8")),
      responseBody: body,
    });
  }

  // ------------------------------------------------------------------ plumbing

  private cors(): Record<string, string> {
    return this.config.cors ? corsHeaders({}) : {};
  }

  private closestRoutes(context: RequestContext): ClosestMatch[] {
    return this.router.closest(context).map(({ route, similarity }) => ({
      method: route.methods.includes("*") ? "*" : route.methods.join("|"),
      path: route.spec.path,
      score: similarity.score,
      breakdown: similarity.breakdown,
    }));
  }

  private sendRaw(
    res: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body: unknown,
  ): SendResult {
    if (res.headersSent) return { status, headers };
    let payload: Buffer | undefined;
    if (body !== undefined && body !== null && status !== 204 && status !== 304) {
      payload = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === "string" ? body : JSON.stringify(body, null, 2), "utf8");
    }
    const outHeaders: Record<string, string> = { ...headers };
    if (payload !== undefined) outHeaders["content-length"] = String(payload.length);
    res.writeHead(status, outHeaders);
    const method = res.req?.method?.toUpperCase();
    if (method === "HEAD" || payload === undefined) {
      res.end();
    } else {
      res.end(payload);
    }
    let responseBody: unknown;
    if (payload !== undefined && method !== "HEAD") {
      const text = payload.toString("utf8");
      if (outHeaders["content-type"]?.includes("json")) {
        try {
          responseBody = JSON.parse(text);
        } catch {
          responseBody = truncateBody(text);
        }
      } else {
        responseBody = truncateBody(text);
      }
    }
    return { status, headers: outHeaders, responseBody };
  }

  private emitServed(
    context: RequestContext,
    data: {
      status: number | undefined;
      headers: Record<string, string>;
      responseBody?: unknown;
      source: RequestSource;
      origin?: string;
      durationMs: number;
      miss?: { closest: ClosestMatch };
      requestHeaders?: Record<string, string>;
      requestBody?: unknown;
    },
  ): void {
    const served: ServedRequest = {
      id: randomUUID(),
      time: Date.now(),
      method: context.method,
      path: context.path,
      query: context.query,
      status: data.status,
      durationMs: data.durationMs,
      source: data.source,
      origin: data.origin,
      miss: data.miss,
      requestHeaders: data.requestHeaders,
      requestBody: data.requestBody,
      responseHeaders: maskHeaders(data.headers),
      responseBody: data.responseBody,
    };
    this.recent.push(served);
    if (this.recent.length > MAX_RECENT) this.recent.shift();
    this.stats.record(served);
    this.logger.request(served);
    this.bus.emit("served", served);
  }

  /** The admin/dashboard view of the running server. */
  state(): ServerState {
    return {
      mode: this.mode.type,
      config: this.config,
      routes: (): RouteInfo[] =>
        this.router.all.map((route) => ({
          name: route.name,
          methods: route.methods,
          path: route.spec.path,
          scenarioStates: route.scenarioStates,
          activeScenario:
            route.scenarioStates.length > 0 ? this.scenarios.get(route.name) : undefined,
        })),
      scenarios: () => this.scenarios.list(),
      setScenario: (routeName, state) => this.scenarios.set(routeName, state),
      reset: () => {
        this.store.reset();
        this.scenarios.reset();
      },
      resources: () =>
        this.store.names().map((name) => ({ name, count: this.store.getItems(name).length })),
      stats: () => this.stats.snapshot(),
      recent: () => [...this.recent],
    };
  }
}

/** Thin wrapper so ScenarioRegistry can validate against the live router. */
class ScenarioRegistryShim {
  private readonly states = new Map<string, string>();
  constructor(private readonly server: MockServer) {}

  get(routeName: string): string | undefined {
    return this.states.get(routeName);
  }

  set(routeName: string, state: string): { ok: boolean; error?: string } {
    const route: PreparedRoute | undefined = this.server.router.find(routeName);
    if (route === undefined) return { ok: false, error: `no route named "${routeName}"` };
    if (route.scenarioStates.length === 0)
      return { ok: false, error: `route "${routeName}" has no scenarios` };
    if (!route.scenarioStates.includes(state)) {
      return {
        ok: false,
        error: `unknown state "${state}" (available: ${route.scenarioStates.join(", ")})`,
      };
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

function truncateBody(text: string | undefined, limit = 2000): string | undefined {
  if (text === undefined) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
