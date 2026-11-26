import assert from 'node:assert/strict';
import test from 'node:test';
import { readChangedPaths } from '../src/github.js';

test('returns every changed path of the pull request', async () => {
  const changedPaths = await readChangedPaths(client(), 'acme', 'example', 42, 'head-sha');

  assert.deepEqual(changedPaths, new Set(['package.json', 'package-lock.json']));
});

test('returns no path for a pull request without changed files', async () => {
  const pull = validPull();
  pull.changed_files = 0;

  const changedPaths = await readChangedPaths(client({ pull, files: [] }), 'acme', 'example', 42, 'head-sha');

  assert.deepEqual(changedPaths, new Set());
});

test('fails closed when the event head is stale', async () => {
  await assert.rejects(
    () => readChangedPaths(client(), 'acme', 'example', 42, 'old-head'),
    /head changed/,
  );
});

test('fails closed for incomplete file pagination', async () => {
  const threeFiles = validPull();
  threeFiles.changed_files = 3;

  await assert.rejects(
    () => readChangedPaths(client({ pull: threeFiles }), 'acme', 'example', 42, 'head-sha'),
    /file list is incomplete/,
  );
});

test('fails closed when GitHub cannot return every file', async () => {
  const tooManyFiles = validPull();
  tooManyFiles.changed_files = 3_001;

  await assert.rejects(
    () => readChangedPaths(client({ pull: tooManyFiles }), 'acme', 'example', 42, 'head-sha'),
    /file list exceeds/,
  );
});

test('fails closed for an invalid changed file count', async () => {
  const pull = validPull();
  pull.changed_files = -1;

  await assert.rejects(
    () => readChangedPaths(client({ pull }), 'acme', 'example', 42, 'head-sha'),
    /changed file count is invalid/,
  );
});

test('propagates GitHub API failures', async () => {
  await assert.rejects(
    () => readChangedPaths(client({ getError: new Error('denied') }), 'acme', 'example', 42, 'head-sha'),
    /denied/,
  );
});

function validPull() {
  return {
    head: { sha: 'head-sha' },
    changed_files: 2,
  };
}

function client(options: {
  pull?: ReturnType<typeof validPull>;
  files?: { filename: string }[];
  getError?: Error;
} = {}) {
  const files = options.files ?? [{ filename: 'package.json' }, { filename: 'package-lock.json' }];

  return {
    rest: {
      pulls: {
        get: async () => {
          if (options.getError !== undefined) {
            throw options.getError;
          }

          return { data: options.pull ?? validPull() };
        },
        listFiles: () => undefined,
      },
    },
    paginate: async () => files,
  } as never;
}
