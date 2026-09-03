import { activeCandidateAcceptance, activeRisk, parseAcceptances } from './acceptances.js';
import { isOverdue } from './alerts.js';
import { packageVersions } from './manifests.js';
import type { Alert, Candidate, GateResult } from './types.js';
import { isVulnerable } from './versions.js';

export interface GateInput {
  alerts: Alert[];
  candidate: Candidate;
  now: Date;
  slaHours: number;
  acceptancePath: string;
  readFile: (sha: string, path: string) => Promise<string | null>;
}

export async function evaluateGate(input: GateInput): Promise<GateResult> {
  const baseAcceptances = parseAcceptances(
    await input.readFile(input.candidate.baseSha, input.acceptancePath),
    input.now,
  );
  const candidateAcceptances = parseAcceptances(
    await input.readFile(input.candidate.candidateSha, input.acceptancePath),
    input.now,
  );
  const overdue = input.alerts.filter((alert) => alert.severity === 'critical' && isOverdue(alert, input.now, input.slaHours));
  const baseBlocked = overdue.filter((alert) => !activeRisk(baseAcceptances, alert));
  const candidateBlocked: Alert[] = [];
  const fixed: Alert[] = [];
  const accepted: Alert[] = [];
  const unverified: Record<number, string> = {};

  for (const alert of overdue) {
    if (activeCandidateAcceptance(baseAcceptances, candidateAcceptances, alert, input.candidate.pullRequests)) {
      accepted.push(alert);
      continue;
    }

    try {
      if (await isFixed(input, alert)) {
        fixed.push(alert);
      } else {
        candidateBlocked.push(alert);
      }
    } catch (error) {
      candidateBlocked.push(alert);
      unverified[alert.number] = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    baseBlocked,
    candidateBlocked,
    fixed,
    accepted,
    reported: {
      high: input.alerts.filter((alert) => alert.severity === 'high').length,
      medium: input.alerts.filter((alert) => alert.severity === 'medium').length,
    },
    unverified,
  };
}

export function passes(result: GateResult): boolean {
  return result.candidateBlocked.length === 0 || result.candidateBlocked.length < result.baseBlocked.length;
}

async function isFixed(input: GateInput, alert: Alert): Promise<boolean> {
  const content = await input.readFile(input.candidate.candidateSha, alert.manifest);
  if (content === null) {
    return true;
  }

  const versions = packageVersions(alert.manifest, content, alert.package);
  if (versions.length === 0) {
    return true;
  }

  return versions.every((version) =>
    alert.vulnerabilities.every((vulnerability) =>
      !isVulnerable(alert.ecosystem, version, vulnerability.vulnerableRange),
    ),
  );
}

