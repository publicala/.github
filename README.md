# publicala/.github

Org-wide GitHub configuration for publica.la.

## What lives here

- **`.github/workflows/secret-scan.yml`** — the centralized gitleaks
  secret-leak scan. An organization repository ruleset ("Require workflows to
  pass before merging") points at this workflow and enforces it on every
  repository's pull requests, so no per-repo workflow file is needed. Detection
  rules and tuning happen here, once, for the whole fleet.

## Why this repo is public

GitHub only allows a required workflow to be hosted in a repository at least as
visible as every repository it gates. Hosting it here — public — means the
requirement works for private, internal, and public repositories alike.

A detection pattern is not a secret: publishing the token *format* (e.g. the
`pla_data_` prefix) leaks nothing, exactly as Stripe publishes `sk_live_`.
Security lives in token values, never in the obscurity of their shape.
