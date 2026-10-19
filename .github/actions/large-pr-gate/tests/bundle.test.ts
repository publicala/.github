import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('loads the committed CommonJS action bundle under Node', () => {
  const result = spawnSync(process.execPath, ['.github/actions/large-pr-gate/dist/index.cjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request_target',
      'INPUT_REPOSITORY-TOKEN': '',
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /The gate could not complete/);
  assert.match(output, /::debug::Input required and not supplied: repository-token/);
  assert.doesNotMatch(output, /require is not defined/);
});
