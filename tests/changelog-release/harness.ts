// Runs the step scripts of changelog-release.yml against real git fixtures.
// The steps run as GitHub runs them (bash --noprofile --norc -eo pipefail),
// with a strict `gh` stub and a chosen `awk` first on PATH.
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export interface Step {
  id?: string;
  name?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
  'continue-on-error'?: boolean | string;
}

const workflowPath = fileURLToPath(new URL('../../.github/workflows/changelog-release.yml', import.meta.url));
const workflow = parse(readFileSync(workflowPath, 'utf8')) as { jobs: { release: { steps: Step[] } } };

export const workflowSteps: readonly Step[] = workflow.jobs.release.steps;

// The steps use Linux tools (GNU find -printf, mawk or gawk), as the runner has them.
export const skipReason = process.platform === 'linux' ? false : 'the workflow runs on Linux (GNU find, diff and awk)';

// Every fixture lives under one root this process owns, removed on exit, also after a failure.
const root = mkdtempSync(join(tmpdir(), 'changelog-release-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));

function scratch(prefix: string): string {
  return mkdtempSync(join(root, prefix));
}

export function stepIndex(idOrName: string): number {
  const index = workflowSteps.findIndex((s) => s.id === idOrName || s.name === idOrName);
  if (index === -1) {
    throw new Error(`changelog-release.yml has no step "${idOrName}"`);
  }
  return index;
}

export function stepScript(idOrName: string): string {
  const run = workflowSteps[stepIndex(idOrName)]?.run;
  if (!run) {
    throw new Error(`Step "${idOrName}" has no run script`);
  }
  return run;
}

// A function the step defines, cut out so a test can call it on its own.
export function stepFunction(idOrName: string, fn: string): string {
  const match = stepScript(idOrName).match(new RegExp(`^${fn}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, 'm'));
  if (!match) {
    throw new Error(`Step "${idOrName}" defines no function ${fn}`);
  }
  return match[0];
}

// The absolute path of an executable on PATH, or undefined.
function executable(command: string): string | undefined {
  const result = spawnSync('bash', ['-c', `command -v ${command}`], { encoding: 'utf8' });
  const found = result.stdout.trim();
  if (result.status !== 0 || !isAbsolute(found)) {
    return undefined;
  }
  try {
    accessSync(found, constants.X_OK);
    return realpathSync(found);
  } catch {
    return undefined;
  }
}

// Each awk the runner may resolve `awk` to. CI requires both.
export function awkVariants(): string[] {
  const found = ['mawk', 'gawk'].filter((awk) => executable(awk));
  if (process.env.CHANGELOG_RELEASE_REQUIRE_AWKS === '1' && found.length < 2) {
    throw new Error(`CI needs both mawk and gawk, found: ${found.join(', ') || 'none'}`);
  }
  return found.length > 0 ? found : ['awk'];
}

// Git sees only this config and no system config or attributes, so host settings cannot leak in.
const home = scratch('home-');
writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n');

const baseEnv = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: home,
  TMPDIR: root,
  LC_ALL: 'C.UTF-8',
  GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_ATTR_NOSYSTEM: '1',
};

export const REPOSITORY = 'acme/package';

// Answers only the exact calls the workflow makes. Any other call is logged as UNEXPECTED and fails.
// GH_RELEASES: none | draft | published | both | error. GH_CI: "<sha>=<conclusion> ..." per commit.
const ghStub = `#!/usr/bin/env bash
# One line per call, the arguments separated by the unit separator, so a quoting change shows.
(IFS=$'\\x1f'; echo "$*") >> "$GH_LOG"
unexpected() { (IFS=$'\\x1f'; echo "UNEXPECTED"$'\\x1f'"$*") >> "$GH_LOG"; exit 99; }
if [[ "$1" == release && "$2" == create ]]; then
  expected=(release create "v$VERSION" --verify-tag --target "$RELEASE_SHA" --title "v$VERSION" --notes-file release-notes.md)
  [[ $# -eq \${#expected[@]} ]] || unexpected "$@"
  for i in "\${!expected[@]}"; do [[ "\${@:i+1:1}" == "\${expected[i]}" ]] || unexpected "$@"; done
  exit 0
fi
if [[ $# -eq 5 && "$1" == api && "$2" == --paginate && "$3" == "repos/$GITHUB_REPOSITORY/releases?per_page=100" \\
  && "$4" == --jq && "$5" == ".[] | select(.tag_name == \\"v$VERSION\\") | .draft" ]]; then
  case "$GH_RELEASES" in
    none) ;;
    draft) echo true ;;
    published) echo false ;;
    both) echo true; echo false ;;
    error) echo "HTTP 502" >&2; exit 1 ;;
    *) unexpected "$@" ;;
  esac
  exit 0
fi
check_runs='^repos/'"$GITHUB_REPOSITORY"'/commits/([0-9a-f]{40})/check-runs\\?check_name=ci-success&filter=latest$'
if [[ $# -eq 4 && "$1" == api && "$2" =~ $check_runs && "$3" == --jq && "$4" == '.check_runs[0].conclusion // "missing"' ]]; then
  for pair in \${GH_CI:-}; do
    if [[ "\${pair%%=*}" == "\${BASH_REMATCH[1]}" ]]; then echo "\${pair#*=}"; exit 0; fi
  done
fi
unexpected "$@"
`;

export interface StepResult {
  status: number | null;
  stdout: string;
  stderr: string;
  outputs: Record<string, string>;
  ghCalls: string[][];
}

export interface RunOptions {
  cwd: string;
  awk: string;
  env?: Record<string, string>;
}

// GitHub reads $GITHUB_OUTPUT as key=value lines and fails the step on anything else.
function parseOutputs(text: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line === '') {
      continue;
    }
    const at = line.indexOf('=');
    if (at <= 0) {
      throw new Error(`Malformed GITHUB_OUTPUT line: ${JSON.stringify(line)}`);
    }
    outputs[line.slice(0, at)] = line.slice(at + 1);
  }
  return outputs;
}

function runScript(script: string, options: RunOptions): StepResult {
  const dir = scratch('step-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const awkPath = executable(options.awk);
  if (!awkPath) {
    throw new Error(`${options.awk} is not an installed executable`);
  }
  symlinkSync(awkPath, join(bin, 'awk'));
  writeFileSync(join(bin, 'gh'), ghStub);
  chmodSync(join(bin, 'gh'), 0o755);
  const scriptPath = join(dir, 'step.sh');
  const outputPath = join(dir, 'output');
  const ghLog = join(dir, 'gh.log');
  writeFileSync(scriptPath, script);
  writeFileSync(outputPath, '');
  writeFileSync(ghLog, '');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      PATH: `${bin}:${baseEnv.PATH}`,
      GITHUB_OUTPUT: outputPath,
      GITHUB_REPOSITORY: REPOSITORY,
      GH_LOG: ghLog,
      ...options.env,
    },
  });
  const ghCalls = readFileSync(ghLog, 'utf8').split('\n').filter(Boolean).map((line) => line.split('\x1f'));
  const unexpected = ghCalls.filter((call) => call[0] === 'UNEXPECTED');
  if (unexpected.length > 0) {
    throw new Error(`The step made gh calls the workflow should not make:\n${unexpected.map((call) => JSON.stringify(call.slice(1))).join('\n')}`);
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    outputs: parseOutputs(readFileSync(outputPath, 'utf8')),
    ghCalls,
  };
}

export function runStep(idOrName: string, options: RunOptions): StepResult {
  return runScript(stepScript(idOrName), options);
}

export function runFunction(idOrName: string, fn: string, args: string[], options: RunOptions): StepResult {
  const quoted = args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
  return runScript(`${stepFunction(idOrName, fn)}\n${fn} ${quoted}\n`, options);
}

// The outputs of a step that must succeed, with its log in the failure message.
export function succeeded(result: StepResult): Record<string, string> {
  if (result.status !== 0) {
    throw new Error(`The step exited ${result.status}:\n${result.stdout}${result.stderr}`);
  }
  return result.outputs;
}

export class Repo {
  readonly dir = scratch('repo-');

  constructor() {
    this.git('init', '-q');
  }

  git(...args: string[]): string {
    const result = spawnSync('git', args, { cwd: this.dir, encoding: 'utf8', env: baseEnv });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  write(path: string, content: string, mode?: number): void {
    writeFileSync(join(this.dir, path), content);
    if (mode !== undefined) {
      chmodSync(join(this.dir, path), mode);
    }
  }

  symlink(target: string, path: string): void {
    rmSync(join(this.dir, path), { force: true });
    symlinkSync(target, join(this.dir, path));
  }

  commit(message: string): string {
    this.git('add', '-A');
    this.git('commit', '-q', '--allow-empty', '-m', message);
    return this.git('rev-parse', 'HEAD');
  }

  // A commit whose CHANGELOG.md holds one version block at the top.
  release(version: string, message = `v${version}`): string {
    this.write('CHANGELOG.md', `# Changelog\n\n## v${version}\n\n- change\n`);
    return this.commit(message);
  }

  changelog(content: string, message = 'changelog'): string {
    this.write('CHANGELOG.md', content);
    return this.commit(message);
  }

  read(path: string): string {
    return readFileSync(join(this.dir, path), 'utf8');
  }
}

// A changelog larger than the 64 KiB pipe buffer, so an early reader exit would SIGPIPE the writer.
export function largeChangelog(top: string, topNotes = '- new\n'): string {
  const old = Array.from({ length: 20000 }, (_, i) => `- old entry ${i} padding padding padding`).join('\n');
  return `# Changelog\n\n## v${top}\n\n${topNotes}\n## v0.0.1\n\n${old}\n`;
}
