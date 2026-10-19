import assert from 'node:assert/strict';
import test from 'node:test';
import { generatedPathMatcher, globPattern, reviewableLines } from '../src/size.js';

test('excludes lockfiles, minified assets, source maps and snapshots by default', () => {
  const isGenerated = generatedPathMatcher('');

  for (const path of [
    'package-lock.json',
    'composer.lock',
    'apps/web/pnpm-lock.yaml',
    'public/app.min.js',
    'public/app.js.map',
    'tests/__snapshots__/card.test.ts.snap',
    'src/__snapshots__/output.txt',
  ]) {
    assert.equal(isGenerated(path), true, path);
  }

  for (const path of ['app/Models/User.php', 'package.json', 'src/lock.ts', 'docs/composer.lock.md']) {
    assert.equal(isGenerated(path), false, path);
  }
});

test('excludes paths the base .gitattributes marks generated or vendored', () => {
  const isGenerated = generatedPathMatcher([
    '# Generated clients',
    '* text=auto eol=lf',
    'resources/api/** linguist-generated',
    '*.pb.go linguist-generated=true',
    '/public/vendor/** linguist-vendored',
  ].join('\n'));

  assert.equal(isGenerated('resources/api/client.ts'), true);
  assert.equal(isGenerated('cmd/x/service.pb.go'), true);
  assert.equal(isGenerated('public/vendor/lib.js'), true);
  assert.equal(isGenerated('nested/public/vendor/lib.js'), false);
  assert.equal(isGenerated('resources/views/home.blade.php'), false);
});

test('lets a later .gitattributes line opt a path back in', () => {
  const isGenerated = generatedPathMatcher([
    'composer.lock -linguist-generated',
    'build/** linguist-generated',
    'build/keep.ts linguist-generated=false',
  ].join('\n'));

  assert.equal(isGenerated('composer.lock'), false);
  assert.equal(isGenerated('build/out.js'), true);
  assert.equal(isGenerated('build/keep.ts'), false);
});

test('keeps generated when only the vendored attribute is unset', () => {
  const isGenerated = generatedPathMatcher('*.lock -linguist-vendored');

  assert.equal(isGenerated('composer.lock'), true);
});

test('ignores attributes unrelated to generated code', () => {
  const isGenerated = generatedPathMatcher('*.php diff=php\n/.github export-ignore');

  assert.equal(isGenerated('app/Foo.php'), false);
  assert.equal(isGenerated('.github/workflows/ci.yml'), false);
});

test('matches globs with git semantics', () => {
  assert.equal(globPattern('*.yml').test('.github/workflows/ci.yml'), true);
  assert.equal(globPattern('*.yml').test('.hidden.yml'), true);
  assert.equal(globPattern('docs/*.md').test('docs/a.md'), true);
  assert.equal(globPattern('docs/*.md').test('docs/sub/a.md'), false);
  assert.equal(globPattern('docs/*.md').test('x/docs/a.md'), false);
  assert.equal(globPattern('/docs/**').test('docs/sub/a.md'), true);
  assert.equal(globPattern('**/gen/*.ts').test('gen/a.ts'), true);
  assert.equal(globPattern('**/gen/*.ts').test('a/b/gen/a.ts'), true);
  assert.equal(globPattern('file?.txt').test('file1.txt'), true);
  assert.equal(globPattern('file[0-9].txt').test('file7.txt'), true);
  assert.equal(globPattern('file[!0-9].txt').test('file7.txt'), false);
  assert.equal(globPattern('a.b').test('axb'), false);
});

test('sums additions and deletions of reviewable files only', () => {
  const files = [
    { filename: 'app/Service.php', additions: 900, deletions: 100 },
    { filename: 'package-lock.json', additions: 40_000, deletions: 30_000 },
    { filename: 'tests/ServiceTest.php', additions: 250, deletions: 0 },
  ];

  assert.equal(reviewableLines(files, generatedPathMatcher('')), 1_250);
});
