import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKER, runBundle, type FakeGitHub } from '../../shared/tests/bundle-run.js';

const BUNDLE = '.github/actions/dependabot-critical-gate/dist/index.cjs';
const INPUTS = { 'alerts-token': 'alerts-token-value', 'repository-token': 'repository-token-value', 'sla-hours': '168' };
const REQUEST_ID = 'C0DE:12AB:3F4E5D:6A7B8C:69091A2B';

test('names a failed alerts request without its response body', async () => {
  const result = await runBundle(BUNDLE, INPUTS, () => ({
    status: 403,
    body: { message: `Resource not accessible: ${MARKER}` },
    headers: { 'x-github-request-id': REQUEST_ID },
  }));

  assert.equal(result.status, 1);
  assert.match(
    result.output,
    new RegExp(`::error::The gate could not complete\\. Reason: A GitHub API request failed: GET /repos/acme/example/dependabot/alerts returned HTTP 403\\. GitHub request ID: ${REQUEST_ID}\\.`),
  );
  assert.match(result.summary, /Reason: A GitHub API request failed/);
  assertNoMarker(result);
});

test('reports invalid alert data with one reason and no alert details', async () => {
  const result = await runBundle(BUNDLE, INPUTS, () => ({ status: 200, body: [overdueAlert({ manifest_path: '' })] }));

  assert.equal(result.status, 1);
  assert.match(result.output, /Reason: The Dependabot alerts response is invalid\./);
  assertNoMarker(result);
});

test('names a failed pull request read without the overdue alert details', async () => {
  const github: FakeGitHub = (request) => request.url?.startsWith('/repos/acme/example/dependabot/alerts')
    ? { status: 200, body: [overdueAlert()] }
    : { status: 500, body: { message: `Server Error: ${MARKER}` } };

  const result = await runBundle(BUNDLE, INPUTS, github);

  assert.equal(result.status, 1);
  assert.match(result.output, /Reason: A GitHub API request failed: GET \/repos\/acme\/example\/pulls\/42 returned HTTP 500\./);
  assertNoMarker(result);
});

test('reports a request that never reached GitHub', async () => {
  const result = await runBundle(BUNDLE, INPUTS, 'unreachable');

  assert.equal(result.status, 1);
  assert.match(
    result.output,
    /Reason: A GitHub API request failed before GitHub sent a response: GET \/repos\/acme\/example\/dependabot\/alerts\./,
  );
});

function overdueAlert(dependency: Record<string, unknown> = {}) {
  return {
    number: 7,
    state: 'open',
    created_at: '2020-01-01T00:00:00Z',
    security_advisory: { severity: 'critical', ghsa_id: MARKER, summary: MARKER },
    security_vulnerability: { package: { name: MARKER }, vulnerable_version_range: MARKER },
    dependency: { manifest_path: `${MARKER}/package.json`, package: { ecosystem: 'npm', name: MARKER }, ...dependency },
  };
}

function assertNoMarker(result: { output: string; summary: string }) {
  assert.doesNotMatch(result.output, new RegExp(MARKER));
  assert.doesNotMatch(result.summary, new RegExp(MARKER));
}

test('keeps a response body that imitates stack frames out of the debug log', async () => {
  const result = await runBundle(BUNDLE, INPUTS, () => ({ status: 422, body: { message: `Validation failed:\n    at ${MARKER}/package.json:1:1` } }));

  assert.equal(result.status, 1);
  assert.match(result.output, /::debug::HttpError/);
  assert.doesNotMatch(result.output, new RegExp(MARKER));
});

test('replaces client warnings with a fixed message', async () => {
  const result = await runBundle(BUNDLE, INPUTS, () => ({ status: 200, body: [], headers: deprecationHeaders() }));

  assert.equal(result.status, 0);
  assert.match(result.output, /::warning::The GitHub API client reported a warning\. Its text stays out of public logs\./);
  assert.doesNotMatch(result.output, new RegExp(`${MARKER}|per_page`));
});

function deprecationHeaders() {
  return { deprecation: 'true', sunset: MARKER, link: `<https://example.com/${MARKER}>; rel="deprecation"` };
}
