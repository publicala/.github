import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseAlerts } from './alerts.js';
import { evaluateGate, passes } from './gate.js';
import { RepositoryReader, resolveCandidate } from './github.js';
import type { Alert, GateResult } from './types.js';

async function run(): Promise<void> {
  try {
    const alertsToken = core.getInput('alerts-token', { required: true });
    const repositoryToken = core.getInput('repository-token', { required: true });
    const acceptancePath = core.getInput('acceptance-file', { required: true });
    const slaHours = positiveInteger(core.getInput('sla-hours', { required: true }), 'sla-hours');
    const { owner, repo } = github.context.repo;
    const repositoryClient = github.getOctokit(repositoryToken);
    const alertsClient = github.getOctokit(alertsToken);
    const candidate = await resolveCandidate(
      repositoryClient,
      owner,
      repo,
      github.context.eventName,
      github.context.payload as Record<string, unknown>,
    );
    const response = await alertsClient.paginate(alertsClient.rest.dependabot.listAlertsForRepo, {
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });
    const alerts = parseAlerts(response);
    const reader = new RepositoryReader(repositoryClient, owner, repo);
    const result = await evaluateGate({
      alerts,
      candidate,
      now: new Date(),
      slaHours,
      acceptancePath,
      readFile: (sha, path) => reader.read(sha, path),
    });

    await writeSummary(result, alerts, slaHours);
    core.setOutput('base-blocked-count', result.baseBlocked.length);
    core.setOutput('candidate-blocked-count', result.candidateBlocked.length);

    if (!passes(result)) {
      for (const alert of result.candidateBlocked) {
        core.error(finding(alert, result.unverified[alert.number]));
      }
      core.setFailed(
        `${result.candidateBlocked.length} overdue Critical alert(s) remain. `
        + 'This change must fix or receive reviewed acceptance for at least one blocking alert.',
      );
      return;
    }

    if (result.baseBlocked.length > 0) {
      core.info(
        `The blocking Critical alert count falls from ${result.baseBlocked.length} `
        + `to ${result.candidateBlocked.length}. The gate passes.`,
      );
    } else {
      core.info('No overdue unaccepted Critical alerts. The gate passes.');
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

async function writeSummary(result: GateResult, alerts: Alert[], slaHours: number): Promise<void> {
  const critical = alerts.filter((alert) => alert.severity === 'critical');
  core.summary
    .addHeading('Dependabot Critical gate')
    .addList([
      `Critical SLA: ${slaHours} hours`,
      `Open Critical: ${critical.length}`,
      `Blocking before this change: ${result.baseBlocked.length}`,
      `Blocking after this change: ${result.candidateBlocked.length}`,
      `Fixed by this change: ${result.fixed.length}`,
      `Covered by reviewed acceptance: ${result.accepted.length}`,
      `Open High: ${result.reported.high}; open Medium: ${result.reported.medium} (report only)`,
    ]);

  if (result.candidateBlocked.length > 0) {
    core.summary.addHeading('Alerts that remain', 3).addTable([
      [
        { data: 'Alert', header: true },
        { data: 'Package', header: true },
        { data: 'Manifest', header: true },
        { data: 'Result', header: true },
      ],
      ...result.candidateBlocked.map((alert) => [
        `[#${alert.number}](${alert.htmlUrl})`,
        `\`${alert.package}\``,
        `\`${alert.manifest}\``,
        result.unverified[alert.number] ?? 'The candidate still has a vulnerable version.',
      ]),
    ]);
  }

  core.summary.addRaw(
    passes(result)
      ? '\nThis change reduces the block or leaves no overdue Critical alerts.\n'
      : '\nThis change does not reduce the overdue Critical alert count.\n',
  );
  await core.summary.write();
}

function finding(alert: Alert, reason?: string): string {
  return `Dependabot alert #${alert.number} (${alert.ghsa}) for ${alert.package} remains blocking. `
    + (reason ?? 'The candidate merge result still contains a vulnerable version.');
}

function positiveInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return Number(value);
}

void run();

