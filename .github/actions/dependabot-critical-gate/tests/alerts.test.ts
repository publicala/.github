import assert from 'node:assert/strict';
import test from 'node:test';
import { overdueCriticalManifests } from '../src/alerts.js';

const now = new Date('2026-09-04T12:00:00Z');

test('blocks Critical alerts at and after 168 hours', () => {
  const manifests = overdueCriticalManifests([
    alert('critical', '2026-08-28T13:00:00Z', 'inside.json'),
    alert('critical', '2026-08-28T12:00:00Z', 'boundary.json'),
    alert('critical', '2026-08-28T11:00:00Z', 'overdue.json'),
  ], now, 168);

  assert.deepEqual(manifests, new Set(['boundary.json', 'overdue.json']));
});

test('does not block High, Medium, or Low alerts', () => {
  const manifests = overdueCriticalManifests([
    alert('high', '2026-01-01T00:00:00Z'),
    alert('medium', '2026-01-01T00:00:00Z'),
    alert('low', '2026-01-01T00:00:00Z'),
  ], now, 168);

  assert.deepEqual(manifests, new Set());
});

test('normalizes a root-prefixed manifest and removes duplicates', () => {
  const manifests = overdueCriticalManifests([
    alert('critical', '2026-01-01T00:00:00Z', '/package-lock.json'),
    alert('critical', '2026-01-02T00:00:00Z', 'package-lock.json'),
  ], now, 168);

  assert.deepEqual(manifests, new Set(['package-lock.json']));
});

test('fails closed for an unknown severity', () => {
  assert.throws(
    () => overdueCriticalManifests([alert('unknown', '2026-01-01T00:00:00Z')], now, 168),
    /unknown severity/,
  );
});

test('fails closed for incomplete Critical alert data', () => {
  assert.throws(
    () => overdueCriticalManifests([alert('critical', 'not-a-date')], now, 168),
    /invalid creation time/,
  );
  assert.throws(
    () => overdueCriticalManifests([
      { security_advisory: { severity: 'critical' }, created_at: '2026-01-01T00:00:00Z' },
    ], now, 168),
    /invalid dependency/,
  );
  assert.throws(
    () => overdueCriticalManifests([
      alert('critical', '2026-01-01T00:00:00Z', '../package-lock.json'),
    ], now, 168),
    /unsafe/,
  );
});

test('does not require a manifest before a Critical alert reaches the SLA', () => {
  const manifests = overdueCriticalManifests([
    { security_advisory: { severity: 'critical' }, created_at: '2026-09-04T11:00:00Z' },
  ], now, 168);

  assert.deepEqual(manifests, new Set());
});

test('fails closed for invalid responses, limits, and time configuration', () => {
  assert.throws(() => overdueCriticalManifests({}, now, 168), /response is incomplete/);
  assert.throws(() => overdueCriticalManifests(new Array(10_001), now, 168), /safety limit/);
  assert.throws(() => overdueCriticalManifests([], new Date('invalid'), 168), /time configuration/);
  assert.throws(() => overdueCriticalManifests([], now, 0), /time configuration/);
});

function alert(severity: string, createdAt: string, manifest = 'package-lock.json'): unknown {
  return {
    created_at: createdAt,
    dependency: { manifest_path: manifest },
    security_advisory: { severity },
  };
}
