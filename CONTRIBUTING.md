# Contributing to mocktape

Thanks for taking the time to contribute! 📼

## Development setup

```bash
git clone https://github.com/EAnge1o/mocktape
cd mocktape
npm install
npm run dev            # run the CLI against examples/01-crud
npm test               # vitest (82 tests)
npm run coverage       # with v8 coverage thresholds
npm run lint           # eslint + prettier
npm run typecheck      # tsc --noEmit
```

PRs must pass `lint`, `typecheck` and `test` on all platforms (CI runs Linux,
Windows and macOS).

## Project layout

```
src/
  config/    zod schema + file loading (JSON / YAML / JS), discovery
  http/      request parsing, CORS, shared types
  server/    matcher (scoring), store (CRUD), scenarios, responder, pipeline
  tape/      record/replay: cassette files, normalization, proxy, similarity
  template/  {{ }} interpolation
  obs/       event bus, logger, stats
  dashboard/ live traffic UI (vanilla JS, no build step)
```

## Ground rules

- **No new runtime dependencies** without discussing the tradeoff first — the
  dependency list is deliberately short.
- The mock server is built directly on `node:http`; keep it that way.
- Every bug fix needs a test that fails before the fix.
- Public API changes (config schema, CLI flags, exports) need a docs update.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/) —
`feat:`, `fix:`, `docs:`, `test:`, `chore:` — releases are automated from
commit messages with release-please.

## Reporting bugs

Open an issue with the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml).
A minimal repro (config + failing request) makes fixes dramatically faster.
