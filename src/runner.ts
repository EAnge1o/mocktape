import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { MocktapeConfig } from "./config/schema.js";
import { findConfigFile, loadConfigFile, loadConfig } from "./config/load.js";
import { DashboardServer } from "./dashboard/server.js";
import { EventBus } from "./obs/bus.js";
import type { EventBus as EventBusType } from "./obs/bus.js";
import { createLogger, type Logger } from "./obs/logger.js";
import type { ServerMode } from "./server/server.js";
import { MockServer } from "./server/server.js";
import { ReplayMatcher } from "./tape/replay.js";
import { loadCassettes } from "./tape/cassette.js";

export interface RunOptions {
  /** Inline config (library mode). Takes precedence over `configPath`. */
  config?: Partial<MocktapeConfig>;
  /** Explicit config file path. Defaults to discovery from the working directory. */
  configPath?: string;
  mode: ServerMode;
  /** Cassette file or directory (replay mode). */
  tape?: string;
  port?: number;
  host?: string;
  dashboard?: boolean;
  dashboardPort?: number;
  cors?: boolean;
  latency?: number | [number, number];
  silent?: boolean;
  /** Watch the config file and hot-reload routes (default: true for file configs). */
  watch?: boolean;
}

export interface RunningInstance {
  server: MockServer;
  logger: Logger;
  url: string;
  dashboardUrl: string | undefined;
  setScenario(routeName: string, state: string): { ok: boolean; error?: string };
  reset(): void;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

/**
 * Orchestrates a full mocktape process: config resolution, the mock server,
 * the optional dashboard and config hot-reload. Used by the CLI and directly
 * by consumers who embed mocktape in tests.
 */
export async function runMocktape(options: RunOptions): Promise<RunningInstance> {
  const logger = createLogger({ silent: options.silent ?? false });
  const bus: EventBusType = new EventBus();

  let config: MocktapeConfig;
  let configDir: string;
  let configFilePath: string | undefined;

  if (options.config !== undefined) {
    config = loadConfig({
      ...options.config,
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
      ...(options.cors !== undefined ? { cors: options.cors } : {}),
      ...(options.latency !== undefined ? { latency: options.latency } : {}),
      ...(options.silent !== undefined ? { silent: options.silent } : {}),
    });
    configDir = process.cwd();
  } else {
    const discovered = options.configPath ?? findConfigFile();
    if (discovered === undefined) {
      logger.warn(
        "no mocktape config found — serving an empty mock. Run `mocktape init` to create one.",
      );
      config = loadConfig(baseConfig(options));
      configDir = process.cwd();
    } else {
      const loaded = await loadConfigFile(discovered, baseConfig(options));
      config = loaded.config;
      configDir = path.dirname(discovered);
      configFilePath = discovered;
      logger.info(`config: ${discovered}`);
    }
  }

  const server = new MockServer({
    config,
    configDir,
    mode: options.mode,
    logger,
    bus,
  });

  if (options.mode.type === "replay") {
    if (options.tape === undefined)
      throw new Error("replay mode requires a cassette file or directory (--tape)");
    const { cassette, files } = await loadCassettes(options.tape);
    server.setTape(new ReplayMatcher(cassette.interactions));
    logger.info(`tape: ${cassette.interactions.length} interactions from ${files.length} file(s)`);
  }

  await server.start();

  let dashboard: DashboardServer | undefined;
  const dashboardEnabled = options.dashboard ?? config.dashboard.enabled;
  if (dashboardEnabled) {
    dashboard = new DashboardServer({
      port: options.dashboardPort ?? config.dashboard.port ?? server.port + 1,
      host: options.host ?? config.host,
      bus,
      state: () => server.state(),
    });
    try {
      await dashboard.start();
      logger.info(`dashboard: ${dashboard.url}`);
    } catch (error) {
      logger.warn(`dashboard unavailable: ${(error as Error).message}`);
      await dashboard.stop().catch(() => {});
      dashboard = undefined;
    }
  }

  let watcher: FSWatcher | undefined;
  let reloadTimer: NodeJS.Timeout | undefined;
  const shouldWatch =
    (options.watch ?? true) && configFilePath !== undefined && options.mode.type !== "replay";
  if (shouldWatch && configFilePath !== undefined) {
    watcher = chokidar.watch(configFilePath, { ignoreInitial: true });
    watcher.on("change", () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        void loadConfigFile(configFilePath!, baseConfig(options))
          .then((loaded) => server.applyConfig(loaded.config))
          .catch((error) => logger.error(`reload failed: ${(error as Error).message}`));
      }, 150);
    });
  }

  const close = async (): Promise<void> => {
    clearTimeout(reloadTimer);
    await watcher?.close();
    await dashboard?.stop();
    await server.stop();
    if (options.mode.type === "record" && server.recorderInteractions.length > 0) {
      logger.info(
        `📼 recorded ${server.recorderInteractions.length} interactions → ${options.mode.cassettePath}`,
      );
    }
  };

  return {
    server,
    logger,
    url: server.url,
    dashboardUrl: dashboard?.url,
    setScenario: (routeName, state) => server.setScenario(routeName, state),
    reset: () => server.state().reset(),
    fetch: (path, init) => fetch(`${server.url}${path}`, init),
    close,
  };
}

function baseConfig(options: RunOptions): Partial<MocktapeConfig> {
  return {
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.cors !== undefined ? { cors: options.cors } : {}),
    ...(options.latency !== undefined ? { latency: options.latency } : {}),
    ...(options.silent !== undefined ? { silent: options.silent } : {}),
  };
}

/**
 * Library entry point with test-friendly defaults: silent, no dashboard, a
 * random free port, and no file watching. Perfect for spinning up next to a
 * test suite and tearing down afterwards.
 */
export async function createMocktape(
  options: Partial<Omit<RunOptions, "mode">> & { mode?: ServerMode } = {},
): Promise<RunningInstance> {
  return runMocktape({
    ...options,
    mode: options.mode ?? { type: "dev" },
    port: options.port ?? 0,
    silent: options.silent ?? true,
    dashboard: options.dashboard ?? false,
    watch: options.watch ?? false,
  });
}
