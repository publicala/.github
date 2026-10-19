import { getOctokit } from '@actions/github';
import type { Review } from './approval.js';
import type { PullRequestSource } from './gate.js';
import type { ChangedFile } from './size.js';

type Octokit = ReturnType<typeof getOctokit>;

const MAX_CHANGED_FILES = 3_000;

export function pullRequestSource(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  expectedHeadSha: string,
): PullRequestSource {
  const pullRequest = octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber }).then(({ data: pull }) => {
    if (pull.head.sha !== expectedHeadSha) {
      throw new Error('The pull request head changed during evaluation.');
    }

    return pull;
  });

  return {
    async pull() {
      const pull = await pullRequest;

      return {
        authorId: positiveInteger(pull.user?.id, 'author'),
        headSha: pull.head.sha,
        additions: nonNegativeInteger(pull.additions, 'addition count'),
        deletions: nonNegativeInteger(pull.deletions, 'deletion count'),
      };
    },

    async files() {
      const changedFileCount = nonNegativeInteger((await pullRequest).changed_files, 'changed file count');
      if (changedFileCount > MAX_CHANGED_FILES) {
        return undefined;
      }

      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      });

      if (files.length !== changedFileCount) {
        throw new Error('The pull request file list is incomplete.');
      }

      return files.map((file): ChangedFile => ({
        filename: file.filename,
        additions: nonNegativeInteger(file.additions, 'file addition count'),
        deletions: nonNegativeInteger(file.deletions, 'file deletion count'),
      }));
    },

    // Read from the base commit: the pull request must not reclassify its own lines.
    async gitattributes() {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: '.gitattributes',
          ref: (await pullRequest).base.sha,
        });

        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
          return '';
        }

        return Buffer.from(data.content, 'base64').toString('utf8');
      } catch (error) {
        if (isNotFound(error)) {
          return '';
        }

        throw error;
      }
    },

    async reviews() {
      const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      });

      return reviews.flatMap((review): Review[] => review.user === null || review.user === undefined
        ? []
        : [{
          reviewerId: review.user.id,
          reviewerLogin: review.user.login,
          reviewerType: review.user.type,
          state: review.state,
          commitId: review.commit_id,
        }]);
    },

    // Team, organization base, and custom role grants resolve to admin, write, read, or none.
    async hasWriteAccess(login) {
      try {
        const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login });

        return data.permission === 'admin' || data.permission === 'write';
      } catch (error) {
        if (isNotFound(error)) {
          return false;
        }

        throw error;
      }
    },
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`The pull request ${field} is invalid.`);
  }

  return Number(value);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`The pull request ${field} is invalid.`);
  }

  return Number(value);
}
