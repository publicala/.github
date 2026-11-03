/**
 * A failure the gate raises on purpose.
 *
 * The public reason enters workflow logs, which are public for
 * public repositories. The detail goes to debug output only.
 */
export class GateError extends Error {
  readonly publicReason: string;

  constructor(publicReason: string, detail: string = publicReason) {
    super(detail);
    this.name = 'GateError';
    this.publicReason = publicReason;
  }
}

export function gateFailureMessage(error: unknown): string {
  return `The gate could not complete. Reason: ${publicFailureReason(error)} Repository maintainers must inspect this run.`;
}

/**
 * Describes a failure for debug output, which is public too.
 *
 * Library error messages can quote response bodies, so only
 * gate details and stack frames enter the debug log.
 */
export function debugFailureDetail(error: unknown): string {
  if (error instanceof GateError) {
    return error.message;
  }

  if (!(error instanceof Error)) {
    return `A non-error value of type ${typeof error} was thrown.`;
  }

  const frames = stackFrames(error);

  return frames === undefined ? error.name : `${error.name}\n${frames}`;
}

/**
 * Returns the stack below its header, which repeats the message.
 *
 * A multiline message can imitate frames, so the frames are kept
 * only when the header matches the message exactly.
 */
function stackFrames(error: Error): string | undefined {
  const stack = error.stack ?? '';

  // Error subclasses often set their name after the stack is captured.
  const header = [error.name, 'Error', error.constructor.name]
    .map((name) => (error.message === '' ? name : `${name}: ${error.message}`))
    .find((candidate) => stack.startsWith(`${candidate}\n`));

  return header === undefined ? undefined : stack.slice(header.length + 1);
}

/**
 * Describes a failure in words that are safe for a public log.
 *
 * GitHub API failures report the method, path, status, and
 * request ID. Query strings and response bodies stay out.
 */
export function publicFailureReason(error: unknown): string {
  if (error instanceof GateError) {
    return error.publicReason;
  }

  const requestFailure = githubRequestFailure(error);
  if (requestFailure !== undefined) {
    return requestFailure;
  }

  return 'An unexpected error occurred.';
}

function githubRequestFailure(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.status !== 'number' || !isRecord(error.request)) {
    return undefined;
  }

  const { method, url } = error.request;
  if (typeof method !== 'string' || typeof url !== 'string' || !URL.canParse(url)) {
    return undefined;
  }

  const request = `${method.toUpperCase()} ${new URL(url).pathname}`;

  // Octokit reports a transport failure as status 500 without a response.
  if (!isRecord(error.response) || typeof error.response.status !== 'number') {
    return `A GitHub API request failed before GitHub sent a response: ${request}.`;
  }

  const reason = `A GitHub API request failed: ${request} returned HTTP ${error.response.status}.`;
  const requestId = githubRequestId(error.response);

  return requestId === undefined ? reason : `${reason} GitHub request ID: ${requestId}.`;
}

function githubRequestId(response: unknown): string | undefined {
  if (!isRecord(response) || !isRecord(response.headers)) {
    return undefined;
  }

  const requestId = response.headers['x-github-request-id'];

  // GitHub request IDs are hexadecimal groups joined by colons.
  return typeof requestId === 'string' && /^[0-9A-Fa-f:]{1,64}$/.test(requestId) ? requestId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
