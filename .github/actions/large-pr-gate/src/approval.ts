export interface Review {
  reviewerId: number;
  reviewerLogin: string;
  reviewerType: string;
  state: string;
  commitId: string | null;
}

// GitHub keeps the latest decisive review per reviewer. A comment does not
// replace an approval, a change request or a dismissal does.
const DECISIVE_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

// Reviewers whose approval counts once their repository permission is confirmed.
export function approvalCandidates(
  reviews: readonly Review[],
  authorId: number,
  headSha: string,
): string[] {
  const latest = new Map<number, Review>();

  for (const review of reviews) {
    if (DECISIVE_STATES.has(review.state)) {
      latest.set(review.reviewerId, review);
    }
  }

  return [...latest.values()]
    .filter((review) => review.state === 'APPROVED'
      && review.commitId === headSha
      && review.reviewerId !== authorId
      && review.reviewerType === 'User')
    .map((review) => review.reviewerLogin);
}
