# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are managed
by [release-please](https://github.com/googleapis/release-please) from
Conventional Commits.

## 1.0.0 — 2026-10-25

Initial release.

### Added

- `mocktape dev`: declarative mock server with static routes (params, `when`
  predicates, specificity scoring), json-server-compatible CRUD resources
  (filters, `_sort`/`_page`/`_limit`), `{{ }}` templates, per-request and
  admin-controlled scenario states, fault injection (`latency` / `error` /
  `garbage` / `reset`), global latency, CORS, and config hot reload.
- `mocktape record`: upstream proxy that captures request/response pairs into
  deduplicated YAML cassettes with volatile headers stripped.
- `mocktape replay`: offline cassette playback with normalized matching and
  closest-match diagnostics (per-dimension similarity breakdown) on misses,
  plus `--update` passthrough re-recording.
- Live traffic dashboard (WebSocket) with miss diagnostics and a scenario
  switcher.
- Admin control plane under `/__mocktape__/*` (health, routes, scenarios,
  reset, resources, stats, recent).
- Library mode: `createMocktape()` for integration tests with test-friendly
  defaults.
- 82 unit/integration tests, 85%+ enforced coverage, CI matrix
  (Linux/macOS/Windows × Node 20/22/24), release-please + npm publish
  workflow.
