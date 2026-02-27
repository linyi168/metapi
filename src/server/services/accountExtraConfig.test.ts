import { describe, expect, it } from 'vitest';
import {
  getPlatformUserIdFromExtraConfig,
  guessPlatformUserIdFromUsername,
  mergeAccountExtraConfig,
  resolvePlatformUserId,
} from './accountExtraConfig.js';

describe('accountExtraConfig', () => {
  it('reads platformUserId from extra config when present', () => {
    expect(getPlatformUserIdFromExtraConfig(JSON.stringify({ platformUserId: 11494 }))).toBe(11494);
    expect(getPlatformUserIdFromExtraConfig(JSON.stringify({ platformUserId: '7659' }))).toBe(7659);
  });

  it('guesses platformUserId from username suffix digits', () => {
    expect(guessPlatformUserIdFromUsername('linuxdo_7659')).toBe(7659);
    expect(guessPlatformUserIdFromUsername('user11494')).toBe(11494);
    expect(guessPlatformUserIdFromUsername('abc')).toBeUndefined();
    expect(guessPlatformUserIdFromUsername('id_12')).toBeUndefined();
  });

  it('prefers configured user id over guessed user id', () => {
    expect(resolvePlatformUserId(JSON.stringify({ platformUserId: 5001 }), 'linuxdo_7659')).toBe(5001);
  });

  it('merges platformUserId into existing config without dropping keys', () => {
    const merged = mergeAccountExtraConfig(
      JSON.stringify({
        foo: 'bar',
        autoRelogin: { username: 'demo', passwordCipher: 'cipher' },
      }),
      { platformUserId: 7659 },
    );

    expect(merged).toBeTruthy();
    const parsed = JSON.parse(merged!);
    expect(parsed.foo).toBe('bar');
    expect(parsed.autoRelogin?.username).toBe('demo');
    expect(parsed.platformUserId).toBe(7659);
  });
});
