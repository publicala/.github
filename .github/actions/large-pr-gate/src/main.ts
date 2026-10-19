import * as core from '@actions/core';
import * as github from '@actions/github';
import { evaluateGate } from './gate.js';
import { pullRequestSource } from './github.js';

type JsonObject = Record<string, unknown>;

const ERROR_MESSAGE = 'The gate could not complete. Repository maintainers must inspect this run.';

async function run(): Promise<void> {
  try {
    if (github.context.eventName !== 'pull_request_target') {
      throw new Error('The gate received an unsupported event.');
    }

    const repositoryToken = core.getInput('repository-token', { required: true });
    const maxLines = positiveInteger(core.getInput('max-lines', { required: true }));
    core.setSecret(repositoryToken);

    const { owner, repo } = github.context.repo;
    const event = pullRequestEvent(github.context.payload as JsonObject);
    const result = await evaluateGate(
      pullRequestSource(github.getOctokit(repositoryToken), owner, repo, event.number, event.headSha),
      maxLines,
    );
    const lines = result.lines.toLocaleString('en-US');
    const limit = maxLines.toLocaleString('en-US');

    if (result.decision === 'pass') {
      await report(`This pull request changes ${lines} reviewable lines. The limit is ${limit}.`);
      return;
    }

    if (result.decision === 'approved') {
      await report(`This pull request changes ${lines} reviewable lines, above the ${limit} limit. A human reviewer approved the head commit.`);
      return;
    }

    const message = `This pull request changes ${lines} reviewable lines, above the ${limit} limit. `
      + 'A human with write access, other than the author, must approve the head commit. Then re-run this check.';
    await report(message);
    core.setFailed(message);
  } catch (error) {
    core.debug(error instanceof Error ? error.message : String(error));
    core.setFailed(ERROR_MESSAGE);
  }
}

async function report(message: string): Promise<void> {
  core.info(message);
  await core.summary
    .addHeading('Large PR gate')
    .addRaw(`${message}\n`)
    .write();
}

function pullRequestEvent(payload: JsonObject): { number: number; headSha: string } {
  const pull = object(payload.pull_request);
  const head = object(pull.head);

  return {
    number: positiveInteger(payload.number),
    headSha: requiredString(head.sha),
  };
}

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The pull request event is incomplete.');
  }

  return value as JsonObject;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('The pull request event is incomplete.');
  }

  return value;
}

function positiveInteger(value: unknown): number {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

  if (!Number.isSafeInteger(number) || Number(number) <= 0) {
    throw new Error('The gate has an invalid positive integer.');
  }

  return Number(number);
}

void run();
