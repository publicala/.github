# publicala/.github

Org-wide GitHub configuration for publica.la.

## What lives here

- **`.github/workflows/secret-scan.yml`**: the centralized gitleaks secret-leak scan. An organization repository ruleset ("Require workflows to pass before merging") points at this workflow and enforces it on every repository's pull requests, so no per-repo workflow file is needed. Detection rules and tuning happen here, once, for the whole fleet.
- **`.github/workflows/dependabot-critical-gate.yml`**: the organization-wide Critical Dependabot alert gate. It blocks merges after the seven-day SLA and lets verified Dependabot repairs proceed.
- **`.github/workflows/large-pr-gate.yml`**: the organization-wide large pull request gate. It blocks a merge above 20,000 reviewable changed lines until a human other than the author approves the head commit.
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

## Large PR gate

The organization ruleset `Large PR gate` calls this workflow for `pull_request_target` on every repository's default branch. The workflow uses the trusted copy from this repository. It does not check out or execute a pull request tree.

```text
Pull request starts
├── Additions plus deletions <= 20,000
│   └── Pass
├── Reviewable lines <= 20,000
│   └── Pass
├── Latest decisive review of a human with write access, other than the author, approves the head commit
│   └── Pass
└── Any other pull request
    └── Fail
```

Reviewable lines exclude lockfiles, minified assets, source maps, snapshots, and paths that the base commit's root `.gitattributes` marks `linguist-generated` or `linguist-vendored`. A `-linguist-generated` line counts a default exclusion again. The gate reads `.gitattributes` from the base commit, so a pull request cannot reclassify its own lines. Above GitHub's 3,000-file list limit, the gate counts every line.

A review counts when its reviewer is a `User` with `OWNER`, `MEMBER`, or `COLLABORATOR` association, is not the pull request author, and approved the current head commit. A later change request or dismissal replaces the approval. A push after the approval needs a new approval.

Required workflows do not run on review events. After approving, re-run `Large PR approval gate` from the pull request's Checks tab.

The gate cannot tell a person from an agent that acts with a person's token. An approval through a personal token counts as that person's approval.

The ruleset has no merge bypass. An organization owner recovers a central failure by restoring the last known good workflow SHA or by moving only this ruleset to `Evaluate`.

## Why this repo is public

GitHub requires a public source for a required workflow that covers repositories of every visibility.

The same visibility rule governs default community health files: GitHub applies them only from a public `.github` repository, and issue and pull request templates in particular are never inherited from an internal one. Making this repository private or internal would silently void the default template for every repository that relies on it.

A detection pattern is not a secret: publishing the token *format* (e.g. the `pla_data_` prefix) leaks nothing, exactly as Stripe publishes `sk_live_`. Security lives in token values, never in the obscurity of their shape.
