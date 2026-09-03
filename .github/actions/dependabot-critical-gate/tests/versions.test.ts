import assert from 'node:assert/strict';
import test from 'node:test';
import { isVulnerable } from '../src/versions.js';

test('uses ecosystem-native range semantics', () => {
  assert.equal(isVulnerable('npm', '1.5.0', '>= 1.0, < 2.0'), true);
  assert.equal(isVulnerable('npm', '2.0.0', '>= 1.0, < 2.0'), false);
  assert.equal(isVulnerable('composer', '1.5.0', '>= 1.0, < 2.0'), true);
  assert.equal(isVulnerable('composer', '2.0.0', '>= 1.0, < 2.0'), false);
  assert.equal(isVulnerable('rubygems', '1.5.0', '>= 1.0, < 2.0'), true);
  assert.equal(isVulnerable('rubygems', '2.0.0', '>= 1.0, < 2.0'), false);
  assert.equal(isVulnerable('pip', '1.5.0', '>= 1.0, < 2.0'), true);
  assert.equal(isVulnerable('pip', '2.0.0', '>= 1.0, < 2.0'), false);
});

test('rejects values it cannot compare', () => {
  assert.throws(() => isVulnerable('npm', 'not-a-version', '< 2'), /Invalid npm version/);
  assert.throws(() => isVulnerable('cargo', '1.0.0', '< 2'), /Unsupported ecosystem/);
});

