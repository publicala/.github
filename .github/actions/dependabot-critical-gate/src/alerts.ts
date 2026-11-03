import { GateError } from '../../shared/src/failure.js';

type JsonObject = Record<string, unknown>;

const MAX_ALERTS = 10_000;

// Alert details stay out of public logs, so every alert data failure shares one reason.
const INVALID_ALERTS = 'The Dependabot alerts response is invalid.';

export function overdueCriticalManifests(
  input: unknown,
  now: Date,
  slaHours: number,
): Set<string> {
  if (!Array.isArray(input)) {
    throw new GateError(INVALID_ALERTS, 'The Dependabot alerts response is incomplete.');
  }

  if (input.length > MAX_ALERTS) {
    throw new GateError(INVALID_ALERTS, 'The Dependabot alerts response exceeds the safety limit.');
  }

  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(slaHours) || slaHours <= 0) {
    throw new GateError('The gate time configuration is invalid.');
  }

  const manifests = new Set<string>();

  for (const value of input) {
    const alert = object(value, 'alert');
    const advisory = object(alert.security_advisory, 'security advisory');
    const severity = requiredString(advisory.severity, 'severity').toLowerCase();

    if (severity !== 'critical') {
      continue;
    }

    const createdAt = Date.parse(requiredString(alert.created_at, 'created_at'));
    if (!Number.isFinite(createdAt)) {
      throw new GateError(INVALID_ALERTS, 'A Critical Dependabot alert has an invalid creation time.');
    }

    const age = now.getTime() - createdAt;
    if (age < slaHours * 60 * 60 * 1_000) {
      continue;
    }

    const dependency = object(alert.dependency, 'dependency');
    const manifest = requiredString(dependency.manifest_path, 'manifest_path').replace(/^\/+/, '');

    if (manifest === '') {
      throw new GateError(INVALID_ALERTS, 'A Critical Dependabot alert has an invalid manifest_path.');
    }

    manifests.add(manifest);
  }

  return manifests;
}

function object(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GateError(INVALID_ALERTS, `A Dependabot alert has an invalid ${field}.`);
  }

  return value as JsonObject;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GateError(INVALID_ALERTS, `A Dependabot alert has an invalid ${field}.`);
  }

  return value;
}
