import { getOctokit } from '@actions/github';
import { repositoryPath } from './paths.js';

type Octokit = ReturnType<typeof getOctokit>;

const DEPENDABOT_ID = 49_699_333;
const DEPENDABOT_LOGIN = 'dependabot[bot]';
const WEB_FLOW_ID = 19_864_447;
const WEB_FLOW_LOGIN = 'web-flow';
const MAX_COMMITS = 250;
const MAX_CHANGED_FILES = 3_000;

export interface PullRequestEvidence {
  isVerifiedDependabot: boolean;
  changedPaths: Set<string>;
}

export async function readPullRequestEvidence(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  expectedHeadSha: string,
): Promise<PullRequestEvidence> {
  const response = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  const pull = response.data;

  if (pull.head.sha !== expectedHeadSha) {
    throw new Error('The pull request head changed during evaluation.');
  }

  if (!isDependabotPullRequest(pull, owner, repo)) {
    return ineligibleEvidence();
  }

  const commitCount = positiveInteger(pull.commits, 'commit count');
  if (commitCount > MAX_COMMITS) {
    throw new Error('The pull request commit list exceeds the GitHub API limit.');
  }

  const commits = await octokit.paginate(octokit.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  if (commits.length !== commitCount) {
    throw new Error('The pull request commit list is incomplete.');
  }

  if (!commits.every(isVerifiedDependabotCommit)) {
    return ineligibleEvidence();
  }

  const changedFileCount = nonNegativeInteger(pull.changed_files, 'changed file count');
  if (changedFileCount > MAX_CHANGED_FILES) {
    throw new Error('The pull request file list exceeds the GitHub API limit.');
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

  return {
    isVerifiedDependabot: true,
    changedPaths: new Set(files.map((file) => repositoryPath(file.filename, 'changed file path'))),
  };
}

function isDependabotPullRequest(
  pull: Awaited<ReturnType<Octokit['rest']['pulls']['get']>>['data'],
  owner: string,
  repo: string,
): boolean {
  return pull.user?.id === DEPENDABOT_ID
    && pull.user.login === DEPENDABOT_LOGIN
    && pull.user.type === 'Bot'
    && pull.head.repo?.full_name.toLowerCase() === `${owner}/${repo}`.toLowerCase();
}

function isVerifiedDependabotCommit(
  commit: Awaited<ReturnType<Octokit['rest']['pulls']['listCommits']>>['data'][number],
): boolean {
  return commit.author?.id === DEPENDABOT_ID
    && commit.author.login === DEPENDABOT_LOGIN
    && commit.committer?.id === WEB_FLOW_ID
    && commit.committer.login === WEB_FLOW_LOGIN
    && commit.commit.verification?.verified === true
    && commit.commit.verification.reason === 'valid';
}

function ineligibleEvidence(): PullRequestEvidence {
  return { isVerifiedDependabot: false, changedPaths: new Set() };
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
