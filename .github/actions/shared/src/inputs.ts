import * as core from '@actions/core';
import { GateError } from './failure.js';

export function requiredInput(name: string): string {
  const value = core.getInput(name);

  if (value === '') {
    throw new GateError(`The ${name} input is required.`);
  }

  return value;
}
