import assert from 'node:assert/strict';
import test from 'node:test';
import { debugFailureDetail, GateError, gateFailureMessage, publicFailureReason } from '../src/failure.js';

test('reports the public reason of a gate error and keeps its detail out', () => {
  const error = new GateError('The Dependabot alerts response is invalid.', 'An alert has an invalid manifest_path.');

  assert.equal(publicFailureReason(error), 'The Dependabot alerts response is invalid.');
  assert.equal(error.message, 'An alert has an invalid manifest_path.');
});

test('uses the public reason as the detail when no detail is given', () => {
  assert.equal(new GateError('The pull request event is incomplete.').message, 'The pull request event is incomplete.');
});

test('reports the method, path, status, and request ID of a failed GitHub request', () => {
  const error = requestError(403, 'https://api.github.com/repos/acme/example/dependabot/alerts?state=open&per_page=100', {
    'x-github-request-id': 'C0DE:12AB:3F4E5D:6A7B8C:69091A2B',
  });

  assert.equal(
    publicFailureReason(error),
    'A GitHub API request failed: GET /repos/acme/example/dependabot/alerts returned HTTP 403. '
      + 'GitHub request ID: C0DE:12AB:3F4E5D:6A7B8C:69091A2B.',
  );
});

test('reports a GitHub request that failed before a response', () => {
  // Octokit sets status 500 on transport failures and attaches no response.
  const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
    status: 500,
    request: { method: 'get', url: 'https://api.github.com/repos/acme/example/pulls/42?per_page=100', headers: {} },
  });

  assert.equal(
    publicFailureReason(error),
    'A GitHub API request failed before GitHub sent a response: GET /repos/acme/example/pulls/42.',
  );
});

test('omits a request ID that is not a GitHub request ID', () => {
  const error = requestError(500, 'https://api.github.com/repos/acme/example/pulls/42', {
    'x-github-request-id': 'next 16.2.9 in package.json',
  });

  assert.equal(publicFailureReason(error), 'A GitHub API request failed: GET /repos/acme/example/pulls/42 returned HTTP 500.');
});

test('keeps the message and response body of a failed GitHub request out', () => {
  const error = Object.assign(requestError(422, 'https://api.github.com/repos/acme/example/pulls/42/files'), {
    message: 'Validation failed: next 16.2.9',
    response: { status: 422, headers: {}, data: { message: 'next 16.2.9' } },
  });

  assert.doesNotMatch(publicFailureReason(error), /next|Validation/);
});

test('reports every other failure as unexpected', () => {
  for (const error of [new TypeError('Cannot read properties of undefined (reading \'next\')'), 'failure', null, { status: 500 }]) {
    assert.equal(publicFailureReason(error), 'An unexpected error occurred.');
  }
});

test('debugs the detail of a gate error', () => {
  assert.equal(debugFailureDetail(new GateError('The Dependabot alerts response is invalid.', 'An alert has an invalid severity.')), 'An alert has an invalid severity.');
});

test('debugs only the name and stack frames of any other error', () => {
  const error = new TypeError('Validation failed: next 16.2.9');
  const detail = debugFailureDetail(error);

  assert.match(detail, /^TypeError\n\s+at /);
  assert.doesNotMatch(detail, /next|Validation/);
});

test('drops stack lines that a multiline message imitates', () => {
  const error = new Error('Validation failed:\n    at next-16.2.9/package.json:1:1');
  const detail = debugFailureDetail(error);

  assert.match(detail, /^Error\n\s+at /);
  assert.doesNotMatch(detail, /next|Validation/);
});

test('debugs only the name when the stack header no longer matches the message', () => {
  const error = new Error('first');
  // V8 formats the stack on first read, so read it before the message changes.
  assert.ok(error.stack);
  error.message = 'Validation failed:\n    at next-16.2.9/package.json:1:1';

  assert.equal(debugFailureDetail(error), 'Error');
});

test('debugs the type of a thrown value that is not an error', () => {
  assert.equal(debugFailureDetail('next 16.2.9'), 'A non-error value of type string was thrown.');
});

test('builds the gate failure message around the public reason', () => {
  assert.equal(
    gateFailureMessage(new GateError('The pull request event is incomplete.')),
    'The gate could not complete. Reason: The pull request event is incomplete. Repository maintainers must inspect this run.',
  );
});

function requestError(status: number, url: string, headers: Record<string, string> = {}) {
  return Object.assign(new Error('HttpError'), {
    status,
    request: { method: 'GET', url, headers: { authorization: 'token [REDACTED]' } },
    response: { status, url, headers, data: {} },
  });
}
