import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { awkVariants, largeChangelog, Repo, runStep, skipReason, succeeded } from './harness.js';

for (const awk of skipReason ? ['awk'] : awkVariants()) {
  describe(`Read top version and Find introduction commit (${awk})`, { skip: skipReason }, () => {
    const intro = (repo: Repo, version: string) => runStep('intro', { cwd: repo.dir, awk, env: { VERSION: version } });

    it('reads the first version heading, not inline backticks above it', () => {
      const repo = new Repo();
      repo.changelog('# Changelog\n\nRun ```composer update``` after upgrading.\n\n## v1.1.0\n\n- z\n\n## v1.0.0\n\n- y\n');
      assert.equal(succeeded(runStep('ver', { cwd: repo.dir, awk })).version, '1.1.0');
    });

    it('fails "Read top version" when CHANGELOG.md has no version heading', () => {
      const repo = new Repo();
      repo.changelog('# Changelog\n\nNothing released yet.\n');
      const result = runStep('ver', { cwd: repo.dir, awk });
      assert.notEqual(result.status, 0);
      assert.equal(result.outputs.version, undefined);
    });

    it('finds the first version in history', () => {
      const repo = new Repo();
      const first = repo.release('1.0.0');
      repo.release('1.1.0');
      assert.equal(succeeded(intro(repo, '1.0.0')).sha, first);
    });

    it('fails for a version that never reached the top', () => {
      const repo = new Repo();
      repo.release('1.0.0');
      assert.equal(intro(repo, '9.9.9').status, 1);
    });

    it('reads 2.9.0 to 2.10.0 as a step up, in numeric order', () => {
      // 2.10.0 is seen before, so only a numeric 2.9.0 < 2.10.0 makes the last change an introduction.
      const repo = new Repo();
      repo.release('2.10.0');
      repo.release('2.9.0', 'drop v2.10.0');
      const again = repo.release('2.10.0', 'add v2.10.0 again');
      assert.equal(succeeded(intro(repo, '2.10.0')).sha, again);
    });

    it('refuses to guess when a version comes back after a higher one and has no tag', () => {
      const repo = new Repo();
      repo.release('1.1.0');
      repo.release('1.2.0');
      repo.release('1.3.0');
      repo.release('1.2.0', 'revert v1.3.0');
      const result = intro(repo, '1.2.0');
      assert.equal(result.status, 1);
      assert.match(result.stdout, /came back to the top/);
    });

    it('keeps the first introduction when a version comes back and has a tag', () => {
      const repo = new Repo();
      repo.release('1.1.0');
      const first = repo.release('1.2.0');
      repo.git('tag', 'v1.2.0', first);
      repo.release('1.3.0');
      repo.release('1.2.0', 'revert v1.3.0');
      assert.equal(succeeded(intro(repo, '1.2.0')).sha, first);
    });

    it('reads a version removed and added again as the new addition', () => {
      const repo = new Repo();
      repo.release('1.1.0');
      repo.release('1.2.0');
      repo.release('1.1.0', 'drop v1.2.0');
      const again = repo.release('1.2.0', 'add v1.2.0 again');
      assert.equal(succeeded(intro(repo, '1.2.0')).sha, again);
    });

    it('reads a heading corrected down to a new version as its introduction', () => {
      const repo = new Repo();
      repo.release('1.2.0');
      const typo = repo.release('1.4.0', 'typo');
      const corrected = repo.release('1.3.0', 'correct the heading');
      assert.equal(succeeded(intro(repo, '1.3.0')).sha, corrected);
      assert.equal(succeeded(intro(repo, '1.4.0')).sha, typo);
    });

    it('resets on a commit with no version heading', () => {
      const repo = new Repo();
      repo.release('3.0.0');
      repo.changelog('# Changelog\n', 'back out the first release');
      const again = repo.release('3.0.0', 'add v3.0.0 again');
      assert.equal(succeeded(intro(repo, '3.0.0')).sha, again);
    });

    it('reads a changelog larger than the pipe buffer', () => {
      const repo = new Repo();
      const big = repo.changelog(largeChangelog('3.0.0'));
      assert.equal(succeeded(intro(repo, '3.0.0')).sha, big);
    });
  });
}
