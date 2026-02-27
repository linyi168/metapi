import { describe, expect, it } from 'vitest';
import { calculateModelUsageCost, fallbackTokenCost, type PricingModel } from './modelPricingService.js';

describe('modelPricingService', () => {
  it('calculates token-based cost from model ratio and completion ratio', () => {
    const model: PricingModel = {
      modelName: 'gpt-4o',
      quotaType: 0,
      modelRatio: 2,
      completionRatio: 1.5,
      modelPrice: null,
      enableGroups: ['vip'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      },
      { default: 1, vip: 2 },
    );

    expect(cost).toBe(0.014);
  });

  it('falls back to total tokens when split token usage is missing', () => {
    const model: PricingModel = {
      modelName: 'claude-sonnet',
      quotaType: 0,
      modelRatio: 1,
      completionRatio: 2,
      modelPrice: null,
      enableGroups: ['default'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 2000,
      },
      { default: 1 },
    );

    expect(cost).toBe(0.004);
  });

  it('calculates per-call cost when quota type is call-based', () => {
    const model: PricingModel = {
      modelName: 'gpt-image-1',
      quotaType: 1,
      modelRatio: 1,
      completionRatio: 1,
      modelPrice: 0.3,
      enableGroups: ['vip'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      { default: 1, vip: 1.5 },
    );

    expect(cost).toBe(0.45);
  });

  it('calculates times-based per-call cost from input ratio only', () => {
    const model: PricingModel = {
      modelName: 'flux-kontext-pro',
      quotaType: 1,
      modelRatio: 1,
      completionRatio: 1,
      modelPrice: { input: 1, output: 3 },
      enableGroups: ['vip'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      { default: 1, vip: 2 },
    );

    expect(cost).toBe(0.004);
  });

  it('uses platform-specific fallback token divisor', () => {
    expect(fallbackTokenCost(1500, 'new-api')).toBe(0.003);
    expect(fallbackTokenCost(1500, 'veloera')).toBe(0.0015);
  });
});
