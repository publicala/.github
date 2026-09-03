import lockfile from '@yarnpkg/lockfile';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

export function packageVersions(manifest: string, content: string, packageName: string): string[] {
  const basename = manifest.split('/').at(-1);

  switch (basename) {
    case 'composer.lock':
      return composerLock(content, packageName);
    case 'package-lock.json':
    case 'npm-shrinkwrap.json':
      return npmLock(content, packageName);
    case 'yarn.lock':
      return yarnLock(content, packageName);
    case 'pnpm-lock.yaml':
      return pnpmLock(content, packageName);
    case 'Gemfile.lock':
      return gemfileLock(content, packageName);
    case 'requirements.txt':
      return requirements(content, packageName);
    case 'Pipfile.lock':
      return pipfileLock(content, packageName);
    case 'poetry.lock':
    case 'uv.lock':
      return pythonTomlLock(content, packageName);
    default:
      throw new Error(`Unsupported manifest: ${manifest}.`);
  }
}

function composerLock(content: string, target: string): string[] {
  const document = jsonObject(content, 'composer.lock');
  const packages = [...arrayOrEmpty(document.packages), ...arrayOrEmpty(document['packages-dev'])];

  return unique(packages.flatMap((value) => {
    const item = asObject(value);
    return item !== null && sameName(item.name, target) && typeof item.version === 'string' ? [item.version] : [];
  }));
}

function npmLock(content: string, target: string): string[] {
  const document = jsonObject(content, 'package-lock.json');
  const versions: string[] = [];
  const packages = asObject(document.packages);

  if (packages !== null) {
    for (const [path, value] of Object.entries(packages)) {
      const item = asObject(value);
      const name = typeof item?.name === 'string' ? item.name : npmNameFromPath(path);
      if (item !== null && sameName(name, target) && typeof item.version === 'string') {
        versions.push(item.version);
      }
    }
  }

  collectNpmDependencies(document.dependencies, target, versions);
  return unique(versions);
}

function collectNpmDependencies(value: unknown, target: string, versions: string[]): void {
  const dependencies = asObject(value);
  if (dependencies === null) {
    return;
  }

  for (const [name, raw] of Object.entries(dependencies)) {
    const dependency = asObject(raw);
    if (dependency === null) {
      continue;
    }
    if (sameName(name, target) && typeof dependency.version === 'string') {
      versions.push(dependency.version);
    }
    collectNpmDependencies(dependency.dependencies, target, versions);
  }
}

function npmNameFromPath(path: string): string {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  return index === -1 ? '' : path.slice(index + marker.length);
}

function yarnLock(content: string, target: string): string[] {
  if (/^__metadata:\s*$/m.test(content)) {
    const document = yamlObject(content, 'yarn.lock');
    return unique(Object.entries(document).flatMap(([selectors, raw]) => {
      const item = asObject(raw);
      return item !== null && selectorsContain(selectors, target) && typeof item.version === 'string' ? [item.version] : [];
    }));
  }

  const result = lockfile.parse(content);
  if (result.type !== 'success') {
    throw new Error(`yarn.lock could not be parsed: ${result.type}.`);
  }

  return unique(Object.entries(result.object).flatMap(([selectors, item]) =>
    selectorsContain(selectors, target) && typeof item.version === 'string' ? [item.version] : [],
  ));
}

function pnpmLock(content: string, target: string): string[] {
  const document = yamlObject(content, 'pnpm-lock.yaml');
  const versions: string[] = [];

  for (const section of ['packages', 'snapshots']) {
    const packages = asObject(document[section]);
    if (packages === null) {
      continue;
    }

    for (const [locator, raw] of Object.entries(packages)) {
      const item = asObject(raw);
      const parsed = pnpmLocator(locator);
      const name = typeof item?.name === 'string' ? item.name : parsed?.name;
      const version = typeof item?.version === 'string' ? item.version : parsed?.version;
      if (name !== undefined && version !== undefined && sameName(name, target)) {
        versions.push(cleanPnpmVersion(version));
      }
    }
  }

  const importers = asObject(document.importers);
  if (importers !== null) {
    for (const importer of Object.values(importers)) {
      const importerValue = asObject(importer);
      if (importerValue === null) {
        continue;
      }
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const dependencies = asObject(importerValue[section]);
        const dependency = dependencies === null ? null : asObject(dependencies[target]);
        const version = dependency !== null ? dependency.version : dependencies?.[target];
        if (typeof version === 'string') {
          versions.push(cleanPnpmVersion(version));
        }
      }
    }
  }

  return unique(versions.filter((version) => version !== ''));
}

