import { describe, expect, it } from 'vitest';
import { filterRecentlyFailedCandidates } from './tokenRouter.js';

type Candidate = {
  channel: {
    failCount?: number | null;
    lastFailAt?: string | null;
  };
  id: string;
};

describe('filterRecentlyFailedCandidates', () => {
  it('prefers healthy channels when at least one healthy channel exists', () => {
    const nowMs = Date.now();
    const candidates: Candidate[] = [
      {
        id: 'failed',
        channel: {
          failCount: 2,
          lastFailAt: new Date(nowMs - 30 * 1000).toISOString(),
        },
      },
      {
        id: 'healthy',
        channel: {
          failCount: 0,
          lastFailAt: null,
        },
      },
    ];

    const result = filterRecentlyFailedCandidates(candidates, nowMs, 600);
    expect(result.map((c) => c.id)).toEqual(['healthy']);
  });

  it('keeps all channels when all channels failed recently', () => {
    const nowMs = Date.now();
    const candidates: Candidate[] = [
      {
        id: 'a',
        channel: {
          failCount: 1,
          lastFailAt: new Date(nowMs - 20 * 1000).toISOString(),
        },
      },
      {
        id: 'b',
        channel: {
          failCount: 3,
          lastFailAt: new Date(nowMs - 40 * 1000).toISOString(),
        },
      },
    ];

    const result = filterRecentlyFailedCandidates(candidates, nowMs, 600);
    expect(result.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('does not penalize stale failures outside the avoidance window', () => {
    const nowMs = Date.now();
    const candidates: Candidate[] = [
      {
        id: 'stale-failure',
        channel: {
          failCount: 5,
          lastFailAt: new Date(nowMs - 20 * 60 * 1000).toISOString(),
        },
      },
      {
        id: 'healthy',
        channel: {
          failCount: 0,
          lastFailAt: null,
        },
      },
    ];

    const result = filterRecentlyFailedCandidates(candidates, nowMs, 600);
    expect(result.map((c) => c.id).sort()).toEqual(['healthy', 'stale-failure']);
  });
});
