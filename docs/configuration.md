# Configuration reference

mocktape discovers its config as `mocktape.json` / `mocktape.yaml` / `mocktape.yml`
(or `mocktape.config.*`), walking up from the current directory like `.editorconfig`.
`mocktape init` scaffolds a starter file.

## Top level

| Field        | Type                          | Default              | Description                                                        |
| ------------ | ----------------------------- | -------------------- | ------------------------------------------------------------------ |
| `port`       | number                        | `3000` (CLI default) | API port; `0` picks a random free port                             |
| `host`       | string                        | `127.0.0.1`          | Bind address                                                       |
| `cors`       | boolean                       | `true`               | Permissive CORS + automatic `OPTIONS` preflights                   |
| `latency`    | number \| `[min, max]`        | —                    | Extra latency applied to **every** response (ms)                   |
| `silent`     | boolean                       | `false`              | Suppress request logging                                           |
| `dashboard`  | `{ enabled?, port? }`         | enabled, `port+1`    | Live traffic UI                                                    |
| `tape`       | `{ dir? }`                    | `cassettes`          | Default directory for cassette files                               |
| `upstream`   | string                        | —                    | Fallback proxy target in `dev` mode for unmatched requests         |
| `resources`  | `Record<name, ResourceSpec>`  | `{}`                 | CRUD-backed collections                                            |
| `routes`     | `RouteSpec[]`                 | `[]`                 | Declarative mock routes                                            |

Configs may also be `.js`/`.mjs` files exporting the object (default export).

## RouteSpec

```yaml
name: optional-stable-name        # used by the admin API & dashboard
method: GET                       # string, array of strings, or "*"
path: /users/:id                  # :param and *splat wildcards supported
when:                             # all must match for this route to apply
  query: { dryRun: "true" }
  headers: { x-client: "ios" }
  body: { plan: "pro" }           # structural subset match

# One of the following:
body: { any: "json" }             # objects are JSON; strings stay text
file: fixtures/payload.json       # served from disk, content-type inferred
scenarios:                        # named response variants (see scenarios.md)
  default: { status: 200, body: { ok: true } }
  declined: { status: 402, body: { error: "card_declined" } }

status: 200                       # inline responses
headers: { x-flag: "on" }         # merged into the response
delay: [100, 300]                 # per-route latency (ms), overrides `latency`
fault: { type: "error", rate: 0.3 }
priority: 100                     # shifts the route above similar ones
```

### Match scoring

When several routes match, mocktape picks the most **specific** one:

1. explicit methods beat `method: "*"`
2. static path segments beat `:params`
3. routes with `when` predicates beat plain routes
4. higher `priority` wins over all of the above
5. ties keep config order (first one wins)

## ResourceSpec

```yaml
resources:
  users:
    seed: []                      # initial rows; `structuredClone`d per boot
    idField: id                   # default "id"
    persist: db.json              # optional; mutations are debounced-written
```

Resources expose `GET/POST /users` and `GET/PUT/PATCH/DELETE /users/:id` with
json-server-compatible query params:

| Param            | Example                     | Effect                          |
| ---------------- | --------------------------- | ------------------------------- |
| field equality   | `?role=admin`               | exact match (string-compared)   |
| `id` multi       | `?id=1,2,3`                 | any-of match                    |
| `_ne`            | `?role_ne=admin`            | negated match                   |
| `_like`          | `?name_like=ada`            | case-insensitive substring      |
| `_gte` / `_lte`  | `?age_gte=18`               | numeric comparison              |
| `_sort`,`_order` | `?_sort=age&_order=desc`    | single-field sort               |
| `_page`,`_limit` | `?_page=2&_limit=10`        | pagination (`_limit` also solo) |

## Template expressions

Usable inside `body` strings (JSON objects are rendered recursively):

- Built-ins: `{{ $uuid }}`, `{{ $timestamp }}`, `{{ $isoTimestamp }}`,
  `{{ $randomInt }}`, `{{ $randomFloat }}`, `{{ $randomBoolean }}`
- Request values: `{{ request.path.id }}`, `{{ request.query.page }}`,
  `{{ request.header.x-token }}`, `{{ request.body.user.name }}`

A value that is *exactly one* expression keeps its type (numbers stay
numbers); mixed strings interpolate as text. Unknown expressions resolve to
`""` — they show up in the dashboard instead of leaking into consumers.
