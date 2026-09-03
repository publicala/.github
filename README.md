# publicala/.github

Org-wide GitHub configuration for publica.la.

## What lives here

- **`.github/workflows/secret-scan.yml`** — the centralized gitleaks secret-leak scan. An organization repository ruleset ("Require workflows to pass before merging") points at this workflow and enforces it on every repository's pull requests, so no per-repo workflow file is needed. Detection rules and tuning happen here, once, for the whole fleet.
- **`.github/workflows/dependabot-critical-gate.yml`** — the organization-wide Critical Dependabot alert gate. It blocks a merge after the seven-day SLA unless the candidate reduces the block or has a reviewed acceptance.
- **`PULL_REQUEST_TEMPLATE.md`** — the org-wide default pull request template. GitHub serves it in the web compose form of every publicala repository that carries no template of its own, including repositories that do not exist yet. It is a copy: the canonical body lives at [`pla-stack/references/pull_request_template.md`](https://github.com/publicala/pla-stack/blob/main/references/pull_request_template.md), and the `pull-request-template-audit` routine keeps this copy and every per-repo copy in sync with it. Edit the canonical, not this file.

## Dependabot Critical gate

The organization ruleset calls this workflow for `pull_request_target` and `merge_group`. The workflow uses the trusted copy from this repository. It does not check out or execute a pull request tree.

Decision flow:

- Open Dependabot alerts
  - Critical and younger than 168 hours: report, then pass.
  - High or Medium: report only.
  - Critical and at least 168 hours old
    - Active risk acceptance: pass that alert.
    - All installed copies are outside every vulnerable range: pass that alert.
    - Missing files, absent packages, and non-exact requirements fail closed.
    - Candidate adds a reviewed, PR-specific remediation acceptance: pass that alert for this PR only.
    - Otherwise: keep that alert blocked.
- Candidate result
  - No blocked alerts: pass.
  - Fewer blocked alerts than the base: pass, so fixes can land one at a time.
  - Same or more blocked alerts: fail.

The gate reads the exact synthetic merge commit from the GitHub Git Data API. It supports Composer, npm, Yarn, pnpm, RubyGems, exact pip requirements, Pipenv, Poetry, and uv lockfiles. It checks every vulnerable range in the advisory and every installed copy of the package. Unknown formats and dependency removals fail closed for that alert. A removal uses the reviewed 48-hour remediation entry because a lockfile alone cannot prove that a later install will not restore the package.

### Reviewed acceptances

Add `.github/security/dependabot-accepted.yml` to the affected repository. The organization reviewer ruleset requires approval from `@publicala/vuln-review-owners` for this path.

```yaml
version: 1
acceptances:
  - type: risk
    alert: 123
    ghsa: GHSA-xxxx-yyyy-zzzz
    package: vendor/package
    manifest: composer.lock
    linear: https://linear.app/publicala/issue/SEC-123/accepted-risk
    reason: The documented business need is greater than the temporary exposure.
    accepted: 2026-09-03T12:00:00Z
    expires: 2026-10-03T12:00:00Z
```

Risk acceptances can last at most 90 days. Use `type: remediation` only when the gate cannot parse the ecosystem. A remediation acceptance also needs `pull_request: 123` and can last at most 48 hours. It works only when the candidate adds it and the named pull request is in the candidate or merge group.

### Recovery

The Dependabot gate ruleset has no person or team bypass. If the central gate fails, an organization owner must either:

1. Move the ruleset to `Evaluate` while the gate is repaired.
2. Change the required workflow SHA to the last known good commit.

Record the action and reason in the incident or change record. Restore `Active` only after a representative pull request passes.

## Why this repo is public

GitHub only allows a required workflow to be hosted in a repository at least as visible as every repository it gates. Hosting it here — public — means the requirement works for private, internal, and public repositories alike.

The same visibility rule governs default community health files: GitHub applies them only from a public `.github` repository, and issue and pull request templates in particular are never inherited from an internal one. Making this repository private or internal would silently void the default template for every repository that relies on it.

A detection pattern is not a secret: publishing the token *format* (e.g. the `pla_data_` prefix) leaks nothing, exactly as Stripe publishes `sk_live_`. Security lives in token values, never in the obscurity of their shape.
