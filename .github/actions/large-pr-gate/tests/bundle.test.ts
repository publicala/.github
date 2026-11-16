import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('loads the committed CommonJS action bundle under Node', () => {
  const result = spawnSync(process.execPath, ['.github/actions/large-pr-gate/dist/index.cjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request',
      'INPUT_REPOSITORY-TOKEN': '',
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /::error::The gate could not complete\. Reason: The repository-token input is required\. Repository maintainers must inspect this run\./);
  assert.doesNotMatch(output, /require is not defined/);
});

test('runs on pull_request, which GitHub allows in public repositories', () => {
  const workflow = readFileSync('.github/workflows/large-pr-gate.yml', 'utf8');
  assert.match(workflow, /^on:\n {2}pull_request:\n/m);

  const result = spawnSync(process.execPath, ['.github/actions/large-pr-gate/dist/index.cjs'], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request_target' },
  });

  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /The gate received an unsupported event\./);
});
