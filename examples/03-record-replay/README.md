# 03 — Record a real API, replay it offline

**Terminal 1** — pretend this is the real API (in real life: your backend, or `https://api.github.com`):

```bash
mocktape dev examples/03-record-replay/upstream.json
```

**Terminal 2** — record traffic through mocktape:

```bash
mocktape record --upstream http://localhost:4100 --out examples/03-record-replay/cassettes
# now hit http://localhost:3000 as if it were the real API:
curl http://localhost:3000/repos/acme/widget
curl http://localhost:3000/repos/acme/widget/issues
# Ctrl+C → writes examples/03-record-replay/cassettes/cassette-*.yaml
```

Kill the upstream, then replay offline:

```bash
mocktape replay examples/03-record-replay/cassettes
curl http://localhost:3000/repos/acme/widget      # identical response, zero network
```

Miss a path? The 404 tells you which recorded interaction was *closest* and
which dimension (method / path / query / body) diverged — that's how you spot
API drift between your client and the tape.

Update the tape in place (serve matches, proxy & re-record misses):

```bash
mocktape replay examples/03-record-replay/cassettes --update -u http://localhost:4100
```

Cassettes are YAML — review them in code review like fixtures.
