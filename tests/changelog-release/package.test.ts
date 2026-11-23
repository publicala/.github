import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { awkVariants, Repo, runFunction, runStep, skipReason, stepIndex, succeeded, workflowSteps } from './harness.js';

// The commit picking does not read awk, so one run covers it.
const awk = skipReason ? 'awk' : (awkVariants()[0] ?? 'awk');

describe('same_package', { skip: skipReason }, () => {
  const samePackage = (repo: Repo, a: string, b: string) =>
    runFunction('target', 'same_package', [a, b], { cwd: repo.dir, awk }).status;

  const base = () => {
    const repo = new Repo();
    repo.write('a.php', 'a\n');
    repo.write('b.php', 'b\n');
    repo.symlink('a.php', 'link.php');
    return { repo, sha: repo.commit('base') };
  };

  it('accepts identical archives', () => {
    const { repo, sha } = base();
    assert.equal(samePackage(repo, sha, repo.commit('empty')), 0);
  });

  it('rejects a mode-only change', () => {
    const { repo, sha } = base();
    repo.write('a.php', 'a\n', 0o755);
    assert.equal(samePackage(repo, sha, repo.commit('mode')), 1);
  });

  it('rejects a changed symlink target', () => {
    const { repo, sha } = base();
    repo.symlink('b.php', 'link.php');
    assert.equal(samePackage(repo, sha, repo.commit('link')), 1);
  });

  it('accepts a change to an export-ignored file', () => {
    const { repo } = base();
    repo.write('.gitattributes', 'tests.txt export-ignore\n');
    repo.write('tests.txt', 'one\n');
    const before = repo.commit('ignored');
    repo.write('tests.txt', 'two\n');
    assert.equal(samePackage(repo, before, repo.commit('ignored change')), 0);
  });

  it('rejects execute bits swapped between paths that hold a newline', () => {
    const repo = new Repo();
    repo.write('h\npre', '', 0o755);
    repo.write('h\npost', '', 0o644);
    const before = repo.commit('modes');
    repo.write('h\npre', '', 0o644);
    repo.write('h\npost', '', 0o755);
    assert.equal(samePackage(repo, before, repo.commit('swapped')), 1);
  });
});

describe('Pick the commit to tag and Check immutable tag state', { skip: skipReason }, () => {
  // The introduction commit, a later commit with another package, and HEAD with a third one.
  const history = () => {
    const repo = new Repo();
    repo.write('CHANGELOG.md', '## v1.0.0\n\n- x\n');
    repo.write('src.php', 'a\n');
    const intro = repo.commit('intro');
    repo.write('src.php', 'b\n');
    const other = repo.commit('other');
    repo.write('src.php', 'c\n');
    const head = repo.commit('head');
    return { repo, intro, other, head };
  };
  const target = (repo: Repo, env: Record<string, string>) =>
    runStep('target', { cwd: repo.dir, awk, env: { VERSION: '1.0.0', ...env } });
  const tagState = (repo: Repo, env: Record<string, string>) =>
    runStep('tag', { cwd: repo.dir, awk, env: { VERSION: '1.0.0', ...env } });

  it('tags the introduction commit when it is this run commit, without asking the API', () => {
    // The common path: the release commit is HEAD. The strict gh stub fails any call.
    const { repo, intro } = history();
    const result = target(repo, { GITHUB_SHA: intro, INTRO_SHA: intro });
    assert.equal(succeeded(result).sha, intro);
    assert.deepEqual(result.ghCalls, []);
  });

  it('tags the introduction commit when its ci-success passed', () => {
    const { repo, intro, head } = history();
    const picked = succeeded(target(repo, { GH_CI: `${intro}=success`, GITHUB_SHA: head, INTRO_SHA: intro }));
    assert.equal(picked.sha, intro);
  });

  it('tags this run commit when the introduction commit is red and the package is the same', () => {
    const repo = new Repo();
    repo.write('CHANGELOG.md', '## v1.0.0\n\n- x\n');
    repo.write('.gitattributes', '.github export-ignore\n');
    const intro = repo.commit('intro');
    repo.write('.github', 'workflow fix\n');
    const head = repo.commit('fix a workflow');
    const picked = succeeded(target(repo, { GH_CI: `${intro}=failure`, GITHUB_SHA: head, INTRO_SHA: intro }));
    assert.equal(picked.sha, head);
  });

  it('fails when the introduction commit is red, the package changed, and no tag exists', () => {
    const { repo, intro, head } = history();
    const result = target(repo, { GH_CI: `${intro}=failure`, GITHUB_SHA: head, INTRO_SHA: intro });
    assert.equal(result.status, 1);
    assert.equal(result.outputs.sha, undefined);
  });

  it('turns an out-of-band tag on the red introduction commit into a no-op', () => {
    // The tag sits on the picked commit, so only OUT_OF_BAND keeps the state from present_here.
    const { repo, intro, head } = history();
    repo.git('tag', 'v1.0.0', intro);
    const picked = succeeded(target(repo, { GH_CI: `${intro}=failure`, GITHUB_SHA: head, INTRO_SHA: intro }));
    assert.equal(picked.out_of_band, 'true');
    assert.equal(picked.sha, intro);
    const state = succeeded(tagState(repo, { RELEASE_SHA: picked.sha ?? '', OUT_OF_BAND: picked.out_of_band ?? '' }));
    assert.equal(state.state, 'present_elsewhere');
  });

  it('binds the tag state step to the outputs of the target step', () => {
    const env = workflowSteps[stepIndex('tag')]?.env ?? {};
    assert.equal(env.RELEASE_SHA, '${{ steps.target.outputs.sha }}');
    assert.equal(env.OUT_OF_BAND, '${{ steps.target.outputs.out_of_band }}');
  });

  it('keeps an existing green tag that ships the same package on a retry', () => {
    // A retry after a failed publish: the tag sits on a green stand-in for the red introduction
    // commit, and main has since changed the package.
    const repo = new Repo();
    repo.write('CHANGELOG.md', '## v1.0.0\n\n- x\n');
    repo.write('.gitattributes', '.github export-ignore\n');
    repo.write('src.php', 'a\n');
    const intro = repo.commit('intro');
    repo.write('.github', 'workflow fix\n');
    const tagged = repo.commit('fix a workflow');
    repo.git('tag', 'v1.0.0', tagged);
    repo.write('src.php', 'b\n');
    const head = repo.commit('change the package');
    const picked = succeeded(target(repo, { GH_CI: `${intro}=failure ${tagged}=success`, GITHUB_SHA: head, INTRO_SHA: intro }));
    assert.equal(picked.sha, tagged);
    assert.equal(picked.out_of_band, undefined);
  });

  it('reads the tag state as absent, present_here or present_elsewhere', () => {
    const { repo, intro, other } = history();
    assert.equal(succeeded(tagState(repo, { RELEASE_SHA: intro })).state, 'absent');
    repo.git('tag', 'v1.0.0', intro);
    assert.equal(succeeded(tagState(repo, { RELEASE_SHA: intro })).state, 'present_here');
    assert.equal(succeeded(tagState(repo, { RELEASE_SHA: other })).state, 'present_elsewhere');
  });
});
