import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { awkVariants, largeChangelog, Repo, runStep, skipReason } from './harness.js';

for (const awk of skipReason ? ['awk'] : awkVariants()) {
  describe(`Extract release notes (${awk})`, { skip: skipReason }, () => {
    const extract = (content: string, version: string) => {
      const repo = new Repo();
      const sha = repo.changelog(content);
      const result = runStep('Extract release notes', { cwd: repo.dir, awk, env: { RELEASE_SHA: sha, VERSION: version } });
      return { result, notes: result.status === 0 ? repo.read('release-notes.md') : '' };
    };

    it('takes only the version block, without the blank lines around it', () => {
      const { result, notes } = extract('# Changelog\n\n## v2.0.0\n\n- new\n- second\n\n## v1.0.0\n\n- old\n', '2.0.0');
      assert.equal(result.status, 0, result.stdout);
      assert.equal(notes, '- new\n- second\n');
    });

    it('reads a changelog larger than the pipe buffer', () => {
      const { result, notes } = extract(largeChangelog('2.0.0', '- new\n'), '2.0.0');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(notes, '- new\n');
    });

    it('reads CHANGELOG.md at the tagged commit, not the checkout', () => {
      const repo = new Repo();
      const tagged = repo.changelog('# Changelog\n\n## v2.0.0\n\n- shipped\n');
      repo.changelog('# Changelog\n\n## v2.0.0\n\n- edited later\n');
      const result = runStep('Extract release notes', { cwd: repo.dir, awk, env: { RELEASE_SHA: tagged, VERSION: '2.0.0' } });
      assert.equal(result.status, 0, result.stdout);
      assert.equal(repo.read('release-notes.md'), '- shipped\n');
    });

    it('fails when the version block is missing', () => {
      assert.equal(extract('# Changelog\n\n## v2.0.0\n\n- y\n', '3.0.0').result.status, 1);
    });

    it('fails when the version block is empty', () => {
      assert.equal(extract('# Changelog\n\n## v4.0.0\n\n## v2.0.0\n\n- y\n', '4.0.0').result.status, 1);
    });

    it('fails when the version block holds only whitespace and CRLF', () => {
      assert.equal(extract('# Changelog\n\n## v5.0.0\n\r\n \t\r\n## v2.0.0\n\n- y\n', '5.0.0').result.status, 1);
    });

    it('keeps a ## heading inside a code fence', () => {
      const { notes } = extract('# Changelog\n\n## v6.0.0\n\n- see:\n\n```md\n## Configuration\n```\n\n- after\n\n## v2.0.0\n\n- y\n', '6.0.0');
      assert.match(notes, /## Configuration/);
      assert.match(notes, /- after\n$/);
    });

    it('keeps a Versioning footer out of a first release', () => {
      const { notes } = extract('# Changelog\n\n## v1.0.0\n\n- first\n\n## Versioning\n\nSemVer rules.\n', '1.0.0');
      assert.equal(notes, '- first\n');
    });

    it('fails for a blank entry above a Versioning footer', () => {
      assert.equal(extract('# Changelog\n\n## v1.0.1\n\n## Versioning\n\nSemVer rules.\n', '1.0.1').result.status, 1);
    });

    it('never crosses the next version heading, even inside an unclosed fence', () => {
      const { result, notes } = extract('# Changelog\n\n## v9.0.0\n\n- example:\n\n```sh\nrun it\n\n## v2.0.0\n\n- old\n', '9.0.0');
      assert.equal(result.status, 0, result.stdout);
      assert.match(notes, /run it/);
      assert.doesNotMatch(notes, /- old/);
    });
  });
}
