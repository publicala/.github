import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKER, runBundle } from '../../shared/tests/bundle-run.js';

const BUNDLE = '.github/actions/large-pr-gate/dist/index.cjs';
const INPUTS = { 'repository-token': 'repository-token-value', 'max-lines': '20000' };

test('names a failed pull request read without its response body', async () => {
  const result = await runBundle(BUNDLE, INPUTS, () => ({
    status: 404,
    body: { message: `Not Found: ${MARKER}` },
    headers: { 'x-github-request-id': 'C0DE:12AB:3F4E5D:6A7B8C:69091A2B' },
  }));

  assert.equal(result.status, 1);
  assert.match(
    result.output,
    /::error::The gate could not complete\. Reason: A GitHub API request failed: GET \/repos\/acme\/example\/pulls\/42 returned HTTP 404\. GitHub request ID: C0DE:12AB:3F4E5D:6A7B8C:69091A2B\./,
  );
  assert.match(result.summary, /Reason: A GitHub API request failed/);
  assert.doesNotMatch(result.output, new RegExp(MARKER));
  assert.doesNotMatch(result.summary, new RegExp(MARKER));
});

test('reports a request that never reached GitHub', async () => {
  const result = await runBundle(BUNDLE, INPUTS, 'unreachable');

  assert.equal(result.status, 1);
  assert.match(result.output, /Reason: A GitHub API request failed before GitHub sent a response: GET \/repos\/acme\/example\/pulls\/42\./);
});

test('keeps a response body that imitates stack frames out of the debug log', async () => {
  const result = await runBundle(BUNDLE, INPUTS, () => ({ status: 422, body: { message: `Validation failed:\n    at ${MARKER}/package.json:1:1` } }));

  assert.equal(result.status, 1);
  assert.match(result.output, /::debug::HttpError/);
  assert.doesNotMatch(result.output, new RegExp(MARKER));
});

test('replaces client warnings with a fixed message', async () => {
  const result = await runBundle(BUNDLE, INPUTS, () => ({
    status: 500,
    body: {},
    headers: { deprecation: 'true', sunset: MARKER, link: `<https://example.com/${MARKER}>; rel="deprecation"` },
  }));

  assert.equal(result.status, 1);
  assert.match(result.output, /::warning::The GitHub API client reported a warning\. Its text stays out of public logs\./);
  assert.doesNotMatch(result.output, new RegExp(MARKER));
});
