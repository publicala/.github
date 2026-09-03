import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGate, passes } from '../src/gate.js';
import type { Alert, Candidate } from '../src/types.js';

const candidate: Candidate = {
  baseSha: 'base',
  headSha: 'head',
  candidateSha: 'merge',
  pullRequests: new Set([22]),
};
const now = new Date('2026-09-03T12:00:00Z');

test('blocks an ordinary change while all overdue Critical alerts remain', async () => {
  const files = new Map([
    ['merge:package-lock.json', npmLock({ first: '1.0.0', second: '1.0.0' })],
  ]);
  const result = await evaluateGate(input([alert(1, 'first'), alert(2, 'second')], files));
  assert.equal(result.baseBlocked.length, 2);
  assert.equal(result.candidateBlocked.length, 2);
  assert.equal(passes(result), false);
});

test('allows a change that reduces the blocking alert count', async () => {
  const files = new Map([
    ['base:package-lock.json', npmLock({ first: '1.0.0', second: '1.0.0' })],
    ['merge:package-lock.json', npmLock({ first: '2.0.0', second: '1.0.0' })],
  ]);
  const result = await evaluateGate(input([alert(1, 'first'), alert(2, 'second')], files));
  assert.deepEqual(result.fixed.map((item) => item.number), [1]);
  assert.equal(result.candidateBlocked.length, 1);
  assert.equal(passes(result), true);
});

test('requires every installed copy to be safe', async () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/first': { version: '2.0.0' },
      'node_modules/parent/node_modules/first': { version: '1.0.0' },
    },
  });
  const result = await evaluateGate(input([alert(1, 'first')], new Map([['merge:package-lock.json', lock]])));
  assert.equal(passes(result), false);
});

test('fails closed when only the vulnerable installed copy is deleted', async () => {
  const base = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/first': { version: '2.0.0' },
      'node_modules/parent/node_modules/first': { version: '1.0.0' },
    },
  });
  const merge = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/first': { version: '2.0.0' },
    },
  });
  const files = new Map([
    ['base:package-lock.json', base],
    ['merge:package-lock.json', merge],
  ]);

  const result = await evaluateGate(input([alert(1, 'first')], files));

  assert.equal(passes(result), false);
  assert.match(result.unverified[1] ?? '', /partial dependency removal is not proven/);
  assert.deepEqual(result.fixed, []);
});

test('fails closed when a vulnerable occurrence is replaced at another location', async () => {
  const base = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/first': { version: '1.0.0' },
      'node_modules/parent/node_modules/first': { version: '2.0.0' },
    },
  });
  const merge = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/parent/node_modules/first': { version: '2.0.0' },
      'node_modules/unrelated/node_modules/first': { version: '2.0.0' },
    },
  });
  const files = new Map([
    ['base:package-lock.json', base],
    ['merge:package-lock.json', merge],
  ]);

  const result = await evaluateGate(input([alert(1, 'first')], files));

  assert.equal(passes(result), false);
  assert.match(result.unverified[1] ?? '', /occurrence "node_modules\/first" is missing/);
  assert.deepEqual(result.fixed, []);
});

test('uses all advisory vulnerability ranges', async () => {
  const vulnerable = alert(1, 'first');
  vulnerable.vulnerabilities.push({ ecosystem: 'npm', name: 'first', vulnerableRange: '>= 3, < 4' });
  const result = await evaluateGate(input(
    [vulnerable],
    new Map([['merge:package-lock.json', npmLock({ first: '3.5.0' })]]),
  ));
  assert.equal(passes(result), false);
});

test('fails closed when the alerted manifest is deleted', async () => {
  const result = await evaluateGate(input([alert(1, 'first')], new Map()));
  assert.equal(passes(result), false);
  assert.match(result.unverified[1] ?? '', /missing from the candidate tree/);
  assert.deepEqual(result.fixed, []);
});

test('fails closed when a candidate file does not contain the alerted package', async () => {
  const files = new Map([
    ['merge:package-lock.json', npmLock({ second: '2.0.0' })],
  ]);
  const result = await evaluateGate(input([alert(1, 'first')], files));
  assert.equal(passes(result), false);
  assert.match(result.unverified[1] ?? '', /dependency removal is not proven/);
  assert.deepEqual(result.fixed, []);
});

test('fails closed for a non-exact requirements declaration', async () => {
  const pythonAlert = {
    ...alert(1, 'Django'),
    ecosystem: 'pip',
    manifest: 'requirements.txt',
    vulnerabilities: [{ ecosystem: 'pip', name: 'Django', vulnerableRange: '< 4.2.20' }],
  };
  const files = new Map([
    ['merge:requirements.txt', 'Django>=4.2,<4.2.20\n'],
  ]);
  const result = await evaluateGate(input([pythonAlert], files));
  assert.equal(passes(result), false);
  assert.match(result.unverified[1] ?? '', /not pinned to one exact version/);
});

test('accepts a reviewed risk and a new remediation for the current PR', async () => {
  const risk = acceptance('risk', 1, 'first');
  const remediation = acceptance('remediation', 2, 'second', '    pull_request: 22\n');
  const files = new Map([
    ['base:.github/security/dependabot-accepted.yml', 'version: 1\nacceptances:\n' + risk],
    ['merge:.github/security/dependabot-accepted.yml', 'version: 1\nacceptances:\n' + risk + remediation],
    ['merge:package-lock.json', npmLock({ first: '1.0.0', second: '1.0.0' })],
  ]);
  const result = await evaluateGate(input([alert(1, 'first'), alert(2, 'second')], files));
  assert.deepEqual(result.accepted.map((item) => item.number), [1, 2]);
  assert.equal(passes(result), true);
});

