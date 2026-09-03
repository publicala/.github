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
  if (!Array.isArray(document.packages)) {
    throw new Error('composer.lock packages is not an array.');
  }
  if (document['packages-dev'] !== undefined && !Array.isArray(document['packages-dev'])) {
    throw new Error('composer.lock packages-dev is not an array.');
  }
  const packages = [...document.packages, ...arrayOrEmpty(document['packages-dev'])];

  return packages.flatMap((value) => {
    const item = asObject(value);
    if (item === null || !sameName(item.name, target)) {
      return [];
    }
    return [requiredVersion(item.version, target, 'composer.lock')];
  });
}

function npmLock(content: string, target: string): string[] {
  const document = jsonObject(content, 'package-lock.json');
  const versions: string[] = [];
  const packages = asObject(document.packages);
  if (document.packages !== undefined && packages === null) {
    throw new Error('package-lock.json packages is not an object.');
  }

  if (packages !== null) {
    for (const [path, value] of Object.entries(packages)) {
      const item = asObject(value);
      const name = typeof item?.name === 'string' ? item.name : npmNameFromPath(path);
      if (item !== null && sameName(name, target) && item.link !== true) {
        versions.push(requiredVersion(item.version, target, 'package-lock.json'));
      }
    }
  }

  if (packages === null) {
    collectNpmDependencies(document.dependencies, target, versions);
  }

  return versions;
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
    if (sameName(name, target)) {
      versions.push(requiredVersion(dependency.version, target, 'package-lock.json'));
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
      if (!selectorsContain(selectors, target)) {
        return [];
      }
      return [requiredVersion(item?.version, target, 'yarn.lock')];
    }));
  }

  const result = lockfile.parse(content);
  if (result.type !== 'success') {
    throw new Error(`yarn.lock could not be parsed: ${result.type}.`);
  }

  return unique(Object.entries(result.object).flatMap(([selectors, item]) => {
    if (!selectorsContain(selectors, target)) {
      return [];
    }
    return [requiredVersion(item.version, target, 'yarn.lock')];
  }));
}

function pnpmLock(content: string, target: string): string[] {
  const document = yamlObject(content, 'pnpm-lock.yaml');
  const versions: string[] = [];

  const snapshotVersions = pnpmSection(document.snapshots, target);
  versions.push(...(snapshotVersions.length > 0 ? snapshotVersions : pnpmSection(document.packages, target)));

  const importers = asObject(document.importers);
  if (versions.length === 0 && importers !== null) {
    for (const importer of Object.values(importers)) {
      const importerValue = asObject(importer);
      if (importerValue === null) {
        continue;
      }
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const dependencies = asObject(importerValue[section]);
        if (dependencies === null) {
          continue;
        }
        for (const [name, raw] of Object.entries(dependencies)) {
          if (!sameName(name, target)) {
            continue;
          }
          const dependency = asObject(raw);
          const version = dependency !== null ? dependency.version : raw;
          versions.push(cleanPnpmVersion(requiredVersion(version, target, 'pnpm-lock.yaml')));
        }
      }
    }
  }

  return versions.filter((version) => version !== '');
}

function pnpmSection(value: unknown, target: string): string[] {
  const packages = asObject(value);
  if (packages === null) {
    return [];
  }

  return Object.entries(packages).flatMap(([locator, raw]) => {
    const item = asObject(raw);
    const parsed = pnpmLocator(locator);
    const name = typeof item?.name === 'string' ? item.name : parsed?.name;
    const version = typeof item?.version === 'string' ? item.version : parsed?.version;
    if (name === undefined || !sameName(name, target)) {
      return [];
    }

    return [cleanPnpmVersion(requiredVersion(version, target, 'pnpm-lock.yaml'))];
  });
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
  return versions;
}

function requirements(content: string, target: string): string[] {
  return content.split(/\r?\n/).flatMap((line) => {
    const withoutComment = line.replace(/\s+#.*$/, '').trim();
    const declaration = withoutComment.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?(?=\s|[<>=!~@]|$)(.*)$/);
    if (declaration?.[1] === undefined || !samePythonName(declaration[1], target)) {
      return [];
    }

    const pin = declaration[2]?.trim().match(/^===?\s*([^,\s;]+)(?:\s*;.*)?$/);
    if (pin?.[1] === undefined) {
      throw new Error(`${target} is not pinned to one exact version in requirements.txt.`);
    }

    return [pin[1]];
  });
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
      if (!samePythonName(name, target)) {
        continue;
      }
      const item = asObject(raw);
      const version = requiredVersion(item?.version, target, 'Pipfile.lock');
      const match = version.match(/^===?([^,\s]+)$/);
      if (match?.[1] === undefined) {
        throw new Error(`${target} is not pinned to one exact version in Pipfile.lock.`);
      }
      versions.push(match[1]);
    }
  }
  return versions;
}

function pythonTomlLock(content: string, target: string): string[] {
  const document = asObject(parseToml(content));
  const packages = document === null ? [] : arrayOrEmpty(document.package);
  return packages.flatMap((raw) => {
    const item = asObject(raw);
    if (item === null || !samePythonName(item.name, target)) {
      return [];
    }
    return [requiredVersion(item.version, target, 'Python lockfile')];
  });
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
  return value === target;
}

function samePythonName(value: unknown, target: string): boolean {
  return typeof value === 'string' && normalizePythonName(value) === normalizePythonName(target);
}

function normalizePythonName(value: string): string {
  return value.toLowerCase().replace(/[-_.]+/g, '-');
}

function requiredVersion(value: unknown, target: string, manifest: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${target} has no usable version in ${manifest}.`);
  }
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
