import type { PullRequestEvidence } from './github.js';

export type GateDecision = 'pass' | 'block';

export function decideGate(
  overdueCriticalManifests: ReadonlySet<string>,
  evidence?: PullRequestEvidence,
): GateDecision {
  if (overdueCriticalManifests.size === 0) {
    return 'pass';
  }

  if (evidence?.isVerifiedDependabot !== true) {
    return 'block';
  }

  return [...evidence.changedPaths].some((path) => overdueCriticalManifests.has(path))
    ? 'pass'
    : 'block';
}
