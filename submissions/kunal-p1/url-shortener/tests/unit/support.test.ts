import { describe, expect, it } from 'vitest';

import { buildDenseSeries, clampInteger } from '../../src/services/linkService.js';
import { ConfigError, parseConfig } from '../../src/config.js';
import { testEnv } from '../helpers/testContext.js';

describe('buildDenseSeries', () => {
  it('fills gaps with zero and keeps order', () => {
    const series = buildDenseSeries(
      [
        { day: '2026-01-15', clicks: 2 },
        { day: '2026-01-17', clicks: 5 },
      ],
      Date.parse('2026-01-15T10:00:00Z'),
      Date.parse('2026-01-18T09:00:00Z'),
    );

    expect(series).toEqual([
      { date: '2026-01-15', clicks: 2 },
      { date: '2026-01-16', clicks: 0 },
      { date: '2026-01-17', clicks: 5 },
      { date: '2026-01-18', clicks: 0 },
    ]);
  });

  it('caps the series length', () => {
    const series = buildDenseSeries(
      [],
      Date.parse('2020-01-01T00:00:00Z'),
      Date.parse('2026-01-01T00:00:00Z'),
      30,
    );
    expect(series).toHaveLength(30);
    expect(series[series.length - 1]?.date).toBe('2026-01-01');
  });

  it('does not run past the current day', () => {
    const series = buildDenseSeries(
      [],
      Date.parse('2026-01-15T00:00:00Z'),
      Date.parse('2026-01-15T23:59:00Z'),
    );
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({ date: '2026-01-15', clicks: 0 });
  });
});

describe('clampInteger', () => {
  it('clamps within bounds', () => {
    expect(clampInteger(5, 1, 10)).toBe(5);
    expect(clampInteger(0, 1, 10)).toBe(1);
    expect(clampInteger(99, 1, 10)).toBe(10);
  });

  it('handles non-finite and fractional values', () => {
    expect(clampInteger(Number.NaN, 1, 10)).toBe(1);
    expect(clampInteger(Number.POSITIVE_INFINITY, 1, 10)).toBe(1);
    expect(clampInteger(4.9, 1, 10)).toBe(4);
  });
});

describe('configuration', () => {
  it('applies safe development defaults', () => {
    const config = parseConfig({ NODE_ENV: 'development' });
    expect(config.PORT).toBe(3000);
    expect(config.CODE_LENGTH).toBe(7);
    expect(config.ALLOW_PRIVATE_HOSTS).toBe(false);
    expect(config.STATS_REQUIRE_AUTH).toBe(false);
    expect(config.EXPIRY_MAX_DAYS).toBe(3650);
  });

  it('strips trailing slashes from the public base URL', () => {
    const config = parseConfig(testEnv({ BASE_URL: 'https://sho.rt/' }));
    expect(config.publicBaseUrl).toBe('https://sho.rt');
    expect(config.selfOrigins).toContain('https://sho.rt');
  });

  it('parses comma separated API keys', () => {
    const config = parseConfig(testEnv({ API_KEYS: 'a, b ,,c' }));
    expect(config.apiKeys).toEqual(['a', 'b', 'c']);
  });

  it('parses trust proxy values', () => {
    expect(parseConfig(testEnv({ TRUST_PROXY: '0' })).trustProxy).toBe(false);
    expect(parseConfig(testEnv({ TRUST_PROXY: 'false' })).trustProxy).toBe(false);
    expect(parseConfig(testEnv({ TRUST_PROXY: 'true' })).trustProxy).toBe(true);
    expect(parseConfig(testEnv({ TRUST_PROXY: '2' })).trustProxy).toBe(2);
  });

  it('parses boolean-ish flags', () => {
    expect(parseConfig(testEnv({ ALLOW_PRIVATE_HOSTS: 'true' })).ALLOW_PRIVATE_HOSTS).toBe(true);
    expect(parseConfig(testEnv({ ALLOW_PRIVATE_HOSTS: 'TRUE' })).ALLOW_PRIVATE_HOSTS).toBe(true);
    expect(parseConfig(testEnv({ ALLOW_PRIVATE_HOSTS: '0' })).ALLOW_PRIVATE_HOSTS).toBe(false);
  });

  it('rejects an out-of-range code length', () => {
    expect(() => parseConfig(testEnv({ CODE_LENGTH: '5' }))).toThrow(ConfigError);
    expect(() => parseConfig(testEnv({ CODE_LENGTH: '9' }))).toThrow(ConfigError);
  });

  it('rejects production without API keys or a real salt', () => {
    expect(() => parseConfig({ NODE_ENV: 'production', BASE_URL: 'https://sho.rt' })).toThrow(
      ConfigError,
    );
    expect(() =>
      parseConfig({
        NODE_ENV: 'production',
        BASE_URL: 'https://sho.rt',
        API_KEYS: 'real-key',
        IP_SALT: 'dev-only-salt',
      }),
    ).toThrow(/IP_SALT/);
  });

  it('accepts a valid production configuration', () => {
    const config = parseConfig({
      NODE_ENV: 'production',
      BASE_URL: 'https://sho.rt',
      API_KEYS: 'real-key',
      IP_SALT: 'a-very-long-random-production-salt',
    });
    expect(config.apiKeys).toEqual(['real-key']);
  });

  it('rejects private-host allowance in production', () => {
    expect(() =>
      parseConfig({
        NODE_ENV: 'production',
        BASE_URL: 'https://sho.rt',
        API_KEYS: 'real-key',
        IP_SALT: 'a-very-long-random-production-salt',
        ALLOW_PRIVATE_HOSTS: 'true',
      }),
    ).toThrow(/ALLOW_PRIVATE_HOSTS/);
  });
});
