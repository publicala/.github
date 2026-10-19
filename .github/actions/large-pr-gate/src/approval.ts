export interface Review {
  reviewerId: number;
  reviewerType: string;
  association: string;
  state: string;
  commitId: string | null;
}

const WRITE_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// GitHub keeps the latest decisive review per reviewer. A comment does not
// replace an approval, a change request or a dismissal does.
const DECISIVE_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

export function hasHumanApproval(
  reviews: readonly Review[],
  authorId: number,
  headSha: string,
): boolean {
  const latest = new Map<number, Review>();

  for (const review of reviews) {
    if (DECISIVE_STATES.has(review.state)) {
      latest.set(review.reviewerId, review);
    }
  }

  return [...latest.values()].some((review) => review.state === 'APPROVED'
    && review.commitId === headSha
    && review.reviewerId !== authorId
    && review.reviewerType === 'User'
    && WRITE_ASSOCIATIONS.has(review.association));
}
