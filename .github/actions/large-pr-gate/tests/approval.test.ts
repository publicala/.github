import assert from 'node:assert/strict';
import test from 'node:test';
import { hasHumanApproval, type Review } from '../src/approval.js';

const AUTHOR = 1;
const HEAD = 'head-sha';

function review(overrides: Partial<Review> = {}): Review {
  return {
    reviewerId: 2,
    reviewerType: 'User',
    association: 'MEMBER',
    state: 'APPROVED',
    commitId: HEAD,
    ...overrides,
  };
}

test('accepts a member approval of the head commit', () => {
  assert.equal(hasHumanApproval([review()], AUTHOR, HEAD), true);
  assert.equal(hasHumanApproval([review({ association: 'OWNER' })], AUTHOR, HEAD), true);
  assert.equal(hasHumanApproval([review({ association: 'COLLABORATOR' })], AUTHOR, HEAD), true);
});

test('rejects approvals that are not an explicit human approval of the head', () => {
  const cases: Partial<Review>[] = [
    { reviewerId: AUTHOR },
    { reviewerType: 'Bot' },
    { association: 'CONTRIBUTOR' },
    { association: 'NONE' },
    { commitId: 'older-sha' },
    { commitId: null },
    { state: 'COMMENTED' },
    { state: 'DISMISSED' },
    { state: 'PENDING' },
  ];

  for (const overrides of cases) {
    assert.equal(hasHumanApproval([review(overrides)], AUTHOR, HEAD), false, JSON.stringify(overrides));
  }
});

test('rejects no reviews', () => {
  assert.equal(hasHumanApproval([], AUTHOR, HEAD), false);
});

test('a later change request replaces the approval', () => {
  assert.equal(hasHumanApproval([review(), review({ state: 'CHANGES_REQUESTED' })], AUTHOR, HEAD), false);
});

test('a later comment keeps the approval', () => {
  assert.equal(hasHumanApproval([review(), review({ state: 'COMMENTED' })], AUTHOR, HEAD), true);
});

test('one qualifying reviewer is enough', () => {
  assert.equal(hasHumanApproval([
    review({ reviewerId: 3, reviewerType: 'Bot' }),
    review({ reviewerId: 4, state: 'CHANGES_REQUESTED' }),
    review({ reviewerId: 5 }),
  ], AUTHOR, HEAD), true);
});
