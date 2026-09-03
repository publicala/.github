import assert from 'node:assert/strict';
import test from 'node:test';
import { packageVersions } from '../src/manifests.js';

test('reads Composer production and development packages', () => {
  const content = JSON.stringify({
    packages: [{ name: 'vendor/package', version: '1.0.0' }],
    'packages-dev': [{ name: 'vendor/package', version: '2.0.0' }],
  });
  assert.deepEqual(packageVersions('composer.lock', content, 'vendor/package'), ['1.0.0', '2.0.0']);
});

test('reads every npm v1 and v3 copy', () => {
  const content = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/example': { version: '2.0.0' },
      'node_modules/parent/node_modules/example': { version: '1.0.0' },
      'node_modules/@scope/example': { version: '3.0.0' },
    },
    dependencies: { example: { version: '2.0.0', dependencies: { example: { version: '1.0.0' } } } },
  });
  assert.deepEqual(packageVersions('package-lock.json', content, 'example'), ['2.0.0', '1.0.0']);
  assert.deepEqual(packageVersions('package-lock.json', content, '@scope/example'), ['3.0.0']);
});

test('reads Yarn classic and Berry lockfiles', () => {
  const classic = 'example@^1.0.0, example@~1.2.0:\n  version "1.2.3"\n  resolved "https://example.test"\n';
  const berry = '__metadata:\n  version: 8\n\n"example@npm:^2.0.0":\n  version: 2.1.0\n  resolution: "example@npm:2.1.0"\n';
  assert.deepEqual(packageVersions('yarn.lock', classic, 'example'), ['1.2.3']);
  assert.deepEqual(packageVersions('yarn.lock', berry, 'example'), ['2.1.0']);
});

test('reads pnpm lockfile formats', () => {
  const content = [
    'lockfileVersion: 9',
    'packages:',
    '  example@1.2.3: {}',
    '  "@scope/example@2.0.0": {}',
    'snapshots:',
    '  example@1.2.3(peer@4.0.0): {}',
  ].join('\n');
  assert.deepEqual(packageVersions('pnpm-lock.yaml', content, 'example'), ['1.2.3']);
  assert.deepEqual(packageVersions('pnpm-lock.yaml', content, '@scope/example'), ['2.0.0']);
});

test('reads RubyGems and Python lock formats', () => {
  const gems = 'GEM\n  specs:\n    rack (2.2.8)\n      ruby2_keywords (~> 0.0)\n';
  const requirements = 'Django==5.1.2 # pinned\nrequests[socks]===2.32.0; python_version > "3"\n';
  const pipfile = JSON.stringify({ default: { django: { version: '==5.1.2' } } });
  const poetry = '[[package]]\nname = "Django"\nversion = "5.1.2"\n';
  assert.deepEqual(packageVersions('Gemfile.lock', gems, 'rack'), ['2.2.8']);
  assert.deepEqual(packageVersions('requirements.txt', requirements, 'django'), ['5.1.2']);
  assert.deepEqual(packageVersions('requirements.txt', requirements, 'requests'), ['2.32.0']);
  assert.deepEqual(packageVersions('Pipfile.lock', pipfile, 'Django'), ['5.1.2']);
  assert.deepEqual(packageVersions('poetry.lock', poetry, 'django'), ['5.1.2']);
  assert.deepEqual(packageVersions('uv.lock', poetry, 'django'), ['5.1.2']);
});

test('fails closed on unsupported manifests and invalid documents', () => {
  assert.throws(() => packageVersions('go.sum', '', 'example'), /Unsupported manifest/);
  assert.throws(() => packageVersions('package-lock.json', '{', 'example'), /invalid JSON/);
});

