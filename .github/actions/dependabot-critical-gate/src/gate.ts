import { activeCandidateAcceptance, activeRisk, isActive, matchesAlert, parseAcceptances } from './acceptances.js';
import { isOverdue } from './alerts.js';
import { packageOccurrences } from './manifests.js';
import type { Alert, Candidate, GateResult } from './types.js';
import { isVulnerable } from './versions.js';

export interface GateInput {
  alerts: Alert[];
  reported: Record<'high' | 'medium' | 'low', number>;
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
    reported: input.reported,
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

  const candidateOccurrences = packageOccurrences(alert.manifest, candidateContent, alert.package);
  if (candidateOccurrences.length === 0) {
    throw new Error(`${alert.package} is not present in ${alert.manifest}; dependency removal is not proven.`);
  }

  const baseContent = await input.readFile(input.candidate.baseSha, alert.manifest);
  if (baseContent === null) {
    throw new Error(`${alert.manifest} is missing from the base tree; the current exposure cannot be verified.`);
  }

  const baseOccurrences = packageOccurrences(alert.manifest, baseContent, alert.package);
  if (baseOccurrences.length === 0) {
    throw new Error(`${alert.package} is not present in the base ${alert.manifest}; the current exposure cannot be verified.`);
  }
  if (candidateOccurrences.length < baseOccurrences.length) {
    throw new Error(`${alert.package} has fewer installed copies in ${alert.manifest}; partial dependency removal is not proven.`);
  }

  const unmatchedCandidates = [...candidateOccurrences];
  for (const baseOccurrence of baseOccurrences.filter((occurrence) => isOccurrenceVulnerable(alert, occurrence.version))) {
    const candidateIndex = unmatchedCandidates.findIndex((occurrence) => occurrence.locator === baseOccurrence.locator);
    if (candidateIndex === -1) {
      throw new Error(
        `${alert.package} occurrence ${JSON.stringify(baseOccurrence.locator)} is missing; dependency removal is not proven.`,
      );
    }
    unmatchedCandidates.splice(candidateIndex, 1);
  }

  return candidateOccurrences.every((occurrence) => !isOccurrenceVulnerable(alert, occurrence.version));
}

function isOccurrenceVulnerable(alert: Alert, version: string): boolean {
  return alert.vulnerabilities.some((vulnerability) =>
    isVulnerable(alert.ecosystem, version, vulnerability.vulnerableRange),
  );
}
