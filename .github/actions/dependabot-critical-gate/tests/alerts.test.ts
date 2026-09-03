import assert from 'node:assert/strict';
import test from 'node:test';
import { isOverdue, parseAlerts } from '../src/alerts.js';

test('parses every matching advisory range', () => {
  const alerts = parseAlerts([{
    number: 12,
    created_at: '2026-01-01T00:00:00Z',
    html_url: 'https://github.com/acme/repo/security/dependabot/12',
    dependency: {
      manifest_path: 'package-lock.json',
      package: { ecosystem: 'npm', name: 'example' },
    },
    security_advisory: {
      ghsa_id: 'GHSA-1111-2222-3333',
      severity: 'critical',
      vulnerabilities: [
        { package: { ecosystem: 'npm', name: 'example' }, vulnerable_version_range: '< 1.2.0' },
        { package: { ecosystem: 'npm', name: 'example' }, vulnerable_version_range: '>= 2, < 2.1' },
        { package: { ecosystem: 'pip', name: 'example' }, vulnerable_version_range: '< 9' },
      ],
    },
  }]);

  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0]?.vulnerabilities.map((item) => item.vulnerableRange), ['< 1.2.0', '>= 2, < 2.1']);
});

test('treats the SLA boundary as overdue', () => {
  const alert = parseAlerts([{
    number: 1,
    created_at: '2026-01-01T00:00:00Z',
    html_url: 'https://example.test/1',
    dependency: { manifest_path: 'composer.lock', package: { ecosystem: 'composer', name: 'a/b' } },
    security_advisory: {
      ghsa_id: 'GHSA-1111-2222-3333',
      severity: 'critical',
      vulnerabilities: [{ package: { ecosystem: 'composer', name: 'a/b' }, vulnerable_version_range: '< 2.0' }],
    },
  }])[0];

  assert.ok(alert);
  assert.equal(isOverdue(alert, new Date('2026-01-08T00:00:00Z'), 168), true);
  assert.equal(isOverdue(alert, new Date('2026-01-07T23:59:59Z'), 168), false);
});

test('rejects incomplete alert data', () => {
  assert.throws(() => parseAlerts([{ number: 1 }]), /alert\.dependency is not an object/);
});

test('rejects an unknown severity', () => {
  assert.throws(() => parseAlerts([{
    number: 1,
    created_at: '2026-01-01T00:00:00Z',
    html_url: 'https://example.test/1',
    dependency: { manifest_path: 'package-lock.json', package: { ecosystem: 'npm', name: 'example' } },
    security_advisory: {
      ghsa_id: 'GHSA-1111-2222-3333',
      severity: 'urgent',
      vulnerabilities: [{ package: { ecosystem: 'npm', name: 'example' }, vulnerable_version_range: '< 2' }],
    },
  }]), /unknown severity/);
});
