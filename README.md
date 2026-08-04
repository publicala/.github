# publicala/.github

Org-wide GitHub configuration for publica.la.

## What lives here

- **`.github/workflows/secret-scan.yml`** — the centralized gitleaks secret-leak scan. An organization repository ruleset ("Require workflows to pass before merging") points at this workflow and enforces it on every repository's pull requests, so no per-repo workflow file is needed. Detection rules and tuning happen here, once, for the whole fleet.
- **`PULL_REQUEST_TEMPLATE.md`** — the org-wide default pull request template. GitHub serves it in the web compose form of every publicala repository that carries no template of its own, including repositories that do not exist yet. It is a copy: the canonical body lives at [`pla-stack/references/pull_request_template.md`](https://github.com/publicala/pla-stack/blob/main/references/pull_request_template.md), and the `pull-request-template-audit` routine keeps this copy and every per-repo copy in sync with it. Edit the canonical, not this file.

## Why this repo is public

GitHub only allows a required workflow to be hosted in a repository at least as visible as every repository it gates. Hosting it here — public — means the requirement works for private, internal, and public repositories alike.

The same visibility rule governs default community health files: GitHub applies them only from a public `.github` repository, and issue and pull request templates in particular are never inherited from an internal one. Making this repository private or internal would silently void the default template for every repository that relies on it.

A detection pattern is not a secret: publishing the token *format* (e.g. the `pla_data_` prefix) leaks nothing, exactly as Stripe publishes `sk_live_`. Security lives in token values, never in the obscurity of their shape.

<!-- ownership-probe -->