test('does not reuse a remediation already on the base branch', async () => {
  const remediation = acceptance('remediation', 1, 'first', '    pull_request: 22\n');
  const document = 'version: 1\nacceptances:\n' + remediation;
  const files = new Map([
    ['base:.github/security/dependabot-accepted.yml', document],
    ['merge:.github/security/dependabot-accepted.yml', document],
    ['merge:package-lock.json', npmLock({ first: '1.0.0' })],
  ]);
  const result = await evaluateGate(input([alert(1, 'first')], files));
  assert.equal(result.candidateBlocked.length, 1);
  assert.equal(passes(result), false);
});

test('fails closed for an unsupported manifest but permits reviewed remediation', async () => {
  const cargo = { ...alert(1, 'first'), ecosystem: 'cargo', manifest: 'Cargo.lock' };
  const blocked = await evaluateGate(input([cargo], new Map([['merge:Cargo.lock', 'content']]))) ;
  assert.match(blocked.unverified[1] ?? '', /Unsupported manifest/);
  assert.equal(passes(blocked), false);

  const remediation = acceptance('remediation', 1, 'first', '    pull_request: 22\n')
    .replace('    manifest: package-lock.json', '    manifest: Cargo.lock');
  const accepted = await evaluateGate(input([cargo], new Map([
    ['merge:Cargo.lock', 'content'],
    ['merge:.github/security/dependabot-accepted.yml', `version: 1\nacceptances:\n${remediation}`],
  ])));
  assert.equal(passes(accepted), true);
});

test('does not block alerts inside the SLA or High and Medium alerts', async () => {
  const grace = { ...alert(1, 'first'), createdAt: '2026-08-30T00:00:00Z' };
  const high = { ...alert(2, 'second'), severity: 'high' as const };
  const medium = { ...alert(3, 'third'), severity: 'medium' as const };
  const result = await evaluateGate(input([grace, high, medium], new Map()));
  assert.equal(result.baseBlocked.length, 0);
  assert.equal(result.reported.high, 1);
  assert.equal(result.reported.medium, 1);
  assert.equal(passes(result), true);
});

test('reports stale and expired acceptances without making them bypass the gate', async () => {
  const expired = acceptance('risk', 1, 'first')
    .replace('2026-10-01T00:00:00Z', '2026-09-03T11:59:59Z');
  const stale = acceptance('risk', 2, 'second');
  const files = new Map([
    ['base:.github/security/dependabot-accepted.yml', `version: 1\nacceptances:\n${expired}${stale}`],
    ['merge:.github/security/dependabot-accepted.yml', `version: 1\nacceptances:\n${expired}${stale}`],
    ['merge:package-lock.json', npmLock({ first: '1.0.0' })],
  ]);
  const result = await evaluateGate(input([alert(1, 'first')], files));

  assert.deepEqual(result.expiredAcceptances.map((item) => item.alert), [1]);
  assert.deepEqual(result.staleAcceptances.map((item) => item.alert), [2]);
  assert.equal(passes(result), false);
});

function input(alerts: Alert[], files: Map<string, string>) {
  const repositoryFiles = new Map(files);
  for (const [key, content] of files) {
    if (key.startsWith('merge:') && key !== 'merge:.github/security/dependabot-accepted.yml') {
      const baseKey = `base:${key.slice('merge:'.length)}`;
      if (!repositoryFiles.has(baseKey)) {
        repositoryFiles.set(baseKey, content);
      }
    }
  }

  return {
    alerts,
    reported: {
      high: alerts.filter((item) => item.severity === 'high').length,
      medium: alerts.filter((item) => item.severity === 'medium').length,
      low: alerts.filter((item) => item.severity === 'low').length,
    },
    candidate,
    now,
    slaHours: 168,
    acceptancePath: '.github/security/dependabot-accepted.yml',
    readFile: async (sha: string, path: string) => repositoryFiles.get(`${sha}:${path}`) ?? null,
  };
}

function alert(number: number, packageName: string): Alert {
  return {
    number,
    ghsa: `GHSA-1111-2222-333${number}`,
    severity: 'critical',
    createdAt: '2026-01-01T00:00:00Z',
    manifest: 'package-lock.json',
    ecosystem: 'npm',
    package: packageName,
    vulnerabilities: [{ ecosystem: 'npm', name: packageName, vulnerableRange: '< 2' }],
    htmlUrl: `https://example.test/${number}`,
  };
}

function npmLock(packages: Record<string, string>): string {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: Object.fromEntries(Object.entries(packages).map(([name, version]) => [`node_modules/${name}`, { version }])),
  });
}

function acceptance(type: 'risk' | 'remediation', number: number, packageName: string, extra = ''): string {
  return [
    `  - type: ${type}`,
    `    alert: ${number}`,
    `    ghsa: GHSA-1111-2222-333${number}`,
    `    package: ${packageName}`,
    '    manifest: package-lock.json',
    '    linear: https://linear.app/publicala/issue/SEC-123/example',
    '    reason: Documented decision.',
    '    accepted: 2026-09-03T00:00:00Z',
    `    expires: ${type === 'risk' ? '2026-10-01T00:00:00Z' : '2026-09-05T00:00:00Z'}`,
    extra.trimEnd(),
  ].filter(Boolean).join('\n') + '\n';
}
