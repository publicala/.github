import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalCandidates, type Review } from '../src/approval.js';

const AUTHOR = 1;

function review(overrides: Partial<Review> = {}): Review {
  return {
    reviewerId: 2,
    reviewerLogin: 'reviewer',
    reviewerType: 'User',
    state: 'APPROVED',
    ...overrides,
  };
}

test('names a user who approved the pull request', () => {
  assert.deepEqual(approvalCandidates([review()], AUTHOR), ['reviewer']);
});

test('skips reviews that are not a human approval', () => {
  const cases: Partial<Review>[] = [
    { reviewerId: AUTHOR },
    { reviewerType: 'Bot' },
    { state: 'COMMENTED' },
    { state: 'DISMISSED' },
    { state: 'PENDING' },
  ];

  for (const overrides of cases) {
    assert.deepEqual(approvalCandidates([review(overrides)], AUTHOR), [], JSON.stringify(overrides));
  }
});

test('names nobody without reviews', () => {
  assert.deepEqual(approvalCandidates([], AUTHOR), []);
});

test('a later change request replaces the approval', () => {
  assert.deepEqual(approvalCandidates([review(), review({ state: 'CHANGES_REQUESTED' })], AUTHOR), []);
});

test('a later comment keeps the approval', () => {
  assert.deepEqual(approvalCandidates([review(), review({ state: 'COMMENTED' })], AUTHOR), ['reviewer']);
});

test('names every qualifying reviewer', () => {
  assert.deepEqual(approvalCandidates([
    review({ reviewerId: 3, reviewerLogin: 'bot', reviewerType: 'Bot' }),
    review({ reviewerId: 4, reviewerLogin: 'skeptic', state: 'CHANGES_REQUESTED' }),
    review({ reviewerId: 5, reviewerLogin: 'first' }),
    review({ reviewerId: 6, reviewerLogin: 'second' }),
  ], AUTHOR), ['first', 'second']);
});
