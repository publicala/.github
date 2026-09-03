import lockfile from '@yarnpkg/lockfile';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

export interface PackageOccurrence {
  locator: string;
  version: string;
}

export function packageVersions(manifest: string, content: string, packageName: string): string[] {
  return unique(packageOccurrences(manifest, content, packageName).map((occurrence) => occurrence.version));
}

export function packageOccurrences(manifest: string, content: string, packageName: string): PackageOccurrence[] {
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

function composerLock(content: string, target: string): PackageOccurrence[] {
  const document = jsonObject(content, 'composer.lock');
  if (!Array.isArray(document.packages)) {
    throw new Error('composer.lock packages is not an array.');
  }
  if (document['packages-dev'] !== undefined && !Array.isArray(document['packages-dev'])) {
    throw new Error('composer.lock packages-dev is not an array.');
  }
  return [
    ['packages', document.packages],
    ['packages-dev', arrayOrEmpty(document['packages-dev'])],
  ].flatMap(([section, packages]) => (packages as unknown[]).flatMap((value) => {
      const item = asObject(value);
      if (item === null || !sameName(item.name, target)) {
        return [];
      }
      return [occurrence(`${String(section)}:${target}`, item.version, target, 'composer.lock')];
    }));
}

function npmLock(content: string, target: string): PackageOccurrence[] {
  const document = jsonObject(content, 'package-lock.json');
  const occurrences: PackageOccurrence[] = [];
  const packages = asObject(document.packages);
  if (document.packages !== undefined && packages === null) {
    throw new Error('package-lock.json packages is not an object.');
  }

  if (packages !== null) {
    for (const [path, value] of Object.entries(packages)) {
      const item = asObject(value);
      const name = typeof item?.name === 'string' ? item.name : npmNameFromPath(path);
      if (item !== null && sameName(name, target) && item.link !== true) {
        occurrences.push(occurrence(path, item.version, target, 'package-lock.json'));
      }
    }
  }

  if (packages === null) {
    collectNpmDependencies(document.dependencies, target, occurrences);
  }

  return occurrences;
}

function collectNpmDependencies(
  value: unknown,
  target: string,
  occurrences: PackageOccurrence[],
  parent = '',
): void {
  const dependencies = asObject(value);
  if (dependencies === null) {
    return;
  }

  for (const [name, raw] of Object.entries(dependencies)) {
    const dependency = asObject(raw);
    if (dependency === null) {
      continue;
    }
    const locator = `${parent}node_modules/${name}`;
    if (sameName(name, target)) {
      occurrences.push(occurrence(locator, dependency.version, target, 'package-lock.json'));
    }
    collectNpmDependencies(dependency.dependencies, target, occurrences, `${locator}/`);
  }
}

function npmNameFromPath(path: string): string {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  return index === -1 ? '' : path.slice(index + marker.length);
}

function yarnLock(content: string, target: string): PackageOccurrence[] {
  if (/^__metadata:\s*$/m.test(content)) {
    const document = yamlObject(content, 'yarn.lock');
    return Object.entries(document).flatMap(([selectors, raw]) => {
      const item = asObject(raw);
      if (!selectorsContain(selectors, target)) {
        return [];
      }
      return [occurrence(selectors, item?.version, target, 'yarn.lock')];
    });
  }

  const result = lockfile.parse(content);
  if (result.type !== 'success') {
    throw new Error(`yarn.lock could not be parsed: ${result.type}.`);
  }

  return Object.entries(result.object).flatMap(([selectors, item]) => {
    if (!selectorsContain(selectors, target)) {
      return [];
    }
    return [occurrence(selectors, item.version, target, 'yarn.lock')];
  });
}

function pnpmLock(content: string, target: string): PackageOccurrence[] {
  const document = yamlObject(content, 'pnpm-lock.yaml');
  const occurrences: PackageOccurrence[] = [];

  const importers = asObject(document.importers);
  if (importers !== null) {
    for (const [importerPath, importer] of Object.entries(importers)) {
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
          occurrences.push(occurrence(
            `importer:${importerPath}:${section}:${name}`,
            cleanPnpmVersion(requiredVersion(version, target, 'pnpm-lock.yaml')),
            target,
            'pnpm-lock.yaml',
          ));
        }
      }
    }
  }

  const graph = asObject(document.snapshots) ?? asObject(document.packages);
  if (graph !== null) {
    for (const [parent, raw] of Object.entries(graph)) {
      const item = asObject(raw);
      if (item === null) {
        continue;
      }
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const dependencies = asObject(item[section]);
        if (dependencies === null) {
          continue;
        }
        for (const [name, value] of Object.entries(dependencies)) {
          if (!sameName(name, target)) {
            continue;
          }
          const dependency = asObject(value);
          const version = dependency !== null ? dependency.version : value;
          occurrences.push(occurrence(
            `package:${parent}:${section}:${name}`,
            cleanPnpmVersion(requiredVersion(version, target, 'pnpm-lock.yaml')),
            target,
            'pnpm-lock.yaml',
          ));
        }
      }
    }
  }

  if (occurrences.length > 0) {
    return occurrences;
  }

  const snapshotOccurrences = pnpmSection(document.snapshots, target);
  return snapshotOccurrences.length > 0 ? snapshotOccurrences : pnpmSection(document.packages, target);
}

