// Runs the changelog release tests and fails when none ran, so a moved or renamed
// test file cannot turn CI green with zero tests.
import { globSync } from 'node:fs';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

const files = globSync('tests/changelog-release/**/*.test.ts');
let passed = 0;
let failed = 0;

const stream = run({ files, isolation: 'none' });
// Every test case sits inside a describe, at nesting 1 or deeper. Node also reports each file at
// nesting 0, so a file with no test case still counts as a pass there.
stream.on('test:pass', (event) => {
  if (event.details.type === 'test' && event.nesting > 0 && !event.skip) {
    passed += 1;
  }
});
stream.on('test:fail', () => {
  failed += 1;
});
stream.on('end', () => {
  if (failed > 0) {
    process.exitCode = 1;
  } else if (passed === 0 && process.platform === 'linux') {
    console.error(`No changelog release test ran (${files.length} files found).`);
    process.exitCode = 1;
  }
});
stream.compose(spec).pipe(process.stdout);
