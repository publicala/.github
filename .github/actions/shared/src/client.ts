import * as core from '@actions/core';
import * as github from '@actions/github';
import { defaults } from '@actions/github/lib/utils';

const CLIENT_WARNING = 'The GitHub API client reported a warning. Its text stays out of public logs.';

/**
 * Octokit logs request URLs and response headers on its own,
 * so its log text is replaced with one fixed warning.
 */
const PUBLIC_SAFE_LOG = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => core.warning(CLIENT_WARNING),
  error: () => core.warning(CLIENT_WARNING),
};

export function githubClient(token: string): ReturnType<typeof github.getOctokit> {
  // The request layer reads its own logger. Options merge shallowly, so keep the proxy defaults.
  return github.getOctokit(token, { log: PUBLIC_SAFE_LOG, request: { ...defaults.request, log: PUBLIC_SAFE_LOG } });
}