function pnpmSection(value: unknown, target: string): PackageOccurrence[] {
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

    return [occurrence(
      `entry:${locator}`,
      cleanPnpmVersion(requiredVersion(version, target, 'pnpm-lock.yaml')),
      target,
      'pnpm-lock.yaml',
    )];
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

function gemfileLock(content: string, target: string): PackageOccurrence[] {
  const occurrences: PackageOccurrence[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^    ([A-Za-z0-9_.-]+) \(([^ )]+)(?: ([^)]*))?\)$/);
    if (match?.[1] !== undefined && match[2] !== undefined && sameName(match[1], target)) {
      occurrences.push({ locator: `gem:${target}:${match[3] ?? 'ruby'}`, version: match[2] });
    }
  }
  return occurrences;
}

function requirements(content: string, target: string): PackageOccurrence[] {
  return content.split(/\r?\n/).flatMap((line) => {
    const withoutComment = line.replace(/\s+#.*$/, '').trim();
    const declaration = withoutComment.match(/^([A-Za-z0-9_.-]+)(\[[^\]]+\])?(?=\s|[<>=!~@]|$)(.*)$/);
    if (declaration?.[1] === undefined || !samePythonName(declaration[1], target)) {
      return [];
    }

    const pin = declaration[3]?.trim().match(/^===?\s*([^,\s;]+)(?:\s*;(.*))?$/);
    if (pin?.[1] === undefined) {
      throw new Error(`${target} is not pinned to one exact version in requirements.txt.`);
    }

    return [{
      locator: `requirement:${normalizePythonName(declaration[1])}:${declaration[2] ?? ''}:${pin[2]?.trim() ?? ''}`,
      version: pin[1],
    }];
  });
}

function pipfileLock(content: string, target: string): PackageOccurrence[] {
  const document = jsonObject(content, 'Pipfile.lock');
  const occurrences: PackageOccurrence[] = [];
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
      occurrences.push({ locator: `${section}:${normalizePythonName(name)}`, version: match[1] });
    }
  }
  return occurrences;
}

function pythonTomlLock(content: string, target: string): PackageOccurrence[] {
  const document = asObject(parseToml(content));
  const packages = document === null ? [] : arrayOrEmpty(document.package);
  return packages.flatMap((raw) => {
    const item = asObject(raw);
    if (item === null || !samePythonName(item.name, target)) {
      return [];
    }
    const qualifier = JSON.stringify({
      groups: item.groups,
      marker: item.marker,
      source: item.source,
      optional: item.optional,
    });
    return [occurrence(
      `package:${normalizePythonName(target)}:${qualifier}`,
      item.version,
      target,
      'Python lockfile',
    )];
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

function occurrence(locator: string, version: unknown, target: string, manifest: string): PackageOccurrence {
  return { locator, version: requiredVersion(version, target, manifest) };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
