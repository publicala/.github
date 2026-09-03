import { getOctokit } from '@actions/github';
import type { Candidate } from './types.js';

type Octokit = ReturnType<typeof getOctokit>;
type JsonObject = Record<string, unknown>;

const MAX_BLOB_BYTES = 10 * 1024 * 1024;

export async function resolveCandidate(
  octokit: Octokit,
  owner: string,
  repo: string,
  eventName: string,
  payload: JsonObject,
  pause: (milliseconds: number) => Promise<void> = delay,
): Promise<Candidate> {
  if (eventName === 'pull_request_target') {
    return pullRequestCandidate(octokit, owner, repo, payload, pause);
  }

  if (eventName === 'merge_group') {
    return mergeGroupCandidate(octokit, owner, repo, payload);
  }

  throw new Error(`Unsupported event: ${eventName}.`);
}

export class RepositoryReader {
  readonly #octokit: Octokit;
  readonly #owner: string;
  readonly #repo: string;
  readonly #rootTrees = new Map<string, string>();
  readonly #files = new Map<string, string | null>();

  constructor(octokit: Octokit, owner: string, repo: string) {
    this.#octokit = octokit;
    this.#owner = owner;
    this.#repo = repo;
  }

  async read(sha: string, path: string): Promise<string | null> {
    validatePath(path);
    const cacheKey = `${sha}:${path}`;
    if (this.#files.has(cacheKey)) {
      return this.#files.get(cacheKey) ?? null;
    }

    let treeSha = await this.#rootTree(sha);
    const parts = path.split('/');

    for (const [index, part] of parts.entries()) {
      const response = await this.#octokit.rest.git.getTree({
        owner: this.#owner,
        repo: this.#repo,
        tree_sha: treeSha,
      });
      const entry = response.data.tree.find((candidate) => candidate.path === part);

      if (entry === undefined) {
        this.#files.set(cacheKey, null);
        return null;
      }

      const last = index === parts.length - 1;
      if (!last) {
        if (entry.type !== 'tree' || entry.sha === null) {
          this.#files.set(cacheKey, null);
          return null;
        }
        treeSha = entry.sha;
        continue;
      }

      if (entry.type !== 'blob' || entry.sha === null) {
        throw new Error(`${path} is not a regular file in ${sha}.`);
      }
      if (entry.mode === '120000') {
        throw new Error(`${path} is a symbolic link in ${sha}.`);
      }

      const blob = await this.#octokit.rest.git.getBlob({
        owner: this.#owner,
        repo: this.#repo,
        file_sha: entry.sha,
      });
      if (blob.data.encoding !== 'base64') {
        throw new Error(`${path} has an unsupported Git blob encoding.`);
      }

      const bytes = Buffer.from(blob.data.content.replaceAll('\n', ''), 'base64');
      if (bytes.byteLength > MAX_BLOB_BYTES) {
        throw new Error(`${path} is larger than the 10 MiB safety limit.`);
      }

      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      this.#files.set(cacheKey, content);
      return content;
    }

    throw new Error('The repository path is empty.');
  }

  async #rootTree(sha: string): Promise<string> {
    const cached = this.#rootTrees.get(sha);
    if (cached !== undefined) {
      return cached;
    }

    const commit = await this.#octokit.rest.git.getCommit({ owner: this.#owner, repo: this.#repo, commit_sha: sha });
    const treeSha = commit.data.tree.sha;
    this.#rootTrees.set(sha, treeSha);
    return treeSha;
  }
}

async function pullRequestCandidate(
  octokit: Octokit,
  owner: string,
  repo: string,
  payload: JsonObject,
  pause: (milliseconds: number) => Promise<void>,
): Promise<Candidate> {
  const eventPull = object(payload.pull_request, 'pull_request');
  const number = positiveInteger(payload.number, 'pull request number');
  const eventHead = requiredString(object(eventPull.head, 'pull_request.head').sha, 'pull_request.head.sha');
  const eventBase = requiredString(object(eventPull.base, 'pull_request.base').sha, 'pull_request.base.sha');

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
    const pull = response.data;

    if (pull.head.sha !== eventHead) {
      throw new Error('The pull request head changed after this run started. Re-run the gate.');
    }
    if (pull.base.sha !== eventBase) {
      throw new Error('The base branch changed after this run started. Update the branch or re-run the gate.');
    }
    if (pull.mergeable === false) {
      throw new Error('GitHub cannot create the pull request merge result because it has conflicts.');
    }
    if (pull.mergeable === true && pull.merge_commit_sha !== null) {
      return {
        baseSha: eventBase,
        headSha: eventHead,
        candidateSha: pull.merge_commit_sha,
        pullRequests: new Set([number]),
      };
    }

    if (attempt < 6) {
      await pause(2_000);
    }
  }

  throw new Error('GitHub did not produce a stable pull request merge result. Re-run the gate.');
}

async function mergeGroupCandidate(
  octokit: Octokit,
  owner: string,
  repo: string,
  payload: JsonObject,
): Promise<Candidate> {
  const group = object(payload.merge_group, 'merge_group');
  const baseSha = requiredString(group.base_sha, 'merge_group.base_sha');
  const headSha = requiredString(group.head_sha, 'merge_group.head_sha');
  const pullRequests = new Set<number>();

  const pulls = await octokit.paginate(octokit.rest.repos.listPullRequestsAssociatedWithCommit, {
    owner,
    repo,
    commit_sha: headSha,
    per_page: 100,
  });
  for (const pull of pulls) {
    pullRequests.add(pull.number);
  }

  const headRef = typeof group.head_ref === 'string' ? group.head_ref : '';
  for (const match of headRef.matchAll(/(?:^|\/)pr-(\d+)-/g)) {
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > 0) {
      pullRequests.add(number);
    }
  }

  return { baseSha, headSha, candidateSha: headSha, pullRequests };
}

function validatePath(path: string): void {
  if (path.length === 0 || path.length > 4_096 || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error(`Unsafe repository path: ${JSON.stringify(path)}.`);
  }
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe repository path: ${JSON.stringify(path)}.`);
  }
}

function object(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} is not an object.`);
  }
  return value as JsonObject;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is not a non-empty string.`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${field} is not a positive integer.`);
  }
  return Number(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
