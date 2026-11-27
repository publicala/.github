import assert from 'node:assert/strict';
import test from 'node:test';
import { decideGate } from '../src/gate.js';

test('passes when no Critical alert is overdue', () => {
  assert.equal(decideGate(new Set(), new Set(['src/app.ts'])), 'pass');
});

test('passes a pull request that changes the manifest of an overdue Critical alert', () => {
  assert.equal(
    decideGate(new Set(['composer.lock', 'package-lock.json']), new Set(['package.json', 'package-lock.json'])),
    'pass',
  );
});

test('blocks a pull request that changes no manifest of an overdue Critical alert', () => {
  assert.equal(decideGate(new Set(['composer.lock']), new Set()), 'block');
  assert.equal(decideGate(new Set(['composer.lock']), new Set(['package.json', 'package-lock.json'])), 'block');
});

test('matches the whole manifest path', () => {
  assert.equal(decideGate(new Set(['composer.lock']), new Set(['packages/api/composer.lock'])), 'block');
  assert.equal(decideGate(new Set(['packages/api/composer.lock']), new Set(['composer.lock'])), 'block');
});
