import { describe, expect, it } from 'vitest';
import { buildRuntimeHealthForAccount } from './accountHealthService.js';

describe('accountHealthService', () => {
  it('marks disabled when site or account is disabled', () => {
    expect(
      buildRuntimeHealthForAccount({ accountStatus: 'active', siteStatus: 'disabled', extraConfig: null }).state,
    ).toBe('disabled');
    expect(
      buildRuntimeHealthForAccount({ accountStatus: 'disabled', siteStatus: 'active', extraConfig: null }).state,
    ).toBe('disabled');
  });

  it('marks unhealthy when account is expired', () => {
    const health = buildRuntimeHealthForAccount({
      accountStatus: 'expired',
      siteStatus: 'active',
      extraConfig: null,
    });
    expect(health.state).toBe('unhealthy');
  });

  it('returns stored runtime health from extra config when available', () => {
    const health = buildRuntimeHealthForAccount({
      accountStatus: 'active',
      siteStatus: 'active',
      extraConfig: JSON.stringify({
        runtimeHealth: {
          state: 'healthy',
          reason: '余额刷新成功',
          source: 'balance',
          checkedAt: '2026-02-25T12:00:00.000Z',
        },
      }),
    });

    expect(health).toMatchObject({
      state: 'healthy',
      reason: '余额刷新成功',
      source: 'balance',
      checkedAt: '2026-02-25T12:00:00.000Z',
    });
  });

  it('falls back to unknown when no runtime health info exists', () => {
    const health = buildRuntimeHealthForAccount({
      accountStatus: 'active',
      siteStatus: 'active',
      extraConfig: null,
    });
    expect(health).toMatchObject({
      state: 'unknown',
      source: 'none',
    });
  });
});
