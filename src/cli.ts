import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import pc from "picocolors";
import { runMocktape, type RunOptions } from "./runner.js";
import { CONFIG_BASENAMES } from "./config/load.js";

function readVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return (
    JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version: string }
  ).version;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError("port must be an integer between 1 and 65535");
  }
  return port;
}

function parseLatency(value: string): number | [number, number] {
  const parts = value.split("-").map(Number);
  if (
    parts.length === 2 &&
    parts.every((n) => Number.isFinite(n) && n >= 0) &&
    parts[0]! <= parts[1]!
  ) {
    return [parts[0]!, parts[1]!];
  }
  const single = Number(value);
  if (Number.isFinite(single) && single >= 0) return single;
  throw new InvalidArgumentError("latency must be <ms> or <min>-<max>");
}

/**
 * Collect only explicitly-provided server flags, so CLI defaults never
 * override values from the config file.
 */
function collectServerOptions(command: Command): Partial<RunOptions> {
  const opts = command.opts() as {
    port?: number;
    host?: string;
    dashboard?: boolean;
    dashboardPort?: number;
    cors?: boolean;
    latency?: number | [number, number];
    silent?: boolean;
  };
  const explicit = (name: string): boolean => {
    try {
      return command.getOptionValueSource(name) !== "default";
    } catch {
      return false;
    }
  };
  return {
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    ...(opts.host !== undefined ? { host: opts.host } : {}),
    ...(explicit("dashboard") ? { dashboard: opts.dashboard } : {}),
    ...(opts.dashboardPort !== undefined ? { dashboardPort: opts.dashboardPort } : {}),
    ...(explicit("cors") ? { cors: opts.cors } : {}),
    ...(explicit("latency") ? { latency: opts.latency } : {}),
    ...(explicit("silent") ? { silent: opts.silent } : {}),
  };
}

function addServerOptions(command: Command): Command {
  return command
    .option("-p, --port <number>", "port for the mock API", parsePort)
    .option("--host <host>", "host to bind (default 127.0.0.1)")
    .option("--no-dashboard", "disable the live dashboard")
    .option(
      "--dashboard-port <number>",
      "port for the dashboard (default: API port + 1)",
      parsePort,
    )
    .option("--no-cors", "disable permissive CORS headers")
    .option("--latency <spec>", "global latency in ms, or <min>-<max>", parseLatency)
    .option("--silent", "suppress request logging");
}

type RunningInstance = Awaited<ReturnType<typeof runMocktape>>;

