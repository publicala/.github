import assert from 'node:assert/strict';
import test from 'node:test';
import type { Review } from '../src/approval.js';
import { evaluateGate, type PullRequestSource } from '../src/gate.js';
import type { ChangedFile } from '../src/size.js';

const APPROVAL: Review = {
  reviewerId: 2,
  reviewerType: 'User',
  association: 'MEMBER',
  state: 'APPROVED',
  commitId: 'head-sha',
};

function source(options: {
  additions: number;
  deletions?: number;
  files?: ChangedFile[] | undefined;
  gitattributes?: string;
  reviews?: Review[];
}): PullRequestSource & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    async pull() {
      calls.push('pull');
      return { authorId: 1, headSha: 'head-sha', additions: options.additions, deletions: options.deletions ?? 0 };
    },
    async files() {
      calls.push('files');
      return options.files;
    },
    async gitattributes() {
      calls.push('gitattributes');
      return options.gitattributes ?? '';
    },
    async reviews() {
      calls.push('reviews');
      return options.reviews ?? [];
    },
  };
}

test('passes a pull request at the limit without listing files', async () => {
  const pull = source({ additions: 15_000, deletions: 5_000 });

  assert.deepEqual(await evaluateGate(pull, 20_000), { decision: 'pass', lines: 20_000 });
  assert.deepEqual(pull.calls, ['pull']);
});

test('passes when generated files carry the excess', async () => {
  const pull = source({
    additions: 60_000,
    files: [
      { filename: 'package-lock.json', additions: 50_000, deletions: 0 },
      { filename: 'api/client.ts', additions: 8_000, deletions: 0 },
      { filename: 'src/feature.ts', additions: 2_000, deletions: 0 },
    ],
    gitattributes: 'api/** linguist-generated',
  });

  assert.deepEqual(await evaluateGate(pull, 20_000), { decision: 'pass', lines: 2_000 });
  assert.equal(pull.calls.includes('reviews'), false);
});

test('blocks a large pull request without an approval', async () => {
  const pull = source({ additions: 87_694, deletions: 635, files: [
    { filename: 'app/Store.php', additions: 87_694, deletions: 635 },
  ] });

  assert.deepEqual(await evaluateGate(pull, 20_000), { decision: 'block', lines: 88_329 });
});

test('passes a large pull request with a human approval of the head', async () => {
  const pull = source({
    additions: 30_000,
    files: [{ filename: 'src/feature.ts', additions: 30_000, deletions: 0 }],
    reviews: [APPROVAL],
  });

  assert.deepEqual(await evaluateGate(pull, 20_000), { decision: 'approved', lines: 30_000 });
});

test('falls back to the raw count above the file list limit', async () => {
  const pull = source({ additions: 25_000, files: undefined });

  assert.deepEqual(await evaluateGate(pull, 20_000), { decision: 'block', lines: 25_000 });
  assert.equal(pull.calls.includes('gitattributes'), false);
});
