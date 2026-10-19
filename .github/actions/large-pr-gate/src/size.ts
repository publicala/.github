export interface ChangedFile {
  filename: string;
  additions: number;
  deletions: number;
}

type Attribute = 'linguist-generated' | 'linguist-vendored';

interface Rule {
  pattern: RegExp;
  attributes: Map<Attribute, boolean>;
}

// Files a reviewer does not read line by line. A repository opts a path
// back in with `-linguist-generated` in its root .gitattributes.
const GENERATED_PATTERNS = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'go.sum',
  'Package.resolved',
  'Podfile.lock',
  'pubspec.lock',
  'gradle.lockfile',
  'mix.lock',
  'flake.lock',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.snap',
  '**/__snapshots__/**',
];

const ATTRIBUTES: readonly Attribute[] = ['linguist-generated', 'linguist-vendored'];

export function generatedPathMatcher(gitattributes: string): (path: string) => boolean {
  const rules = [
    ...GENERATED_PATTERNS.map((pattern) => ({
      pattern: globPattern(pattern),
      attributes: new Map<Attribute, boolean>([['linguist-generated', true]]),
    })),
    ...parseGitattributes(gitattributes),
  ];

  return (path) => {
    const state = new Map<Attribute, boolean>();

    for (const rule of rules) {
      if (rule.pattern.test(path)) {
        rule.attributes.forEach((value, attribute) => state.set(attribute, value));
      }
    }

    return [...state.values()].some(Boolean);
  };
}

export function reviewableLines(
  files: readonly ChangedFile[],
  isGenerated: (path: string) => boolean,
): number {
  return files
    .filter((file) => !isGenerated(file.filename))
    .reduce((total, file) => total + file.additions + file.deletions, 0);
}

function parseGitattributes(content: string): Rule[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('"'))
    .flatMap((line) => {
      const [pattern = '', ...tokens] = line.split(/\s+/);
      const attributes = new Map<Attribute, boolean>();

      for (const token of tokens) {
        const parsed = attributeToken(token);
        if (parsed !== undefined) {
          attributes.set(parsed.attribute, parsed.value);
        }
      }

      return attributes.size === 0 || pattern.startsWith('!')
        ? []
        : [{ pattern: globPattern(pattern), attributes }];
    });
}

function attributeToken(token: string): { attribute: Attribute; value: boolean } | undefined {
  const unset = token.startsWith('-') || token.startsWith('!');
  const [name = '', value] = (unset ? token.slice(1) : token).split('=', 2);
  const attribute = ATTRIBUTES.find((candidate) => candidate === name);

  if (attribute === undefined) {
    return undefined;
  }

  if (unset) {
    return { attribute, value: false };
  }

  return { attribute, value: value === undefined || value === 'true' };
}

// Git pattern semantics: a pattern without a slash matches the basename at
// any depth, a pattern with a slash is anchored to the repository root, and
// wildcards match dotfiles.
export function globPattern(glob: string): RegExp {
  const anchored = glob.includes('/');
  const body = glob.replace(/^\//, '');
  let source = '';

  for (let index = 0; index < body.length; index++) {
    const character = body[index]!;

    if (body.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 2;
    } else if (body.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else if (character === '[') {
      const end = body.indexOf(']', index + 2);
      if (end === -1) {
        source += '\\[';
      } else {
        const members = body.slice(index + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\');
        source += `[${members}]`;
        index = end;
      }
    } else {
      source += character.replace(/[.+^${}()|\\\]]/g, '\\$&');
    }
  }

  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${source}$`);
}
