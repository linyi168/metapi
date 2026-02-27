import { describe, expect, it } from 'vitest';
import { detectPlatform, getAdapter } from './index.js';

describe('getAdapter platform aliases', () => {
  it('returns dedicated anyrouter adapter for anyrouter alias', () => {
    const adapter = getAdapter('anyrouter');
    expect(adapter?.platformName).toBe('anyrouter');
  });

  it('handles case-insensitive platform strings', () => {
    const adapter = getAdapter('Veloera');
    expect(adapter?.platformName).toBe('veloera');
  });

  it('returns undefined for unknown platforms', () => {
    expect(getAdapter('unknown-platform')).toBeUndefined();
  });

  it('detects anyrouter URL before generic new-api adapter', async () => {
    const adapter = await detectPlatform('https://anyrouter.top');
    expect(adapter?.platformName).toBe('anyrouter');
  });

  it('detects done-hub URL before generic adapters', async () => {
    const adapter = await detectPlatform('https://demo.donehub.example');
    expect(adapter?.platformName).toBe('done-hub');
  });
});