async function keepAlive(instance: RunningInstance, summary: () => void): Promise<void> {
  summary();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await instance.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function printUrls(instance: RunningInstance): void {
  console.log(pc.dim("  API   ") + pc.bold(instance.url));
  if (instance.dashboardUrl !== undefined)
    console.log(pc.dim("  Web   ") + pc.bold(instance.dashboardUrl));
  console.log(pc.dim("  Admin ") + `${instance.url}/__mocktape__/health`);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("mocktape")
    .description("📼 Mock APIs from a single file. Record real ones. Replay anywhere.")
    .version(readVersion());

  addServerOptions(
    program
      .command("dev")
      .argument("[config]", "path to a mocktape config (default: discover mocktape.json / .yaml)")
      .description("serve mocks from a config file with hot reload"),
  ).action(async (config: string | undefined, _options: object, command: Command) => {
    const instance = await runMocktape({
      ...collectServerOptions(command),
      configPath: config,
      mode: { type: "dev" },
    });
    await keepAlive(instance, () => printUrls(instance));
  });

  addServerOptions(
    program
      .command("record")
      .argument(
        "[config]",
        "optional config file; configured routes take precedence over the proxy",
      )
      .requiredOption("-u, --upstream <url>", "upstream API to record from")
      .option("--out <dir>", "directory for cassettes", "cassettes")
      .option("--name <file>", "cassette file name (default: cassette-<timestamp>.yaml)")
      .description("proxy an upstream API and record every interaction into a cassette")
      .addHelpText("after", "\nThen replay offline: mocktape replay <cassette>"),
  ).action(
    async (
      config: string | undefined,
      options: { upstream: string; out: string; name?: string },
      command: Command,
    ) => {
      const cassettePath = path.join(
        options.out,
        options.name ?? `cassette-${new Date().toISOString().replace(/[:.]/g, "-")}.yaml`,
      );
      const instance = await runMocktape({
        ...collectServerOptions(command),
        configPath: config,
        mode: { type: "record", upstream: options.upstream, cassettePath },
      });
      await keepAlive(instance, () => {
        console.log(pc.dim("  Recording from ") + pc.bold(options.upstream));
        console.log(pc.dim("  Cassette  ") + pc.bold(cassettePath));
        printUrls(instance);
        console.log(pc.dim("  Hit Ctrl+C when you have captured the traffic you need."));
      });
    },
  );

  addServerOptions(
    program
      .command("replay")
      .argument("[tape]", "cassette file or directory (default: ./cassettes)")
      .option("--update", "serve what matches; proxy and re-record misses")
      .option(
        "-u, --upstream <url>",
        "upstream used with --update (default: the recorded upstream)",
      )
      .description("serve a recorded cassette offline")
      .addHelpText(
        "after",
        "\nMissed requests return 404 with the closest recorded match — great for spotting drift.",
      ),
  ).action(
    async (
      tape: string | undefined,
      options: { update?: boolean; upstream?: string },
      command: Command,
    ) => {
      const target = tape ?? "cassettes";
      if (!existsSync(target)) {
        console.error(pc.red(`✖ cassette not found: ${target}`));
        process.exitCode = 1;
        return;
      }
      let passthrough: { upstream: string; cassettePath: string } | undefined;
      if (options.update === true) {
        if (options.upstream === undefined) {
          console.error(pc.red("✖ --update needs an upstream: pass -u <url>"));
          process.exitCode = 1;
          return;
        }
        passthrough = {
          upstream: options.upstream,
          cassettePath: path.join(path.dirname(target), `cassette-update-${Date.now()}.yaml`),
        };
      }
      const instance = await runMocktape({
        ...collectServerOptions(command),
        tape: target,
        mode: { type: "replay", passthrough },
      });
      await keepAlive(instance, () => {
        console.log(pc.dim("  Replaying ") + pc.bold(target));
        printUrls(instance);
      });
    },
  );

  program
    .command("init")
    .description("scaffold an example mocktape.json")
    .action(async () => {
      const { writeFileSync } = await import("node:fs");
      const target = path.resolve("mocktape.json");
      if (existsSync(target)) {
        console.log(pc.yellow("⚠ mocktape.json already exists — leaving it alone."));
        return;
      }
      writeFileSync(target, INIT_EXAMPLE, "utf8");
      console.log(`✅ created ${pc.bold("mocktape.json")}`);
      console.log(pc.dim("\nNext steps:"));
      console.log(`  ${pc.cyan("mocktape dev")}            # serve on http://localhost:3000`);
      console.log(`  ${pc.cyan("mocktape dev --help")}      # all server options`);
      console.log(
        `  ${pc.cyan("mocktape record --help")}   # capture a real API for offline replay`,
      );
    });

  if (process.argv.slice(2).length === 0) {
    const hasConfig = CONFIG_BASENAMES.some((name) => existsSync(path.resolve(name)));
    if (hasConfig) process.argv.push("dev");
    else program.help();
  }

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv);
}

const INIT_EXAMPLE = `{
  "port": 3000,
  "dashboard": { "enabled": true },
  "resources": {
    "users": {
      "seed": [
        { "id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "role": "admin" },
        { "id": 2, "name": "Alan Turing", "email": "alan@example.com", "role": "user" }
      ]
    }
  },
  "routes": [
    {
      "name": "user profile",
      "method": "GET",
      "path": "/users/:id/profile",
      "body": {
        "userId": "{{ request.path.id }}",
        "avatar": "https://cdn.example.com/{{ $uuid }}.png"
      }
    },
    {
      "name": "payments",
      "method": "POST",
      "path": "/payments",
      "scenarios": {
        "default": { "status": 201, "body": { "id": "{{ $uuid }}", "state": "approved" } },
        "declined": { "status": 402, "body": { "error": "card_declined" } }
      }
    },
    {
      "name": "slow report",
      "method": "GET",
      "path": "/reports",
      "delay": [200, 600],
      "body": { "generatedAt": "{{ $isoTimestamp }}" }
    }
  ]
}
`;
