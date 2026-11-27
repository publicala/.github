import assert from 'node:assert/strict';
import test from 'node:test';
import { readChangedPaths } from '../src/github.js';

test('returns every changed path of the pull request', async () => {
  const changedPaths = await readChangedPaths(client(), 'acme', 'example', 42, 'head-sha', 'main');

  assert.deepEqual(changedPaths, new Set(['package.json', 'package-lock.json']));
});

test('returns no path for a pull request without changed files', async () => {
  const pull = validPull();
  pull.changed_files = 0;

  const changedPaths = await readChangedPaths(client({ pull, files: [] }), 'acme', 'example', 42, 'head-sha', 'main');

  assert.deepEqual(changedPaths, new Set());
});

test('returns the previous path of a renamed file', async () => {
  const files = [
    { filename: '.github/workflows/build.yml', previous_filename: '.github/workflows/ci.yml', status: 'renamed' },
    { filename: 'docs/package-lock.json', previous_filename: 'package-lock.json', status: 'copied' },
  ];

  const changedPaths = await readChangedPaths(client({ files }), 'acme', 'example', 42, 'head-sha', 'main');

  assert.deepEqual(
    changedPaths,
    new Set(['.github/workflows/build.yml', '.github/workflows/ci.yml', 'docs/package-lock.json']),
  );
});

test('fails closed when the event names another base branch', async () => {
  await assert.rejects(
    () => readChangedPaths(client(), 'acme', 'example', 42, 'head-sha', 'release'),
    /base branch changed after this event/,
  );
});

test('fails closed when the pull request changes while its files are read', async () => {
  const cases = [
    (pull: ReturnType<typeof validPull>) => { pull.head.sha = 'next-head'; },
    (pull: ReturnType<typeof validPull>) => { pull.base.ref = 'release'; },
    (pull: ReturnType<typeof validPull>) => { pull.changed_files = 3; },
  ];

  for (const mutate of cases) {
    const pullAfterFiles = validPull();
    mutate(pullAfterFiles);

    await assert.rejects(
      () => readChangedPaths(client({ pullAfterFiles }), 'acme', 'example', 42, 'head-sha', 'main'),
      /pull request changed during evaluation/,
    );
  }
});

test('fails closed when the event head is stale', async () => {
  await assert.rejects(
    () => readChangedPaths(client(), 'acme', 'example', 42, 'old-head', 'main'),
    /head changed/,
  );
});

test('fails closed for incomplete file pagination', async () => {
  const threeFiles = validPull();
  threeFiles.changed_files = 3;

  await assert.rejects(
    () => readChangedPaths(client({ pull: threeFiles }), 'acme', 'example', 42, 'head-sha', 'main'),
    /file list is incomplete/,
  );
});

test('fails closed when GitHub cannot return every file', async () => {
  const tooManyFiles = validPull();
  tooManyFiles.changed_files = 3_001;

  await assert.rejects(
    () => readChangedPaths(client({ pull: tooManyFiles }), 'acme', 'example', 42, 'head-sha', 'main'),
    /file list exceeds/,
  );
});

test('fails closed for an invalid changed file count', async () => {
  const pull = validPull();
  pull.changed_files = -1;

  await assert.rejects(
    () => readChangedPaths(client({ pull }), 'acme', 'example', 42, 'head-sha', 'main'),
    /changed file count is invalid/,
  );
});

test('propagates GitHub API failures', async () => {
  await assert.rejects(
    () => readChangedPaths(client({ getError: new Error('denied') }), 'acme', 'example', 42, 'head-sha', 'main'),
    /denied/,
  );
});

function validPull() {
  return {
    head: { sha: 'head-sha' },
    base: { ref: 'main' },
    changed_files: 2,
  };
}

function client(options: {
  pull?: ReturnType<typeof validPull>;
  pullAfterFiles?: ReturnType<typeof validPull>;
  files?: { filename: string; previous_filename?: string; status?: string }[];
  getError?: Error;
} = {}) {
  const files = options.files ?? [{ filename: 'package.json' }, { filename: 'package-lock.json' }];
  const pull = options.pull ?? validPull();
  const reads = [pull, options.pullAfterFiles ?? pull];

  return {
    rest: {
      pulls: {
        get: async () => {
          if (options.getError !== undefined) {
            throw options.getError;
          }

          return { data: reads.shift() ?? pull };
        },
        listFiles: () => undefined,
      },
    },
    paginate: async () => files,
  } as never;
}
