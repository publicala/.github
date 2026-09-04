import * as core from '@actions/core';
import * as github from '@actions/github';
import { overdueCriticalManifests } from './alerts.js';
import { decideGate } from './gate.js';
import { readPullRequestEvidence } from './github.js';

type JsonObject = Record<string, unknown>;

const PASS_MESSAGE = 'This repository has no blocking Dependabot condition.';
const BLOCK_MESSAGE = 'Repository maintainers must review Dependabot alerts in the Security view.';
const ERROR_MESSAGE = 'The gate could not complete. Repository maintainers must inspect this run.';

async function run(): Promise<void> {
  try {
    if (github.context.eventName !== 'pull_request_target') {
      throw new Error('The gate received an unsupported event.');
    }

    const alertsToken = core.getInput('alerts-token', { required: true });
    const repositoryToken = core.getInput('repository-token', { required: true });
    const slaHours = positiveInteger(core.getInput('sla-hours', { required: true }));
    core.setSecret(alertsToken);
    core.setSecret(repositoryToken);

    const { owner, repo } = github.context.repo;
    const alertsClient = github.getOctokit(alertsToken);
    const alerts = await alertsClient.paginate(alertsClient.rest.dependabot.listAlertsForRepo, {
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });
    const manifests = overdueCriticalManifests(alerts, new Date(), slaHours);

    if (manifests.size === 0) {
      await report(PASS_MESSAGE);
      return;
    }

    const event = pullRequestEvent(github.context.payload as JsonObject);
    const repositoryClient = github.getOctokit(repositoryToken);
    const evidence = await readPullRequestEvidence(
      repositoryClient,
      owner,
      repo,
      event.number,
      event.headSha,
    );

    if (decideGate(manifests, evidence) === 'pass') {
      await report(PASS_MESSAGE);
      return;
    }

    await report(BLOCK_MESSAGE);
    core.setFailed(BLOCK_MESSAGE);
  } catch {
    core.setFailed(ERROR_MESSAGE);
  }
}

async function report(message: string): Promise<void> {
  core.info(message);
  await core.summary
    .addHeading('Dependabot Critical gate')
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
