export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Vulnerability {
  ecosystem: string;
  name: string;
  vulnerableRange: string;
}

export interface Alert {
  number: number;
  ghsa: string;
  severity: Severity;
  createdAt: string;
  manifest: string;
  ecosystem: string;
  package: string;
  vulnerabilities: Vulnerability[];
  htmlUrl: string;
}

export type AcceptanceType = 'risk' | 'remediation';

export interface Acceptance {
  type: AcceptanceType;
  alert: number;
  ghsa: string;
  package: string;
  manifest: string;
  linear: string;
  reason: string;
  accepted: string;
  expires: string;
  pullRequest?: number;
}

export interface Candidate {
  baseSha: string;
  headSha: string;
  candidateSha: string;
  pullRequests: Set<number>;
}

export interface GateResult {
  baseBlocked: Alert[];
  candidateBlocked: Alert[];
  fixed: Alert[];
  accepted: Alert[];
  reported: Record<'high' | 'medium' | 'low', number>;
  unverified: Record<number, string>;
  staleAcceptances: Acceptance[];
  expiredAcceptances: Acceptance[];
}
