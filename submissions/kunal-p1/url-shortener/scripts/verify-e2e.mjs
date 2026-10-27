/**
 * Boots the compiled server as a child process, waits for it to accept traffic,
 * runs `scripts/smoke.mjs` against it, then shuts it down.
 *
 * Using one process tree makes this reliable on Windows (no orphaned server, no
 * race between a background terminal and the test).
 *
 *   node scripts/verify-e2e.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

if (!existsSync(join(projectRoot, 'dist', 'index.js'))) {
  console.error('dist/index.js is missing. Run `npm run build` first.');
  process.exit(1);
}

const port = 3111;
const baseUrl = `http://127.0.0.1:${port}`;
const dbPath = join(projectRoot, 'data', 'e2e.db');
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(port),
  HOST: '127.0.0.1',
  BASE_URL: baseUrl,
  DATABASE_PATH: dbPath,
  API_KEYS: 'smoke-key',
  IP_SALT: 'smoke-test-salt',
  LOG_LEVEL: 'warn',
  RATE_LIMIT_WRITE_PER_MINUTE: '1000',
  RATE_LIMIT_GLOBAL_PER_MINUTE: '10000',
};

const server = spawn(process.execPath, [join(projectRoot, 'dist', 'index.js')], {
  cwd: projectRoot,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

function stopServer() {
  if (!server.killed) server.kill('SIGTERM');
}

async function waitForHealth(attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function main() {
  const healthy = await waitForHealth();
  if (!healthy) {
    console.error('Server did not become healthy.\n--- server output ---\n' + serverOutput);
    stopServer();
    process.exitCode = 1;
    return;
  }

  const smoke = spawn(
    process.execPath,
    [join(projectRoot, 'scripts', 'smoke.mjs'), baseUrl, 'smoke-key'],
    { cwd: projectRoot, stdio: 'inherit' },
  );

  const code = await new Promise((resolve) => smoke.on('exit', resolve));

  stopServer();
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.on('exit', resolve);
  });

  if (code !== 0) {
    console.error('\n--- server output ---\n' + serverOutput);
    process.exitCode = code ?? 1;
  }
}

main().catch((error) => {
  console.error(error);
  stopServer();
  process.exitCode = 1;
});
