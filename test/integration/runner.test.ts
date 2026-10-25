import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMocktape, type RunningInstance } from "../../src/index.js";
import { waitFor } from "../helpers.js";

const instances: RunningInstance[] = [];
afterAll(async () => {
  await Promise.all(instances.map((instance) => instance.close()));
});

describe("runner (config files & hot reload)", () => {
  it("discovers and serves a config file, then hot-reloads route changes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-hot-"));
    const file = path.join(dir, "mocktape.json");
    const writeConfig = async (payload: unknown): Promise<void> => {
      await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
    };

    await writeConfig({
      port: 0,
      dashboard: { enabled: false },
      routes: [{ name: "one", path: "/one", body: { n: 1 } }],
    });

    const instance = (await runMocktape({
      configPath: file,
      mode: { type: "dev" },
      silent: true,
      watch: true,
    })) as RunningInstance;
    instances.push(instance);

    expect(await (await instance.fetch("/one")).json()).toEqual({ n: 1 });

    await writeConfig({
      port: 0,
      dashboard: { enabled: false },
      routes: [
        { name: "one", path: "/one", body: { n: 2 } },
        { name: "two", path: "/two", body: { n: 2 } },
      ],
    });

    await waitFor(async () => {
      try {
        return (await (await instance.fetch("/two")).status) === 200;
      } catch {
        return false;
      }
    });
    expect(await (await instance.fetch("/one")).json()).toEqual({ n: 2 });
  }, 20_000);
});
