/**
 * Environment configuration: parsed once, validated eagerly, frozen.
 *
 * A misconfigured process fails at boot with a readable message instead of
 * surfacing mysterious 500s later. In production we additionally refuse to
 * start without API keys and a strong IP salt.
 */

import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean'
      ? value
      : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()),
  );

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),

  BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  DATABASE_PATH: z.string().min(1).default('./data/links.db'),

  CODE_LENGTH: z.coerce.number().int().min(6).max(8).default(7),
  MAX_URL_LENGTH: z.coerce.number().int().min(64).max(8192).default(2048),
  EXPIRY_MAX_DAYS: z.coerce.number().int().min(1).max(3650).default(3650),

  ALLOW_PRIVATE_HOSTS: booleanish.default(false),
  STATS_REQUIRE_AUTH: booleanish.default(false),

  API_KEYS: csv,
  IP_SALT: z.string().min(1).default('dev-only-salt'),
  TRUST_PROXY: z
    .string()
    .default('0')
    .transform((value) => {
      const trimmed = value.trim().toLowerCase();
      if (trimmed === '' || trimmed === '0' || trimmed === 'false') return false;
      if (trimmed === 'true') return true;
      const hops = Number(trimmed);
      return Number.isInteger(hops) && hops > 0 ? hops : false;
    }),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WRITE_PER_MINUTE: z.coerce.number().int().min(1).default(30),
  RATE_LIMIT_REDIRECT_PER_MINUTE: z.coerce.number().int().min(1).default(600),

  PRUNE_AFTER_DAYS: z.coerce.number().int().min(0).max(3650).default(30),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Omit<Env, 'API_KEYS' | 'TRUST_PROXY'> {
  apiKeys: readonly string[];
  trustProxy: boolean | number;
  /** Parsed origin of BASE_URL, used for self-reference detection. */
  selfOrigins: readonly string[];
  /** Adds `BASE_URL` without a trailing slash to build short links. */
  publicBaseUrl: string;
}

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const DEFAULT_SALT = 'dev-only-salt';

/** Validate a raw environment bag. Exported for tests. */
export function parseConfig(raw: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  const env = result.data;
  const problems: string[] = [];

  if (env.NODE_ENV === 'production') {
    if (env.API_KEYS.length === 0) {
      problems.push('API_KEYS must be set in production so writes are authenticated');
    }
    if (env.IP_SALT === DEFAULT_SALT || env.IP_SALT.length < 16) {
      problems.push('IP_SALT must be a unique secret of at least 16 characters in production');
    }
    if (env.ALLOW_PRIVATE_HOSTS) {
      problems.push('ALLOW_PRIVATE_HOSTS must not be enabled in production');
    }
    if (
      env.BASE_URL.startsWith('http://') &&
      !/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.BASE_URL)
    ) {
      problems.push('BASE_URL must use https:// in production');
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);

  let publicBaseUrl = env.BASE_URL;
  while (publicBaseUrl.endsWith('/')) publicBaseUrl = publicBaseUrl.slice(0, -1);

  const selfOrigins = new Set<string>([new URL(publicBaseUrl).origin]);

  return {
    ...env,
    apiKeys: env.API_KEYS,
    trustProxy: env.TRUST_PROXY,
    selfOrigins: [...selfOrigins],
    publicBaseUrl,
  };
}

/** Human-readable, secret-free summary for the boot log. */
export function describeConfig(config: AppConfig): Record<string, string | number | boolean> {
  const database = config.DATABASE_PATH === ':memory:' ? ':memory:' : config.DATABASE_PATH;
  return {
    nodeEnv: config.NODE_ENV,
    host: config.HOST,
    port: config.PORT,
    baseUrl: config.publicBaseUrl,
    database,
    codeLength: config.CODE_LENGTH,
    maxUrlLength: config.MAX_URL_LENGTH,
    allowPrivateHosts: config.ALLOW_PRIVATE_HOSTS,
    authEnabled: config.apiKeys.length > 0,
    apiKeyCount: config.apiKeys.length,
    statsRequireAuth: config.STATS_REQUIRE_AUTH,
    trustProxy: config.trustProxy === false ? 'disabled' : config.trustProxy,
    logLevel: config.LOG_LEVEL,
  };
}
