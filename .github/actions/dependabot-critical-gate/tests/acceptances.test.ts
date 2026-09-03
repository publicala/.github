import assert from 'node:assert/strict';
import test from 'node:test';
import { activeCandidateAcceptance, activeRisk, parseAcceptances } from '../src/acceptances.js';
import type { Alert } from '../src/types.js';

const now = new Date('2026-09-03T12:00:00Z');
const alert: Alert = {
  number: 7,
  ghsa: 'GHSA-1111-2222-3333',
  severity: 'critical',
  createdAt: '2026-01-01T00:00:00Z',
  manifest: 'package-lock.json',
  ecosystem: 'npm',
  package: 'example',
  vulnerabilities: [{ ecosystem: 'npm', name: 'example', vulnerableRange: '< 2' }],
  htmlUrl: 'https://example.test/7',
};

test('parses a bounded risk acceptance', () => {
  const acceptances = parseAcceptances(file('risk'), now);
  assert.equal(acceptances[0]?.alert, 7);
  assert.equal(acceptances[0]?.type, 'risk');
});

test('keeps expired acceptances valid but inactive', () => {
  const expired = parseAcceptances(file('risk', { expires: '2026-09-03T11:59:59Z' }), now);
  assert.equal(expired.length, 1);
  assert.equal(activeRisk(expired, alert, now), false);
});

test('rejects overlong risk acceptances', () => {
  assert.throws(
    () => parseAcceptances(file('risk', { accepted: '2026-01-01T00:00:00Z', expires: '2026-09-04T00:00:00Z' }), now),
    /at most 2160 hours/,
  );
});

test('requires exact alert identity and a Linear URL', () => {
  assert.throws(() => parseAcceptances(file('risk', { linear: 'SEC-123' }), now), /must be a Linear URL/);
  const acceptance = parseAcceptances(file('risk'), now);
  assert.equal(activeCandidateAcceptance([], acceptance, { ...alert, ghsa: 'GHSA-9999-9999-9999' }, new Set([22]), now), false);
});

test('allows a new remediation only for its pull request and for 48 hours', () => {
  const remediation = parseAcceptances(file('remediation', { pull_request: 22 }), now);
  assert.equal(activeCandidateAcceptance([], remediation, alert, new Set([22]), now), true);
  assert.equal(activeCandidateAcceptance([], remediation, alert, new Set([23]), now), false);
  assert.equal(activeCandidateAcceptance(remediation, remediation, alert, new Set([22]), now), false);
  assert.throws(
    () => parseAcceptances(file('remediation', { pull_request: 22, expires: '2026-09-06T00:00:00Z' }), now),
    /at most 48 hours/,
  );
});

test('rejects aliases, unknown fields, and duplicate entries', () => {
  assert.throws(() => parseAcceptances('version: 1\nacceptances: &items []\ncopy: *items\n', now), /unknown field|alias/i);
  assert.throws(() => parseAcceptances(`${file('risk')}  - type: risk\n    alert: 7\n`, now), /must be a non-empty string/);
});

test('rejects future, malformed, and non-UTC dates', () => {
  assert.throws(() => parseAcceptances(file('risk', { accepted: '2026-09-04T00:00:00Z' }), now), /cannot be in the future/);
  assert.throws(() => parseAcceptances(file('risk', { accepted: 'not-a-date' }), now), /ISO 8601 UTC/);
  assert.throws(() => parseAcceptances(file('risk', { accepted: '2026-09-03T00:00:00+01:00' }), now), /ISO 8601 UTC/);
});

test('rejects a complete duplicate acceptance', () => {
  const entry = file('risk').replace('version: 1\nacceptances:\n', '');
  assert.throws(() => parseAcceptances(`version: 1\nacceptances:\n${entry}${entry}`, now), /Duplicate risk acceptance/);
});

function file(type: 'risk' | 'remediation', overrides: Record<string, string | number> = {}): string {
  const values: Record<string, string | number> = {
    type,
    alert: 7,
    ghsa: 'GHSA-1111-2222-3333',
    package: 'example',
    manifest: 'package-lock.json',
    linear: 'https://linear.app/publicala/issue/SEC-123/example',
    reason: 'Business owner accepted the documented exposure.',
    accepted: '2026-09-03T00:00:00Z',
    expires: type === 'risk' ? '2026-10-01T00:00:00Z' : '2026-09-05T00:00:00Z',
    ...overrides,
  };

  const lines = Object.entries(values).map(([key, value]) => `    ${key}: ${value}`);
  return `version: 1\nacceptances:\n  - ${lines.join('\n').trimStart()}\n`;
}
