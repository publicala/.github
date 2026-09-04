import assert from 'node:assert/strict';
import test from 'node:test';
import { readPullRequestEvidence } from '../src/github.js';

test('accepts a complete GitHub-verified Dependabot pull request', async () => {
  const evidence = await readPullRequestEvidence(
    client(),
    'acme',
    'example',
    42,
    'head-sha',
  );

  assert.equal(evidence.isVerifiedDependabot, true);
  assert.deepEqual(evidence.changedPaths, new Set(['package.json', 'package-lock.json']));
});

test('rejects a pull request that is not authored by Dependabot', async () => {
  const cases = [
    (pull: ReturnType<typeof validPull>) => { pull.user.id = 1; },
    (pull: ReturnType<typeof validPull>) => { pull.user.login = 'another-user'; },
    (pull: ReturnType<typeof validPull>) => { pull.user.type = 'User'; },
  ];

  for (const mutate of cases) {
    const pull = validPull();
    mutate(pull);
    const evidence = await readPullRequestEvidence(client({ pull }), 'acme', 'example', 42, 'head-sha');

    assert.deepEqual(evidence, { isVerifiedDependabot: false, changedPaths: new Set() });
  }
});

test('rejects a Dependabot branch outside the target repository', async () => {
  const pull = validPull();
  pull.head.repo.full_name = 'another/example';

  const evidence = await readPullRequestEvidence(client({ pull }), 'acme', 'example', 42, 'head-sha');

  assert.equal(evidence.isVerifiedDependabot, false);
});

test('requires every commit to have the verified Dependabot identity', async () => {
  const cases = [
    (commit: ReturnType<typeof validCommit>) => { commit.author.id = 1; },
    (commit: ReturnType<typeof validCommit>) => { commit.author.login = 'another-user'; },
    (commit: ReturnType<typeof validCommit>) => { commit.committer.id = 1; },
    (commit: ReturnType<typeof validCommit>) => { commit.committer.login = 'another-user'; },
    (commit: ReturnType<typeof validCommit>) => { commit.commit.verification.verified = false; },
    (commit: ReturnType<typeof validCommit>) => { commit.commit.verification.reason = 'unsigned'; },
  ];

  for (const mutate of cases) {
    const pull = validPull();
    pull.commits = 2;
    const changedCommit = validCommit();
    mutate(changedCommit);
    const evidence = await readPullRequestEvidence(
      client({ pull, commits: [validCommit(), changedCommit] }),
      'acme',
      'example',
      42,
      'head-sha',
    );

    assert.equal(evidence.isVerifiedDependabot, false);
  }
});

test('fails closed when the event head is stale', async () => {
  await assert.rejects(
    () => readPullRequestEvidence(client(), 'acme', 'example', 42, 'old-head'),
    /head changed/,
  );
});

test('fails closed for incomplete commit and file pagination', async () => {
  const twoCommits = validPull();
  twoCommits.commits = 2;
  await assert.rejects(
    () => readPullRequestEvidence(client({ pull: twoCommits }), 'acme', 'example', 42, 'head-sha'),
    /commit list is incomplete/,
  );

  const threeFiles = validPull();
  threeFiles.changed_files = 3;
  await assert.rejects(
    () => readPullRequestEvidence(client({ pull: threeFiles }), 'acme', 'example', 42, 'head-sha'),
    /file list is incomplete/,
  );
});

test('fails closed when GitHub cannot return every commit or file', async () => {
  const tooManyCommits = validPull();
  tooManyCommits.commits = 251;
  await assert.rejects(
    () => readPullRequestEvidence(client({ pull: tooManyCommits }), 'acme', 'example', 42, 'head-sha'),
    /commit list exceeds/,
  );

  const tooManyFiles = validPull();
  tooManyFiles.changed_files = 3_001;
  await assert.rejects(
    () => readPullRequestEvidence(client({ pull: tooManyFiles }), 'acme', 'example', 42, 'head-sha'),
    /file list exceeds/,
  );
});

test('fails closed for an unsafe changed path', async () => {
  await assert.rejects(
    () => readPullRequestEvidence(
      client({ files: [{ filename: '../package-lock.json' }, { filename: 'package.json' }] }),
      'acme',
      'example',
      42,
      'head-sha',
    ),
    /changed file path is unsafe/,
  );
});

test('propagates GitHub API failures', async () => {
  await assert.rejects(
    () => readPullRequestEvidence(client({ getError: new Error('denied') }), 'acme', 'example', 42, 'head-sha'),
    /denied/,
  );
});

function validPull() {
  return {
    user: { id: 49_699_333, login: 'dependabot[bot]', type: 'Bot' },
    head: { sha: 'head-sha', repo: { full_name: 'acme/example' } },
    commits: 1,
    changed_files: 2,
  };
}

function validCommit() {
  return {
    author: { id: 49_699_333, login: 'dependabot[bot]' },
    committer: { id: 19_864_447, login: 'web-flow' },
    commit: { verification: { verified: true, reason: 'valid' } },
  };
}

function client(options: {
  pull?: ReturnType<typeof validPull>;
  commits?: ReturnType<typeof validCommit>[];
  files?: { filename: string }[];
  getError?: Error;
} = {}) {
  const listCommits = () => undefined;
  const listFiles = () => undefined;
  const commits = options.commits ?? [validCommit()];
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
        listCommits,
        listFiles,
      },
    },
    paginate: async (endpoint: unknown) => endpoint === listCommits ? commits : files,
  } as never;
}
