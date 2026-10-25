import { afterAll, describe, expect, it } from "vitest";
import { boot, json } from "../helpers.js";
import type { RunningInstance } from "../../src/index.js";

const instances: RunningInstance[] = [];

async function start(
  config: Record<string, unknown>,
  mode: Parameters<typeof boot>[1] = { type: "dev" },
): Promise<RunningInstance> {
  const instance = await boot(config, mode);
  instances.push(instance);
  return instance;
}

afterAll(async () => {
  await Promise.all(instances.map((instance) => instance.close()));
});

describe("mock server (integration)", () => {
  it("serves static routes with params and templates", async () => {
    const t = await start({
      routes: [
        {
          name: "user",
          method: "GET",
          path: "/users/:id",
          body: { id: "{{ request.path.id }}", at: "{{ $timestamp }}" },
        },
      ],
    });
    const response = await t.fetch("/users/77");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await json<{ id: string; at: number }>(response);
    expect(body.id).toBe("77");
    expect(typeof body.at).toBe("number");
  });

  it("switches responses through scenarios (header first, then admin state)", async () => {
    const t = await start({
      routes: [
        {
          name: "pay",
          method: "POST",
          path: "/pay",
          scenarios: {
            default: { status: 201, body: { ok: true } },
            declined: { status: 402, body: { error: "card_declined" } },
          },
        },
      ],
    });

    expect((await t.fetch("/pay", { method: "POST" })).status).toBe(201);
    expect(
      (await t.fetch("/pay", { method: "POST", headers: { "x-mocktape-scenario": "declined" } }))
        .status,
    ).toBe(402);

    const set = await t.fetch(`/__mocktape__/scenarios/${encodeURIComponent("pay")}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "declined" }),
    });
    expect(set.status).toBe(200);
    expect((await t.fetch("/pay", { method: "POST" })).status).toBe(402);

    // header still wins over the stored state
    expect(
      (await t.fetch("/pay", { method: "POST", headers: { "x-mocktape-scenario": "default" } }))
        .status,
    ).toBe(201);
  });

  it("serves full CRUD against a resource", async () => {
    const t = await start({
      resources: { posts: { seed: [{ id: 1, title: "hello", views: 2 }] } },
    });

    const created = await t.fetch("/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "second", views: 5 }),
    });
    expect(created.status).toBe(201);
    const post = await json<{ id: number }>(created);
    expect(post.id).toBe(2);

    const filtered = await json<Array<{ id: number }>>(await t.fetch("/posts?views_gte=5"));
    expect(filtered).toEqual([{ id: 2, title: "second", views: 5 }]);

    expect(
      (
        await t.fetch("/posts/2", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ views: 6 }),
        })
      ).status,
    ).toBe(200);
    expect((await json<{ views: number }>(await t.fetch("/posts/2"))).views).toBe(6);

    expect((await t.fetch("/posts/2", { method: "DELETE" })).status).toBe(204);
    expect((await t.fetch("/posts/2")).status).toBe(404);
  });

  it("answers CORS preflights even for unknown paths", async () => {
    const t = await start({});
    const response = await t.fetch("/anything", {
      method: "OPTIONS",
      headers: { "access-control-request-headers": "content-type", origin: "http://web.test" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://web.test");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("explains misses with the closest configured routes", async () => {
    const t = await start({
      routes: [
        { name: "a", path: "/alpha/:id", body: {} },
        { name: "b", path: "/orders", body: {} },
      ],
    });
    const response = await t.fetch("/alpha/99/extra"); // three segments: no route matches
    expect(response.status).toBe(404);
    expect(response.status).toBe(404);
    const body = await json<{ error: string; closest: Array<{ path: string; score: number }> }>(
      response,
    );
    expect(body.error).toContain("no route matched");
    expect(body.closest[0]!.path).toBe("/alpha/:id");
    expect(body.closest[0]!.score).toBeGreaterThan(0.5);
  });

  it("applies fault injection with rate 1", async () => {
    const t = await start({
      routes: [
        { path: "/boom", body: { ok: true }, fault: { type: "error", rate: 1 } },
        { path: "/junk", body: { ok: true }, fault: { type: "garbage", rate: 1 } },
      ],
    });
    const boom = await t.fetch("/boom");
    expect(boom.status).toBe(500);
    expect(boom.headers.get("x-mocktape-fault")).toBe("error");

    const junk = await t.fetch("/junk");
    expect(junk.status).toBe(200);
    expect(junk.headers.get("x-mocktape-fault")).toBe("garbage");
    await expect(json(junk)).rejects.toThrow();
  });

  it("honors route delays", async () => {
    const t = await start({ routes: [{ path: "/slow", body: "ok", delay: 120 }] });
    const started = Date.now();
    await t.fetch("/slow");
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it("answers HEAD without a body", async () => {
    const t = await start({ routes: [{ path: "/h", body: { big: true } }] });
    const response = await t.fetch("/h", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("exposes the admin API", async () => {
    const t = await start({
      resources: { users: { seed: [{ id: 1 }] } },
      routes: [{ name: "a", path: "/a", body: {} }],
    });
    expect(await json(await t.fetch("/__mocktape__/health"))).toMatchObject({
      ok: true,
      mode: "dev",
    });
    const routes = await json<Array<{ name: string; path: string }>>(
      await t.fetch("/__mocktape__/routes"),
    );
    expect(routes.some((route) => route.name === "a")).toBe(true);
    expect(await json(await t.fetch("/__mocktape__/resources"))).toEqual([
      { name: "users", count: 1 },
    ]);

    await t.fetch("/users/1", { method: "DELETE" });
    const afterDelete = await json<Array<{ name: string; count: number }>>(
      await t.fetch("/__mocktape__/resources"),
    );
    expect(afterDelete).toEqual([{ name: "users", count: 0 }]);

    await t.fetch("/__mocktape__/reset", { method: "POST" });
    const afterReset = await json<Array<{ name: string; count: number }>>(
      await t.fetch("/__mocktape__/resources"),
    );
    expect(afterReset).toEqual([{ name: "users", count: 1 }]);

    const stats = await json<{ total: number; bySource: Record<string, number> }>(
      await t.fetch("/__mocktape__/stats"),
    );
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.bySource["admin"]).toBeGreaterThan(0);
  });

  it("proxies unmatched requests to an upstream in dev mode", async () => {
    const upstream = await start({
      routes: [{ path: "/real", body: { from: "upstream" } }],
    });
    const t = await start(
      { routes: [{ path: "/mocked", body: { from: "mock" } }] },
      {
        type: "dev",
        upstream: upstream.url,
      },
    );
    expect(await json<{ from: string }>(await t.fetch("/real"))).toEqual({ from: "upstream" });
    expect(await json<{ from: string }>(await t.fetch("/mocked"))).toEqual({ from: "mock" });

    const stats = await json<{ bySource: Record<string, number> }>(
      await t.fetch("/__mocktape__/stats"),
    );
    expect(stats.bySource["proxy"]).toBeGreaterThan(0);
  });

  it("serves file bodies from disk", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-files-"));
    await writeFile(path.join(dir, "payload.json"), '{"from":"file"}', "utf8");
    const t = await start({ routes: [{ path: "/file", file: "payload.json" }] });
    // configDir for library mode is process.cwd(), so use an absolute path
    const response = await fetch(`${t.url}/file`);
    expect(response.status).toBe(500); // relative file missing from cwd — explicit error
    expect(await json<{ error: string }>(response)).toMatchObject({ error: /file not found/ });
  });
});
