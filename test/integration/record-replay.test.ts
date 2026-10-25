import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { boot, json } from "../helpers.js";
import { createMocktape, type RunningInstance } from "../../src/index.js";

const instances: RunningInstance[] = [];
async function track<T extends RunningInstance>(promise: Promise<T>): Promise<T> {
  const instance = await promise;
  instances.push(instance);
  return instance;
}

afterAll(async () => {
  await Promise.all(instances.map((instance) => instance.close()));
});

async function recordCassette(): Promise<{ file: string; upstream: RunningInstance }> {
  const upstream = await track(
    boot({
      resources: {
        users: {
          seed: [
            { id: 1, name: "Ada" },
            { id: 2, name: "Alan" },
          ],
        },
      },
      routes: [{ path: "/status", body: { ok: true, version: 1 } }],
    }),
  );

  const dir = await mkdtemp(path.join(tmpdir(), "mocktape-record-"));
  const file = path.join(dir, "api.yaml");

  const recorder = await track(
    createMocktape({
      mode: { type: "record", upstream: upstream.url, cassettePath: file },
      dashboard: false,
    }),
  );

  await recorder.fetch("/status");
  await recorder.fetch("/users?_limit=1");
  await recorder.fetch("/users/2");
  await recorder.fetch("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Grace" }),
  });
  await recorder.fetch("/missing");
  await recorder.close();

  const text = await readFile(file, "utf8");
  expect(text).toContain("interactions:");
  return { file, upstream };
}

describe("record & replay roundtrip", () => {
  it("replays recorded interactions offline with identical responses", async () => {
    const { file, upstream } = await recordCassette();
    await upstream.close();

    const replayer = await track(
      createMocktape({ mode: { type: "replay" }, tape: file, dashboard: false }),
    );

    // exact replay: status endpoint
    const status = await json<{ ok: boolean; version: number }>(await replayer.fetch("/status"));
    expect(status).toEqual({ ok: true, version: 1 });

    // query params are part of the match
    const list = await json<unknown[]>(await replayer.fetch("/users?_limit=1"));
    expect(list).toHaveLength(1);

    // single resource + mutation replay
    expect(await json<{ name: string }>(await replayer.fetch("/users/2"))).toEqual({
      id: 2,
      name: "Alan",
    });
    expect(
      await json<{ id: number; name: string }>(
        await replayer.fetch("/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Grace" }),
        }),
      ),
    ).toEqual({ id: 3, name: "Grace" });
  }, 20_000);

  it("explains replay misses with the closest recorded interaction", async () => {
    const { file } = await recordCassette();
    const replayer = await track(
      createMocktape({ mode: { type: "replay" }, tape: file, dashboard: false }),
    );

    expect((await replayer.fetch("/status")).status).toBe(200); // a replay hit first
    const response = await replayer.fetch("/status?verbose=true"); // query mismatch
    expect(response.status).toBe(404);
    const body = await json<{ closest: Array<{ path: string; score: number }> }>(response);
    expect(body.closest[0]!.path).toBe("/status");
    expect(body.closest[0]!.score).toBeGreaterThan(0.5);

    const stats = await json<{ bySource: Record<string, number> }>(
      await replayer.fetch("/__mocktape__/stats"),
    );
    expect(stats.bySource["miss"]).toBeGreaterThan(0);
    expect(stats.bySource["replay"]).toBeGreaterThan(0);
  }, 20_000);

  it("passes unmatched requests through to the upstream in update mode and re-records them", async () => {
    const { file, upstream } = await recordCassette();

    const updateDir = await mkdtemp(path.join(tmpdir(), "mocktape-update-"));
    const updateFile = path.join(updateDir, "api.yaml");
    const replayer = await track(
      createMocktape({
        mode: { type: "replay", passthrough: { upstream: upstream.url, cassettePath: updateFile } },
        tape: file,
        dashboard: false,
      }),
    );

    // recorded request → served from tape
    expect(await json<{ ok: boolean }>(await replayer.fetch("/status"))).toEqual({
      ok: true,
      version: 1,
    });
    // new request → proxied to upstream and recorded into the update cassette
    const fresh = await replayer.fetch("/users/1");
    expect(await json<{ name: string }>(fresh)).toEqual({ id: 1, name: "Ada" });
    await replayer.close();

    const updateCassette = await readFile(updateFile, "utf8");
    expect(updateCassette).toContain("/users/1");
  }, 25_000);

  it("still serves configured routes on top of a cassette in replay mode", async () => {
    const { file } = await recordCassette();
    const replayer = await track(
      createMocktape({
        mode: { type: "replay" },
        tape: file,
        dashboard: false,
        config: { routes: [{ path: "/local", body: { local: true } }] },
      }),
    );
    expect(await json<{ local: boolean }>(await replayer.fetch("/local"))).toEqual({ local: true });
  }, 20_000);
});
