# Scenarios & fault injection

## Scenarios

A route with `scenarios` serves different responses per named state:

```json
{
  "name": "payments",
  "method": "POST",
  "path": "/payments",
  "scenarios": {
    "default": { "status": 201, "body": { "state": "approved" } },
    "declined": { "status": 402, "body": { "error": "card_declined" } }
  }
}
```

Switch states three ways, in priority order:

1. **Per-request header** — wins over everything, ideal for tests:

   ```bash
   curl -H 'x-mocktape-scenario: declined' -X POST localhost:3000/payments
   ```

2. **Admin API** — server-wide state:

   ```bash
   curl -X PUT localhost:3000/__mocktape__/scenarios/payments \
     -H 'content-type: application/json' -d '{"state": "declined"}'

   curl localhost:3000/__mocktape__/scenarios   # inspect current states
   ```

3. **Dashboard** — the Scenarios panel lists every scenario route with a
   dropdown; flipping it calls the admin API for you.

> A route with `scenarios` and no `default` key fails loudly (HTTP 422 with an
> explanation) rather than silently returning something wrong.

## Fault injection

Simulate an unreliable world so your timeouts, retries, circuit breakers and
skeletons get exercised *before* production finds them.

```json
{
  "path": "/inventory/:sku",
  "body": { "stock": 7 },
  "fault": { "type": "error", "rate": 0.3 }
}
```

| Type      | Effect                                            |
| --------- | ------------------------------------------------- |
| `latency` | adds `latencyMs` (default 1500) before responding |
| `error`   | responds `500` with a JSON error body             |
| `garbage` | responds 200 with corrupted bytes                 |
| `reset`   | destroys the connection mid-flight                |

`rate` is the probability in `[0, 1]` (default 1 = always). Faults add an
`x-mocktape-fault: <type>` response header when they fire, so test
assertions can distinguish injected chaos from actual bugs.

Global latency belongs on the top-level `latency` field:

```json
{ "latency": [50, 150] }
```

## Resetting state

`POST /__mocktape__/reset` restores every resource to its seed and all
scenario states to `default` — handy between test cases.
