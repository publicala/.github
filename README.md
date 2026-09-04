# publicala/.github

Org-wide GitHub configuration for publica.la.

## What lives here

- **`.github/workflows/secret-scan.yml`**: the centralized gitleaks secret-leak scan. An organization repository ruleset ("Require workflows to pass before merging") points at this workflow and enforces it on every repository's pull requests, so no per-repo workflow file is needed. Detection rules and tuning happen here, once, for the whole fleet.
- **`.github/workflows/dependabot-critical-gate.yml`**: the organization-wide Critical Dependabot alert gate. It blocks merges after the seven-day SLA and lets verified Dependabot repairs proceed.
- **`PULL_REQUEST_TEMPLATE.md`**: the org-wide default pull request template. GitHub serves it in the web compose form of every publicala repository that carries no template of its own, including repositories that do not exist yet. It is a copy: the canonical body lives at [`pla-stack/references/pull_request_template.md`](https://github.com/publicala/pla-stack/blob/main/references/pull_request_template.md), and the `pull-request-template-audit` routine keeps this copy and every per-repo copy in sync with it. Edit the canonical, not this file.

## Dependabot Critical gate

The organization ruleset calls this workflow for `pull_request_target`. The workflow uses the trusted copy from this repository. It does not check out or execute a pull request tree.

```text
Pull request starts
├── No Critical alert is at least 168 hours old
│   └── Pass
├── Verified Dependabot pull request changes an affected manifest
│   └── Pass
└── Any other pull request
    └── Fail
```

The repair exception requires the Dependabot bot identity on the pull request and every commit, GitHub's verified `web-flow` signature on every commit, a branch in the target repository, and a changed file that matches an overdue alert's manifest.

The action reads GitHub API responses only. It does not read file contents, install dependencies, or execute pull request code. Incomplete Critical alert data and incomplete pull request data fail closed.

The action reports only a generic pass, block, or error message. Alert identifiers, packages, manifests, versions, and dispositions do not enter public workflow logs.

## Why this repo is public

GitHub requires a public source for a required workflow that covers repositories of every visibility.

The same visibility rule governs default community health files: GitHub applies them only from a public `.github` repository, and issue and pull request templates in particular are never inherited from an internal one. Making this repository private or internal would silently void the default template for every repository that relies on it.

A detection pattern is not a secret: publishing the token *format* (e.g. the `pla_data_` prefix) leaks nothing, exactly as Stripe publishes `sk_live_`. Security lives in token values, never in the obscurity of their shape.
