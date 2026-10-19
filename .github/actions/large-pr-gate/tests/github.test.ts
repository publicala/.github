import assert from 'node:assert/strict';
import test from 'node:test';
import { pullRequestSource } from '../src/github.js';

type Client = Parameters<typeof pullRequestSource>[0];

function validPull() {
  return {
    user: { id: 1 },
    head: { sha: 'head-sha' },
    base: { sha: 'base-sha' },
    additions: 30_000,
    deletions: 10,
    changed_files: 2,
  };
}

function client(options: {
  pull?: ReturnType<typeof validPull>;
  files?: unknown[];
  reviews?: unknown[];
  content?: () => unknown;
} = {}): Client & { contentRefs: string[] } {
  const listFiles = Symbol('listFiles');
  const listReviews = Symbol('listReviews');
  const contentRefs: string[] = [];

  return {
    contentRefs,
    rest: {
      pulls: {
        get: async () => ({ data: options.pull ?? validPull() }),
        listFiles,
        listReviews,
      },
      repos: {
        getContent: async ({ ref }: { ref: string }) => {
          contentRefs.push(ref);
          return { data: options.content?.() ?? { type: 'file', content: Buffer.from('api/** linguist-generated').toString('base64') } };
        },
      },
    },
    paginate: async (method: symbol) => {
      if (method === listFiles) {
        return options.files ?? [
          { filename: 'src/a.ts', additions: 20_000, deletions: 10 },
          { filename: 'api/b.ts', additions: 10_000, deletions: 0 },
        ];
      }

      return options.reviews ?? [];
    },
  } as unknown as Client & { contentRefs: string[] };
}

test('reads pull request facts', async () => {
  const source = pullRequestSource(client(), 'acme', 'example', 42, 'head-sha');

  assert.deepEqual(await source.pull(), { authorId: 1, headSha: 'head-sha', additions: 30_000, deletions: 10 });
});

test('fails when the head moved during evaluation', async () => {
  const source = pullRequestSource(client(), 'acme', 'example', 42, 'other-sha');

  await assert.rejects(source.pull(), /head changed/);
});

test('fails on an invalid pull request count', async () => {
  const pull = validPull();
  pull.additions = -1;

  await assert.rejects(pullRequestSource(client({ pull }), 'acme', 'example', 42, 'head-sha').pull(), /addition count/);
});

test('lists changed files and rejects an incomplete list', async () => {
  const files = await pullRequestSource(client(), 'acme', 'example', 42, 'head-sha').files();
  assert.equal(files?.length, 2);

  const incomplete = pullRequestSource(client({ files: [{ filename: 'a', additions: 1, deletions: 0 }] }), 'acme', 'example', 42, 'head-sha');
  await assert.rejects(incomplete.files(), /incomplete/);
});

test('reports no file list above the GitHub limit', async () => {
  const pull = validPull();
  pull.changed_files = 3_001;

  assert.equal(await pullRequestSource(client({ pull }), 'acme', 'example', 42, 'head-sha').files(), undefined);
});

test('reads .gitattributes from the base commit', async () => {
  const github = client();
  const content = await pullRequestSource(github, 'acme', 'example', 42, 'head-sha').gitattributes();

  assert.equal(content, 'api/** linguist-generated');
  assert.deepEqual(github.contentRefs, ['base-sha']);
});

test('treats a missing .gitattributes as empty and rethrows other errors', async () => {
  const missing = client({ content: () => { throw Object.assign(new Error('Not Found'), { status: 404 }); } });
  assert.equal(await pullRequestSource(missing, 'acme', 'example', 42, 'head-sha').gitattributes(), '');

  const failing = client({ content: () => { throw Object.assign(new Error('Server Error'), { status: 500 }); } });
  await assert.rejects(pullRequestSource(failing, 'acme', 'example', 42, 'head-sha').gitattributes(), /Server Error/);
});

test('maps reviews and skips deleted reviewers', async () => {
  const reviews = await pullRequestSource(client({ reviews: [
    { user: { id: 2, type: 'User' }, author_association: 'MEMBER', state: 'APPROVED', commit_id: 'head-sha' },
    { user: null, author_association: 'NONE', state: 'APPROVED', commit_id: 'head-sha' },
  ] }), 'acme', 'example', 42, 'head-sha').reviews();

  assert.deepEqual(reviews, [
    { reviewerId: 2, reviewerType: 'User', association: 'MEMBER', state: 'APPROVED', commitId: 'head-sha' },
  ]);
});
