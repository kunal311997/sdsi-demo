#!/usr/bin/env node
/**
 * Runs the full verification suite and prints a compact PASS/FAIL summary.
 * Kept in scripts/ so the exact same commands are reproducible locally and in CI:
 *
 *   node scripts/verify-all.mjs
 */

import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const steps = [
  { name: 'typecheck', command: npx, args: ['tsc', '-p', 'tsconfig.json', '--noEmit'] },
  { name: 'lint', command: npx, args: ['eslint', '.'] },
  { name: 'format', command: npx, args: ['prettier', '--check', '.'] },
  { name: 'tests', command: npx, args: ['vitest', 'run'] },
];

let failed = 0;

for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  const result = spawnSync(step.command, step.args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status === 0) {
    console.log(`PASS ${step.name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${step.name} (exit ${result.status ?? 'null'})`);
  }
}

console.log(`\n${steps.length - failed}/${steps.length} checks passed`);
if (failed > 0) process.exitCode = 1;
