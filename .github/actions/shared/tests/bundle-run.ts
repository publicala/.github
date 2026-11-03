import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MARKER = 'restricted-marker-7f3a';

export interface FakeResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type FakeGitHub = (request: IncomingMessage) => FakeResponse;

export interface BundleResult {
  status: number | null;
  output: string;
  summary: string;
}

/**
 * Runs a committed action bundle against a local GitHub API.
 *
 * The output joins stdout, stderr, and the job summary, so a
 * test can check everything the runner would publish.
 */
export async function runBundle(
  bundle: string,
  inputs: Record<string, string>,
  github: FakeGitHub | 'unreachable',
): Promise<BundleResult> {
  const directory = await mkdtemp(join(tmpdir(), 'gate-bundle-'));
  const eventPath = join(directory, 'event.json');
  const summaryPath = join(directory, 'summary.md');
  await writeFile(eventPath, JSON.stringify({ number: 42, pull_request: { number: 42, head: { sha: 'head-sha' } } }));
  await writeFile(summaryPath, '');

  const server = github === 'unreachable' ? undefined : await listen(github);
  const apiUrl = server === undefined ? 'http://127.0.0.1:9' : `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      GITHUB_API_URL: apiUrl,
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'acme/example',
      GITHUB_STEP_SUMMARY: summaryPath,
    };

    for (const [name, value] of Object.entries(inputs)) {
      env[`INPUT_${name.toUpperCase()}`] = value;
    }

    const { status, output } = await new Promise<{ status: number | null; output: string }>((resolve) => {
      execFile(process.execPath, [bundle], { env, encoding: 'utf8' }, (error, stdout, stderr) => {
        resolve({ status: error === null ? 0 : (typeof error.code === 'number' ? error.code : null), output: `${stdout}\n${stderr}` });
      });
    });

    return { status, output, summary: await readFile(summaryPath, 'utf8') };
  } finally {
    server?.close();
  }
}

async function listen(github: FakeGitHub) {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const { status, body, headers = {} } = github(request);
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return server;
}
