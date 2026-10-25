# Record & replay

The tape is mocktape's differentiator: point it at a real API once, then work
offline forever — in coffee shops, CI pipelines, and demos that must not break.

## Record

```bash
mocktape record --upstream https://api.example.com --out cassettes
```

Everything you request through mocktape is proxied and appended to a YAML
cassette. Configured routes and resources still take precedence, so you can
mock the painful parts live while recording the rest.

Ctrl+C stops recording and flushes the cassette:

```yaml
# Mocktape cassette — recorded 2026-10-25T12:00:00.000Z
version: 1
upstream: https://api.example.com
interactions:
  - id: 7f3c...
    request:
      method: GET
      path: /repos/acme/widget
      query: { page: "1" }
      headers: { accept: application/json }
      bodyEncoding: none
    response:
      status: 200
      headers: { content-type: application/json }
      body: { stars: 42 }
      bodyEncoding: json
```

Recording notes:

- Volatile headers (`host`, `authorization`, `cookie`, `user-agent`, ...) are
  **never written** — cassettes are shareable and diff-able.
- Byte-identical duplicate interactions are deduplicated.
- Binary bodies are stored as base64; JSON and text stay readable.

## Replay

```bash
mocktape replay cassettes            # a directory merges every cassette
mocktape replay cassettes/api.yaml   # or a single file
```

Matching normalizes both sides:

- method (case-insensitive)
- path (trailing slash ignored)
- query (key order ignored, values compared exactly)
- body (fingerprinted with sorted keys, so whitespace/key order don't matter)

### Misses are features

An unmatched request returns `404` with the **closest recorded interactions**:

```json
{
  "error": "no route matched this request",
  "method": "GET",
  "path": "/repos/acme/widgit",
  "closest": [
    {
      "method": "GET",
      "path": "/repos/acme/widget",
      "score": 0.94,
      "breakdown": { "method": 1, "path": 0.8, "query": 1, "body": 1 }
    }
  ]
}
```

`breakdown` tells you *which dimension* diverged — a `0` on `query` means the
query string changed; a `0` on `body` means the payload drifted. This is the
fastest way to spot client/server API drift against a recorded tape.

### Update mode

```bash
mocktape replay cassettes --update -u https://api.example.com
```

Serves what matches, proxies what doesn't, and re-records misses into a new
cassette — a rolling refresh of your tape without losing hand-verified data.

## In tests

Replay is also available as a library — see [testing.md](testing.md).
