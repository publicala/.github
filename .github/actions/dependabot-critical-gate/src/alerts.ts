import { repositoryPath } from './paths.js';

type JsonObject = Record<string, unknown>;

const KNOWN_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const MAX_ALERTS = 10_000;

export function overdueCriticalManifests(
  input: unknown,
  now: Date,
  slaHours: number,
): Set<string> {
  if (!Array.isArray(input)) {
    throw new Error('The Dependabot alerts response is incomplete.');
  }

  if (input.length > MAX_ALERTS) {
    throw new Error('The Dependabot alerts response exceeds the safety limit.');
  }

  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(slaHours) || slaHours <= 0) {
    throw new Error('The gate time configuration is invalid.');
  }

  const manifests = new Set<string>();

  for (const value of input) {
    const alert = object(value, 'alert');
    const advisory = object(alert.security_advisory, 'security advisory');
    const severity = requiredString(advisory.severity, 'severity').toLowerCase();

    if (!KNOWN_SEVERITIES.has(severity)) {
      throw new Error('A Dependabot alert has an unknown severity.');
    }

    if (severity !== 'critical') {
      continue;
    }

    const createdAt = Date.parse(requiredString(alert.created_at, 'created_at'));
    if (!Number.isFinite(createdAt)) {
      throw new Error('A Critical Dependabot alert has an invalid creation time.');
    }

    const age = now.getTime() - createdAt;
    if (age < slaHours * 60 * 60 * 1_000) {
      continue;
    }

    const dependency = object(alert.dependency, 'dependency');
    manifests.add(repositoryPath(dependency.manifest_path, 'manifest_path', true));
  }

  return manifests;
}

function object(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`A Dependabot alert has an invalid ${field}.`);
  }

  return value as JsonObject;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`A Dependabot alert has an invalid ${field}.`);
  }

  return value;
}
