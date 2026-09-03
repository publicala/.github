import { satisfies as pep440Satisfies, valid as pep440Valid, validRange as pep440ValidRange } from '@renovatebot/pep440';
import { satisfies as rubySatisfies, valid as rubyValid, validRange as rubyValidRange } from '@snyk/ruby-semver';
import { parseConstraint, parseVersion } from 'composer-semver';
import semver from 'semver';

export function isVulnerable(ecosystem: string, version: string, vulnerableRange: string): boolean {
  switch (ecosystem.toLowerCase()) {
    case 'npm':
      return npmSatisfies(version, vulnerableRange);
    case 'composer':
      return composerSatisfies(version, vulnerableRange);
    case 'rubygems':
      return rubygemsSatisfies(version, vulnerableRange);
    case 'pip':
      return pipSatisfies(version, vulnerableRange);
    default:
      throw new Error(`Unsupported ecosystem: ${ecosystem}.`);
  }
}

function npmSatisfies(version: string, range: string): boolean {
  if (semver.valid(version) === null) {
    throw new Error(`Invalid npm version: ${version}.`);
  }

  const normalizedRange = range.replaceAll(',', ' ');
  if (semver.validRange(normalizedRange) === null) {
    throw new Error(`Invalid npm vulnerability range: ${range}.`);
  }

  return semver.satisfies(version, normalizedRange, { includePrerelease: true });
}

function composerSatisfies(version: string, range: string): boolean {
  try {
    return parseConstraint(range.replaceAll(',', ' ')).check(parseVersion(version));
  } catch (error) {
    throw new Error(`Invalid Composer version or vulnerability range: ${version} / ${range}.`, { cause: error });
  }
}

function rubygemsSatisfies(version: string, range: string): boolean {
  if (rubyValid(version) === null || rubyValidRange(range) === null) {
    throw new Error(`Invalid RubyGems version or vulnerability range: ${version} / ${range}.`);
  }

  return rubySatisfies(version, range);
}

function pipSatisfies(version: string, range: string): boolean {
  const normalizedRange = range.replace(/\s+/g, '');
  if (pep440Valid(version) === null || pep440ValidRange(normalizedRange) === null) {
    throw new Error(`Invalid pip version or vulnerability range: ${version} / ${range}.`);
  }

  return pep440Satisfies(version, normalizedRange);
}

