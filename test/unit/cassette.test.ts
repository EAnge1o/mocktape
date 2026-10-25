import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  encodeBody,
  decodeBody,
  writeCassette,
  readCassette,
  loadCassettes,
  type Cassette,
} from "../../src/tape/cassette.js";
import { CassetteWriter } from "../../src/tape/recorder.js";
import {
  normalizePath,
  canonicalQuery,
  filterHeaders,
  interactionKey,
} from "../../src/tape/normalize.js";
import { ReplayMatcher } from "../../src/tape/replay.js";
import type { RequestContext } from "../../src/http/types.js";
import type { RecordedInteraction } from "../../src/tape/cassette.js";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return { method: "GET", path: "/a", query: {}, headers: {}, rawBody: undefined, ...overrides };
}

describe("encodeBody / decodeBody", () => {
  it("roundtrips JSON bodies as parsed JSON", () => {
    const encoded = encodeBody(
      Buffer.from(JSON.stringify({ a: 1 })),
      "application/json; charset=utf-8",
    );
    expect(encoded.bodyEncoding).toBe("json");
    expect(decodeBody(encoded.body, encoded.bodyEncoding).toString()).toBe('{"a":1}');
  });

  it("keeps text as text and binary as base64", () => {
    expect(encodeBody(Buffer.from("plain"), "text/plain").bodyEncoding).toBe("text");
    expect(encodeBody(Buffer.from([0, 1, 2, 255]), "application/octet-stream").bodyEncoding).toBe(
      "base64",
    );
  });

  it("marks empty bodies as none", () => {
    expect(encodeBody(Buffer.alloc(0), "application/json")).toEqual({ bodyEncoding: "none" });
    expect(encodeBody(undefined, undefined)).toEqual({ bodyEncoding: "none" });
  });

  it("falls back to text when JSON content-type has invalid JSON", () => {
    const encoded = encodeBody(Buffer.from("{broken"), "application/json");
    expect(encoded.bodyEncoding).toBe("text");
  });
});

describe("normalize", () => {
  it("strips trailing slashes and canonicalizes queries", () => {
    expect(normalizePath("/a/b/")).toBe("/a/b");
    expect(canonicalQuery({ b: "2", a: "1" })).toBe("a=1&b=2");
  });

  it("filters volatile headers", () => {
    const filtered = filterHeaders({
      Host: "x",
      "content-length": "5",
      accept: "json",
      cookie: "c",
    });
    expect(filtered).toEqual({ accept: "json" });
  });

  it("builds stable interaction keys across formatting differences", () => {
    const a = interactionKey({
      method: "GET",
      path: "/x/",
      query: { a: "1", b: "2" },
      body: undefined,
    });
    const b = interactionKey({ method: "GET", path: "/x", query: { b: "2", a: "1" }, body: null });
    expect(a).toBe(b);
  });
});

describe("cassette files", () => {
  it("roundtrips through YAML on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-cassette-"));
    const file = path.join(dir, "test.yaml");
    const cassette: Cassette = {
      version: 1,
      recordedAt: new Date().toISOString(),
      upstream: "https://api.example.com",
      interactions: [
        {
          id: "i-1",
          request: {
            method: "GET",
            path: "/users",
            query: {},
            headers: { accept: "json" },
            bodyEncoding: "none",
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: [{ id: 1 }],
            bodyEncoding: "json",
          },
        },
      ],
    };
    await writeCassette(file, cassette);
    const loaded = await readCassette(file);
    expect(loaded.interactions).toHaveLength(1);
    expect(loaded.interactions[0]!.response.body).toEqual([{ id: 1 }]);
    const onDisk = await readFile(file, "utf8");
    expect(onDisk).toContain("# Mocktape cassette");
  });

  it("loads every cassette in a directory, merged", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-cassette-dir-"));
    for (const name of ["one.yaml", "two.yaml"]) {
      await writeCassette(path.join(dir, name), {
        version: 1,
        recordedAt: new Date().toISOString(),
        interactions: [
          {
            id: name,
            request: {
              method: "GET",
              path: `/${name}`,
              query: {},
              headers: {},
              bodyEncoding: "none",
            },
            response: { status: 200, headers: {}, bodyEncoding: "none" },
          },
        ],
      });
    }
    await mkdir(path.join(dir, "sub"), { recursive: true });
    const { cassette, files } = await loadCassettes(dir);
    expect(files).toHaveLength(2);
    expect(cassette.interactions).toHaveLength(2);
  });

  it("deduplicates identical recorded interactions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-writer-"));
    const writer = new CassetteWriter(path.join(dir, "c.yaml"), "https://up.test");
    const request = ctx({ path: "/dup" });
    const response = {
      status: 200,
      headers: { "content-type": "application/json" },
      raw: Buffer.from('{"ok":true}'),
    };
    await writer.record(request, response);
    await writer.record(request, response);
    expect(writer.count).toBe(1);
    await writer.flush();
    const loaded = await readCassette(path.join(dir, "c.yaml"));
    expect(loaded.interactions).toHaveLength(1);
    expect(loaded.upstream).toBe("https://up.test");
  });
});

describe("ReplayMatcher", () => {
  const interactions: RecordedInteraction[] = [
    {
      id: "1",
      request: {
        method: "GET",
        path: "/users/1",
        query: { full: "true" },
        headers: {},
        bodyEncoding: "none" as const,
      },
      response: { status: 200, headers: {}, body: { id: 1 }, bodyEncoding: "json" as const },
    },
    {
      id: "2",
      request: {
        method: "POST",
        path: "/users",
        query: {},
        headers: {},
        body: { name: "ada" },
        bodyEncoding: "json" as const,
      },
      response: { status: 201, headers: {}, body: { id: 2 }, bodyEncoding: "json" as const },
    },
  ];

  it("hits on method + path + query + body", () => {
    const matcher = new ReplayMatcher(interactions);
    const hit = matcher.match(
      ctx({
        method: "POST",
        path: "/users",
        rawBody: Buffer.from(JSON.stringify({ name: "ada" })),
        body: { name: "ada" },
      }),
    );
    expect(hit.type).toBe("hit");
    if (hit.type === "hit") expect(hit.interaction.id).toBe("2");
  });

  it("misses and reports closest with scores", () => {
    const matcher = new ReplayMatcher(interactions);
    const miss = matcher.match(ctx({ path: "/users/2" }));
    expect(miss.type).toBe("miss");
    if (miss.type === "miss") {
      expect(miss.closest[0]!.interaction.id).toBe("1");
      expect(miss.closest[0]!.similarity.score).toBeGreaterThan(0);
    }
  });
});
