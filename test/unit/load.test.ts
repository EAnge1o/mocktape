import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findConfigFile, loadConfigFile } from "../../src/config/load.js";
import { ConfigValidationError } from "../../src/config/schema.js";

describe("findConfigFile", () => {
  it("finds the nearest config walking up from a directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mocktape-cfg-"));
    const nested = path.join(root, "a", "b");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, "mocktape.json"), "{}", "utf8");
    expect(findConfigFile(nested)?.toLowerCase()).toBe(
      path.join(root, "mocktape.json").toLowerCase(),
    );
  });

  it("returns undefined when nothing exists up to the root", async () => {
    const isolated = await mkdtemp(path.join(tmpdir(), "mocktape-none-"));
    expect(findConfigFile(isolated)).toBeUndefined();
  });
});

describe("loadConfigFile", () => {
  it("loads and validates JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-json-"));
    const file = path.join(dir, "mocktape.json");
    await writeFile(
      file,
      JSON.stringify({ port: 4000, routes: [{ path: "/x", body: 1 }] }),
      "utf8",
    );
    const { config } = await loadConfigFile(file);
    expect(config.port).toBe(4000);
  });

  it("loads YAML and applies CLI overrides", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-yaml-"));
    const file = path.join(dir, "mocktape.yaml");
    await writeFile(file, "port: 5100\nroutes:\n  - path: /y\n    body: hi\n", "utf8");
    const { config } = await loadConfigFile(file, { port: 6000 });
    expect(config.port).toBe(6000);
    expect(config.routes[0]!.path).toBe("/y");
  });

  it("loads JS configs with default export", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-js-"));
    const file = path.join(dir, "mocktape.config.mjs");
    await writeFile(
      file,
      "export default { port: 7000, routes: [{ path: '/z', body: 'zz' }] };",
      "utf8",
    );
    const { config } = await loadConfigFile(file);
    expect(config.port).toBe(7000);
  });

  it("throws a friendly error for invalid JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-bad-"));
    const file = path.join(dir, "mocktape.json");
    await writeFile(file, "{nope", "utf8");
    await expect(loadConfigFile(file)).rejects.toThrow(ConfigValidationError);
  });

  it("throws when the file does not exist", async () => {
    await expect(loadConfigFile("no/such/file.json")).rejects.toThrow(/not found/);
  });
});