function pnpmLocator(locator: string): { name: string; version: string } | null {
  const clean = locator.replace(/^\//, '').replace(/\([^)]*\)+$/, '');
  const scoped = clean.match(/^(@[^/]+\/[^@/]+)(?:@|\/)(.+)$/);
  const unscoped = clean.match(/^([^@/]+)(?:@|\/)(.+)$/);
  const match = scoped ?? unscoped;
  return match?.[1] !== undefined && match[2] !== undefined ? { name: match[1], version: cleanPnpmVersion(match[2]) } : null;
}

function cleanPnpmVersion(version: string): string {
  return version.replace(/^npm:/, '').replace(/\([^)]*\)+$/, '').split('_')[0] ?? version;
}

function gemfileLock(content: string, target: string): string[] {
  const versions: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^    ([A-Za-z0-9_.-]+) \(([^ )]+)(?: [^)]*)?\)$/);
    if (match?.[1] !== undefined && match[2] !== undefined && sameName(match[1], target)) {
      versions.push(match[2]);
    }
  }
  return unique(versions);
}

function requirements(content: string, target: string): string[] {
  return unique(content.split(/\r?\n/).flatMap((line) => {
    const withoutComment = line.replace(/\s+#.*$/, '').trim();
    const match = withoutComment.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*===?\s*([^\s;]+)(?:\s*;.*)?$/);
    return match?.[1] !== undefined && match[2] !== undefined && sameName(match[1], target) ? [match[2]] : [];
  }));
}

function pipfileLock(content: string, target: string): string[] {
  const document = jsonObject(content, 'Pipfile.lock');
  const versions: string[] = [];
  for (const section of ['default', 'develop']) {
    const packages = asObject(document[section]);
    if (packages === null) {
      continue;
    }
    for (const [name, raw] of Object.entries(packages)) {
      const item = asObject(raw);
      const match = typeof item?.version === 'string' ? item.version.match(/^===?(.+)$/) : null;
      if (sameName(name, target) && match?.[1] !== undefined) {
        versions.push(match[1]);
      }
    }
  }
  return unique(versions);
}

function pythonTomlLock(content: string, target: string): string[] {
  const document = asObject(parseToml(content));
  const packages = document === null ? [] : arrayOrEmpty(document.package);
  return unique(packages.flatMap((raw) => {
    const item = asObject(raw);
    return item !== null && sameName(item.name, target) && typeof item.version === 'string' ? [item.version] : [];
  }));
}

function selectorsContain(selectors: string, target: string): boolean {
  return selectors.split(/,\s*/).some((selector) => {
    const clean = selector.replace(/^['"]|['"]$/g, '');
    if (clean.startsWith('@')) {
      const separator = clean.indexOf('@', 1);
      return separator !== -1 && sameName(clean.slice(0, separator), target);
    }
    return sameName(clean.split('@')[0], target);
  });
}

function jsonObject(content: string, name: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(content);
    const objectValue = asObject(value);
    if (objectValue === null) {
      throw new Error('root is not an object');
    }
    return objectValue;
  } catch (error) {
    throw new Error(`${name} is invalid JSON.`, { cause: error });
  }
}

function yamlObject(content: string, name: string): Record<string, unknown> {
  try {
    const value: unknown = parseYaml(content, { maxAliasCount: 0, merge: false, schema: 'core', uniqueKeys: true });
    const objectValue = asObject(value);
    if (objectValue === null) {
      throw new Error('root is not an object');
    }
    return objectValue;
  } catch (error) {
    throw new Error(`${name} is invalid YAML.`, { cause: error });
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sameName(value: unknown, target: string): boolean {
  return typeof value === 'string' && normalizeName(value) === normalizeName(target);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

