# 02 — Static routes, scenarios & templates

```bash
mocktape dev examples/02-static-and-scenarios/mocktape.yaml
```

## Scenario switching

Flip the `login` route between states three ways:

```bash
# 1. per-request header (great in tests)
curl -i -X POST localhost:3000/auth/login \
  -H 'x-mocktape-scenario: bad-password' -d '{}'

# 2. admin API (server-wide)
curl -X PUT localhost:3000/__mocktape__/scenarios/login \
  -H 'content-type: application/json' \
  -d '{"state": "locked"}'

# 3. dashboard → Scenarios panel
```

## Predicates

`GET /search?type=users` hits the first route (it has a `when` clause and
predicates beat plain routes); any other query falls through to the second.
