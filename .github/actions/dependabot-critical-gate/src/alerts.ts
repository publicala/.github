import type { Alert, Severity, Vulnerability } from './types.js';

type JsonObject = Record<string, unknown>;

export function parseAlerts(input: unknown): Alert[] {
  if (!Array.isArray(input)) {
    throw new Error('The Dependabot alerts response is not an array.');
  }

  return input.map(parseAlert);
}

export function isOverdue(alert: Alert, now: Date, slaHours: number): boolean {
  const createdAt = Date.parse(alert.createdAt);

  if (!Number.isFinite(createdAt)) {
    throw new Error(`Alert #${alert.number} has an invalid created_at value.`);
  }

  return now.getTime() - createdAt >= slaHours * 60 * 60 * 1000;
}

function parseAlert(value: unknown): Alert {
  const alert = object(value, 'alert');
  const dependency = object(alert.dependency, 'alert.dependency');
  const dependencyPackage = object(dependency.package, 'alert.dependency.package');
  const advisory = object(alert.security_advisory, 'alert.security_advisory');
  const severity = requiredString(advisory.severity, 'alert.security_advisory.severity').toLowerCase();

  if (!isSeverity(severity)) {
    throw new Error(`Alert #${String(alert.number)} has an unknown severity.`);
  }

  const vulnerabilities = array(advisory.vulnerabilities, 'alert.security_advisory.vulnerabilities')
    .map(parseVulnerability)
    .filter((item) =>
      item.ecosystem === requiredString(dependencyPackage.ecosystem, 'alert.dependency.package.ecosystem').toLowerCase()
      && normalizePackage(item.name) === normalizePackage(requiredString(dependencyPackage.name, 'alert.dependency.package.name')),
    );

  if (vulnerabilities.length === 0) {
    throw new Error(`Alert #${String(alert.number)} has no vulnerability range for its dependency.`);
  }

  return {
    number: requiredPositiveInteger(alert.number, 'alert.number'),
    ghsa: requiredString(advisory.ghsa_id, 'alert.security_advisory.ghsa_id'),
    severity,
    createdAt: requiredString(alert.created_at, 'alert.created_at'),
    manifest: requiredString(dependency.manifest_path, 'alert.dependency.manifest_path'),
    ecosystem: requiredString(dependencyPackage.ecosystem, 'alert.dependency.package.ecosystem').toLowerCase(),
    package: requiredString(dependencyPackage.name, 'alert.dependency.package.name'),
    vulnerabilities,
    htmlUrl: requiredString(alert.html_url, 'alert.html_url'),
  };
}

function parseVulnerability(value: unknown): Vulnerability {
  const vulnerability = object(value, 'vulnerability');
  const packageValue = object(vulnerability.package, 'vulnerability.package');

  return {
    ecosystem: requiredString(packageValue.ecosystem, 'vulnerability.package.ecosystem').toLowerCase(),
    name: requiredString(packageValue.name, 'vulnerability.package.name'),
    vulnerableRange: requiredString(vulnerability.vulnerable_version_range, 'vulnerability.vulnerable_version_range'),
  };
}

function object(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} is not an object.`);
  }

  return value as JsonObject;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} is not an array.`);
  }

  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is not a non-empty string.`);
  }

  return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${field} is not a positive integer.`);
  }

  return Number(value);
}

function isSeverity(value: string): value is Severity {
  return ['critical', 'high', 'medium', 'low'].includes(value);
}

function normalizePackage(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

