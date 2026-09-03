import assert from 'node:assert/strict';
import test from 'node:test';
import { RepositoryReader, resolveCandidate } from '../src/github.js';

test('reads a nested regular blob without checking out the candidate tree', async () => {
  const octokit = {
    rest: {
      git: {
        getCommit: async () => ({ data: { tree: { sha: 'root' } } }),
        getTree: async ({ tree_sha }: { tree_sha: string }) => ({
          data: {
            tree: tree_sha === 'root'
              ? [{ path: 'nested', type: 'tree', sha: 'directory', mode: '040000' }]
              : [{ path: 'package-lock.json', type: 'blob', sha: 'blob', mode: '100644' }],
          },
        }),
        getBlob: async () => ({ data: { encoding: 'base64', content: Buffer.from('safe data').toString('base64') } }),
      },
    },
  };
  const reader = new RepositoryReader(octokit as never, 'acme', 'repo');

  assert.equal(await reader.read('merge', 'nested/package-lock.json'), 'safe data');
  assert.equal(await reader.read('merge', 'missing.lock'), null);
  await assert.rejects(() => reader.read('merge', '../secret'), /Unsafe repository path/);
});

test('rejects symbolic links', async () => {
  const octokit = {
    rest: {
      git: {
        getCommit: async () => ({ data: { tree: { sha: 'root' } } }),
        getTree: async () => ({ data: { tree: [{ path: 'package-lock.json', type: 'blob', sha: 'blob', mode: '120000' }] } }),
      },
    },
  };
  const reader = new RepositoryReader(octokit as never, 'acme', 'repo');
  await assert.rejects(() => reader.read('merge', 'package-lock.json'), /symbolic link/);
});

test('uses GitHub synthetic merge result and rejects stale event data', async () => {
  const pull = {
    data: {
      head: { sha: 'head' },
      base: { sha: 'base' },
      mergeable: true,
      merge_commit_sha: 'merge',
    },
  };
  const octokit = { rest: { pulls: { get: async () => pull } } };
  const payload = {
    number: 22,
    pull_request: { head: { sha: 'head' }, base: { sha: 'base' } },
  };

  assert.deepEqual(
    await resolveCandidate(octokit as never, 'acme', 'repo', 'pull_request_target', payload),
    { baseSha: 'base', headSha: 'head', candidateSha: 'merge', pullRequests: new Set([22]) },
  );

  pull.data.head.sha = 'new-head';
  await assert.rejects(
    () => resolveCandidate(octokit as never, 'acme', 'repo', 'pull_request_target', payload),
    /head changed/,
  );
});

test('uses the merge-group SHA and finds its pull requests', async () => {
  const octokit = {
    rest: { repos: { listPullRequestsAssociatedWithCommit: () => undefined } },
    paginate: async () => [{ number: 21 }, { number: 22 }],
  };
  const result = await resolveCandidate(octokit as never, 'acme', 'repo', 'merge_group', {
    merge_group: { base_sha: 'base', head_sha: 'group', head_ref: 'refs/heads/gh-readonly-queue/main/pr-23-abcd' },
  });

  assert.equal(result.candidateSha, 'group');
  assert.deepEqual(result.pullRequests, new Set([21, 22, 23]));
});

