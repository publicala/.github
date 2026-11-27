import { getOctokit } from '@actions/github';
import { GateError } from '../../shared/src/failure.js';

type Octokit = ReturnType<typeof getOctokit>;

const MAX_CHANGED_FILES = 3_000;

export async function readChangedPaths(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  expectedHeadSha: string,
): Promise<Set<string>> {
  const response = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  const pull = response.data;

  if (pull.head.sha !== expectedHeadSha) {
    throw new GateError('The pull request head changed during evaluation.');
  }

  const changedFileCount = nonNegativeInteger(pull.changed_files, 'changed file count');
  if (changedFileCount > MAX_CHANGED_FILES) {
    throw new GateError('The pull request file list exceeds the GitHub API limit.');
  }

  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  if (files.length !== changedFileCount) {
    throw new GateError('The pull request file list is incomplete.');
  }

  return new Set(files.map((file) => file.filename));
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new GateError(`The pull request ${field} is invalid.`);
  }

  return Number(value);
}
