# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |

## Reporting a vulnerability

Please do **not** open a public issue for security reports.

Email the maintainers via GitHub Security Advisories
(**Security → Report a vulnerability** on this repository) and include:

- affected version / commit
- a minimal reproduction
- your assessment of impact

You can expect an initial response within 7 days.

## Scope notes

mocktape is a **development tool**. It binds to `127.0.0.1` by default, serves
permissive CORS, redacts sensitive headers in its own logs/dashboard, and is
not hardened for hostile networks. Reports about running mocktape as a public
internet service are out of scope, though hardening suggestions are welcome.
