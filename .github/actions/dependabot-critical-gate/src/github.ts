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
  expectedBaseRef: string,
): Promise<Set<string>> {
  const readPull = async () => (await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber })).data;
  const pull = await readPull();

  if (pull.head.sha !== expectedHeadSha) {
    throw new GateError('The pull request head changed during evaluation.');
  }

  // A re-run of an event from before a retarget still carries the old base branch.
  if (pull.base.ref !== expectedBaseRef) {
    throw new GateError('The pull request base branch changed after this event.');
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

  // A push or a retarget between the two reads leaves a file list of another diff.
  const pullAfterFiles = await readPull();
  if (
    pullAfterFiles.head.sha !== expectedHeadSha
    || pullAfterFiles.base.ref !== expectedBaseRef
    || pullAfterFiles.base.sha !== pull.base.sha
    || pullAfterFiles.changed_files !== changedFileCount
  ) {
    throw new GateError('The pull request changed during evaluation.');
  }

  // A renamed manifest counts under the path the alert still names.
  return new Set(files.flatMap((file) => (
    file.status === 'renamed' && file.previous_filename !== undefined
      ? [file.filename, file.previous_filename]
      : [file.filename]
  )));
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new GateError(`The pull request ${field} is invalid.`);
  }

  return Number(value);
}
