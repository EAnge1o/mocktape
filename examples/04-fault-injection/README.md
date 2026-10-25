# 04 — Fault injection & latency

```bash
mocktape dev examples/04-fault-injection/mocktape.json
```

Everything on this server has global latency of 50–150 ms, and individual
endpoints misbehave probabilistically — perfect for exercising timeouts,
retries, circuit breakers and loading states:

| Route            | Misbehavior                                  |
| ---------------- | -------------------------------------------- |
| `POST /checkout` | healthy (baseline)                           |
| `GET /inventory/:sku` | 30% of responses become 500s            |
| `POST /payments` | 50% of requests hang for 3–5 s               |
| `GET /assets/:file`   | 50% of responses return corrupted bytes |
| `POST /webhooks` | 50% of connections are dropped mid-flight    |

Faults that fire add an `x-mocktape-fault` response header, so test code can
distinguish an injected fault from a real bug.
