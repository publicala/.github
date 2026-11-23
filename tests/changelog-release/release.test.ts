import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { awkVariants, Repo, runStep, skipReason, stepIndex, succeeded, workflowSteps } from './harness.js';

const awk = skipReason ? 'awk' : (awkVariants()[0] ?? 'awk');

describe('Check release state', { skip: skipReason }, () => {
  const state = (releases: string) =>
    runStep('release', { cwd: new Repo().dir, awk, env: { VERSION: '1.2.0', GH_RELEASES: releases } });

  it('reads no release as absent', () => {
    assert.equal(succeeded(state('none')).state, 'absent');
  });

  it('reads a published release as published', () => {
    assert.equal(succeeded(state('published')).state, 'published');
  });

  it('reads a published release next to a draft as published', () => {
    assert.equal(succeeded(state('both')).state, 'published');
  });

  it('fails on a draft, before the tag', () => {
    const result = state('draft');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::A draft release for v1\.2\.0 exists/);
  });

  it('stops the job before the tag push, which no later step can override', () => {
    // A failed step ends the job unless a later step asks to run anyway.
    const release = stepIndex('release');
    assert.ok(release < stepIndex('Create immutable tag'), 'the release state check must run before the tag push');
    for (const step of workflowSteps.slice(release)) {
      assert.doesNotMatch(step.if ?? '', /\b(always|failure|cancelled)\s*\(/, `${step.name} runs after a failure`);
      assert.equal(step['continue-on-error'] ?? false, false, `${step.name} continues on error`);
    }
    assert.equal(workflowSteps[release]?.['continue-on-error'] ?? false, false);
  });

  it('fails on an API error instead of reading absent', () => {
    const result = state('error');
    assert.equal(result.status, 1);
    assert.equal(result.outputs.state, undefined);
  });
});

describe('Create GitHub Release', { skip: skipReason }, () => {
  it('requires the pushed tag and pins the release to the picked commit', () => {
    const repo = new Repo();
    repo.write('release-notes.md', '- notes\n');
    // The gh stub accepts only the exact call with --verify-tag and --target, and fails any other.
    const result = runStep('Create GitHub Release', { cwd: repo.dir, awk, env: { VERSION: '1.2.0', RELEASE_SHA: 'abc123' } });
    succeeded(result);
    assert.deepEqual(result.ghCalls, [
      ['release', 'create', 'v1.2.0', '--verify-tag', '--target', 'abc123', '--title', 'v1.2.0', '--notes-file', 'release-notes.md'],
    ]);
  });
});

describe('Create immutable tag', { skip: skipReason }, () => {
  it('pushes an annotated tag at the picked commit, not this run commit', () => {
    const remote = new Repo();
    remote.git('config', 'receive.denyCurrentBranch', 'ignore');
    const repo = new Repo();
    repo.git('remote', 'add', 'origin', remote.dir);
    const picked = repo.release('1.2.0');
    const head = repo.commit('later');
    succeeded(runStep('Create immutable tag', { cwd: repo.dir, awk, env: { VERSION: '1.2.0', RELEASE_SHA: picked, GITHUB_SHA: head } }));
    assert.equal(remote.git('rev-parse', 'v1.2.0^{commit}'), picked);
    assert.equal(remote.git('cat-file', '-t', 'v1.2.0'), 'tag');
  });
});
