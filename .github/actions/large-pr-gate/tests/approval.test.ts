import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalCandidates, type Review } from '../src/approval.js';

const AUTHOR = 1;
const HEAD = 'head-sha';

function review(overrides: Partial<Review> = {}): Review {
  return {
    reviewerId: 2,
    reviewerLogin: 'reviewer',
    reviewerType: 'User',
    state: 'APPROVED',
    commitId: HEAD,
    ...overrides,
  };
}

test('names a user who approved the head commit', () => {
  assert.deepEqual(approvalCandidates([review()], AUTHOR, HEAD), ['reviewer']);
});

test('skips reviews that are not a human approval of the head', () => {
  const cases: Partial<Review>[] = [
    { reviewerId: AUTHOR },
    { reviewerType: 'Bot' },
    { commitId: 'older-sha' },
    { commitId: null },
    { state: 'COMMENTED' },
    { state: 'DISMISSED' },
    { state: 'PENDING' },
  ];

  for (const overrides of cases) {
    assert.deepEqual(approvalCandidates([review(overrides)], AUTHOR, HEAD), [], JSON.stringify(overrides));
  }
});

test('names nobody without reviews', () => {
  assert.deepEqual(approvalCandidates([], AUTHOR, HEAD), []);
});

test('a later change request replaces the approval', () => {
  assert.deepEqual(approvalCandidates([review(), review({ state: 'CHANGES_REQUESTED' })], AUTHOR, HEAD), []);
});

test('a later comment keeps the approval', () => {
  assert.deepEqual(approvalCandidates([review(), review({ state: 'COMMENTED' })], AUTHOR, HEAD), ['reviewer']);
});

test('names every qualifying reviewer', () => {
  assert.deepEqual(approvalCandidates([
    review({ reviewerId: 3, reviewerLogin: 'bot', reviewerType: 'Bot' }),
    review({ reviewerId: 4, reviewerLogin: 'skeptic', state: 'CHANGES_REQUESTED' }),
    review({ reviewerId: 5, reviewerLogin: 'first' }),
    review({ reviewerId: 6, reviewerLogin: 'second' }),
  ], AUTHOR, HEAD), ['first', 'second']);
});
