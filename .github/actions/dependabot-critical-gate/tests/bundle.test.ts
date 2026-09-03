import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('loads the committed CommonJS action bundle under Node', () => {
  const result = spawnSync(process.execPath, ['.github/actions/dependabot-critical-gate/dist/index.cjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      'INPUT_ALERTS-TOKEN': '',
    },
  });

  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /Input required and not supplied: alerts-token/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /require is not defined/);
});
