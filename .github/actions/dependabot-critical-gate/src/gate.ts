export type GateDecision = 'pass' | 'block';

export function decideGate(
  overdueCriticalManifests: ReadonlySet<string>,
  changedPaths: ReadonlySet<string>,
): GateDecision {
  if (overdueCriticalManifests.size === 0) {
    return 'pass';
  }

  return [...changedPaths].some((path) => overdueCriticalManifests.has(path))
    ? 'pass'
    : 'block';
}
