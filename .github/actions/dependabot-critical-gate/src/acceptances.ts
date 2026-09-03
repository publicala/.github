import { parseDocument } from 'yaml';
import type { Acceptance, Alert } from './types.js';

const MAX_RISK_HOURS = 90 * 24;
const MAX_REMEDIATION_HOURS = 48;

type JsonObject = Record<string, unknown>;

export function parseAcceptances(content: string | null, now: Date): Acceptance[] {
  if (content === null) {
    return [];
  }

  const document = parseDocument(content, {
    merge: false,
    schema: 'core',
    strict: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new Error(`The acceptance file is invalid YAML: ${document.errors[0]?.message ?? 'unknown error'}`);
  }

  const root = object(document.toJS({ maxAliasCount: 0 }), 'acceptance file');
  rejectUnknown(root, ['version', 'acceptances'], 'acceptance file');

  if (root.version !== 1) {
    throw new Error('The acceptance file version must be 1.');
  }

  if (!Array.isArray(root.acceptances)) {
    throw new Error('acceptances must be an array.');
  }

  const acceptances = root.acceptances.map((item, index) => parseAcceptance(item, index, now));
  const identities = new Set<string>();

  for (const acceptance of acceptances) {
    const identity = `${acceptance.type}:${acceptance.alert}`;
    if (identities.has(identity)) {
      throw new Error(`Duplicate ${acceptance.type} acceptance for alert #${acceptance.alert}.`);
    }
    identities.add(identity);
  }

  return acceptances;
}

export function matchesAlert(acceptance: Acceptance, alert: Alert): boolean {
  return acceptance.alert === alert.number
    && acceptance.ghsa === alert.ghsa
    && acceptance.package === alert.package
    && acceptance.manifest === alert.manifest;
}

export function activeRisk(acceptances: Acceptance[], alert: Alert, now: Date): boolean {
  return acceptances.some((acceptance) =>
    acceptance.type === 'risk' && isActive(acceptance, now) && matchesAlert(acceptance, alert),
  );
}

export function activeCandidateAcceptance(
  base: Acceptance[],
  candidate: Acceptance[],
  alert: Alert,
  pullRequests: Set<number>,
  now: Date,
): boolean {
  const baseKeys = new Set(base.map(identityKey));

  return candidate.some((acceptance) => {
    if (!isActive(acceptance, now) || !matchesAlert(acceptance, alert)) {
      return false;
    }

    return acceptance.type === 'risk' || (
      !baseKeys.has(identityKey(acceptance))
      && acceptance.pullRequest !== undefined
      && pullRequests.has(acceptance.pullRequest)
    );
  });
}

export function isActive(acceptance: Acceptance, now: Date): boolean {
  return Date.parse(acceptance.expires) > now.getTime();
}

function parseAcceptance(value: unknown, index: number, now: Date): Acceptance {
  const field = `acceptances[${index}]`;
  const item = object(value, field);
  rejectUnknown(item, [
    'type', 'alert', 'ghsa', 'package', 'manifest', 'linear', 'reason', 'accepted', 'expires', 'pull_request',
  ], field);

  const type = requiredString(item.type, `${field}.type`);
  if (type !== 'risk' && type !== 'remediation') {
    throw new Error(`${field}.type must be risk or remediation.`);
  }

  const accepted = requiredDate(item.accepted, `${field}.accepted`);
  const expires = requiredDate(item.expires, `${field}.expires`);
  const durationHours = (expires.getTime() - accepted.getTime()) / 3_600_000;
  const maximumHours = type === 'risk' ? MAX_RISK_HOURS : MAX_REMEDIATION_HOURS;

  if (accepted.getTime() > now.getTime()) {
    throw new Error(`${field}.accepted cannot be in the future.`);
  }
  if (durationHours <= 0 || durationHours > maximumHours) {
    throw new Error(`${field} may last at most ${maximumHours} hours.`);
  }

  const linear = requiredString(item.linear, `${field}.linear`);
  if (!/^https:\/\/linear\.app\/[A-Za-z0-9/_-]+$/.test(linear)) {
    throw new Error(`${field}.linear must be a Linear URL.`);
  }

  const pullRequest = item.pull_request === undefined
    ? undefined
    : requiredPositiveInteger(item.pull_request, `${field}.pull_request`);

  if (type === 'remediation' && pullRequest === undefined) {
    throw new Error(`${field}.pull_request is required for remediation.`);
  }
  if (type === 'risk' && pullRequest !== undefined) {
    throw new Error(`${field}.pull_request is only valid for remediation.`);
  }

  return {
    type,
    alert: requiredPositiveInteger(item.alert, `${field}.alert`),
    ghsa: requiredString(item.ghsa, `${field}.ghsa`),
    package: requiredString(item.package, `${field}.package`),
    manifest: requiredPath(item.manifest, `${field}.manifest`),
    linear,
    reason: requiredString(item.reason, `${field}.reason`),
    accepted: accepted.toISOString(),
    expires: expires.toISOString(),
    ...(pullRequest === undefined ? {} : { pullRequest }),
  };
}

function identityKey(acceptance: Acceptance): string {
  return JSON.stringify([
    acceptance.type,
    acceptance.alert,
    acceptance.ghsa,
    acceptance.package,
    acceptance.manifest,
  ]);
}

function requiredDate(value: unknown, field: string): Date {
  const raw = requiredString(value, field);
  const timestamp = Date.parse(raw);

  if (!Number.isFinite(timestamp) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw)) {
    throw new Error(`${field} must be an ISO 8601 UTC timestamp.`);
  }

  return new Date(timestamp);
}

function requiredPath(value: unknown, field: string): string {
  const path = requiredString(value, field);
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${field} is not a safe repository path.`);
  }
  return path;
}

function object(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as JsonObject;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return Number(value);
}

function rejectUnknown(objectValue: JsonObject, allowed: string[], field: string): void {
  const unknown = Object.keys(objectValue).filter((keyValue) => !allowed.includes(keyValue));
  if (unknown.length > 0) {
    throw new Error(`${field} has unknown field ${unknown[0]}.`);
  }
}
