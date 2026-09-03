import { activeCandidateAcceptance, activeRisk, isActive, matchesAlert, parseAcceptances } from './acceptances.js';
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
  const baseBlocked = overdue.filter((alert) => !activeRisk(baseAcceptances, alert, input.now));
  const candidateBlocked: Alert[] = [];
  const fixed: Alert[] = [];
  const accepted: Alert[] = [];
  const unverified: Record<number, string> = {};

  for (const alert of overdue) {
    if (activeCandidateAcceptance(
      baseAcceptances,
      candidateAcceptances,
      alert,
      input.candidate.pullRequests,
      input.now,
    )) {
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
    staleAcceptances: candidateAcceptances.filter((acceptance) =>
      !input.alerts.some((alert) => matchesAlert(acceptance, alert)),
    ),
    expiredAcceptances: candidateAcceptances.filter((acceptance) => !isActive(acceptance, input.now)),
  };
}

export function passes(result: GateResult): boolean {
  return result.candidateBlocked.length === 0 || result.candidateBlocked.length < result.baseBlocked.length;
}

async function isFixed(input: GateInput, alert: Alert): Promise<boolean> {
  const candidateContent = await input.readFile(input.candidate.candidateSha, alert.manifest);
  if (candidateContent === null) {
    throw new Error(`${alert.manifest} is missing from the candidate tree; dependency removal is not proven.`);
  }

  const candidateVersions = packageVersions(alert.manifest, candidateContent, alert.package);
  if (candidateVersions.length === 0) {
    throw new Error(`${alert.package} is not present in ${alert.manifest}; dependency removal is not proven.`);
  }

  const baseContent = await input.readFile(input.candidate.baseSha, alert.manifest);
  if (baseContent === null) {
    throw new Error(`${alert.manifest} is missing from the base tree; the current exposure cannot be verified.`);
  }

  const baseVersions = packageVersions(alert.manifest, baseContent, alert.package);
  if (baseVersions.length === 0) {
    throw new Error(`${alert.package} is not present in the base ${alert.manifest}; the current exposure cannot be verified.`);
  }
  if (candidateVersions.length < baseVersions.length) {
    throw new Error(`${alert.package} has fewer installed copies in ${alert.manifest}; partial dependency removal is not proven.`);
  }

  return candidateVersions.every((version) =>
    alert.vulnerabilities.every((vulnerability) =>
      !isVulnerable(alert.ecosystem, version, vulnerability.vulnerableRange),
    ),
  );
}
