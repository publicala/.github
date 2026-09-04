import assert from 'node:assert/strict';
import test from 'node:test';
import { decideGate } from '../src/gate.js';

test('passes when no Critical alert is overdue', () => {
  assert.equal(decideGate(new Set()), 'pass');
});

test('blocks a normal pull request when a Critical alert is overdue', () => {
  assert.equal(decideGate(new Set(['package-lock.json'])), 'block');
  assert.equal(decideGate(new Set(['package-lock.json']), {
    isVerifiedDependabot: false,
    changedPaths: new Set(['package-lock.json']),
  }), 'block');
});

test('passes a verified Dependabot pull request for an affected manifest', () => {
  assert.equal(decideGate(new Set(['composer.lock', 'package-lock.json']), {
    isVerifiedDependabot: true,
    changedPaths: new Set(['package.json', 'package-lock.json']),
  }), 'pass');
});

test('blocks a verified Dependabot pull request for another manifest', () => {
  assert.equal(decideGate(new Set(['composer.lock']), {
    isVerifiedDependabot: true,
    changedPaths: new Set(['package.json', 'package-lock.json']),
  }), 'block');
});
