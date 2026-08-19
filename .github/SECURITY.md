# Security Policy

## Supported versions

Only the latest release is supported. The in-app updater keeps you on it.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab → "Report a vulnerability")
instead of opening a public issue. You should get a first response within a week.
Please do not publish details before a fix is released.

## Scope notes

The journal is designed as a **local single-user app**: it binds to `127.0.0.1` by default,
exchange API keys are encrypted at rest (AES-256-GCM), and all `/api` routes sit behind a
session cookie, with an optional password gate for network deployments. Reports about
installations deliberately exposed to the public internet without that gate are out of scope.
