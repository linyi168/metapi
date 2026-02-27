import { eq } from 'drizzle-orm';
import { minimatch } from 'minimatch';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { getCachedModelRoutingReferenceCost } from './modelPricingService.js';

interface RouteMatch {
  route: typeof schema.tokenRoutes.$inferSelect;
  channels: Array<{
    channel: typeof schema.routeChannels.$inferSelect;
    account: typeof schema.accounts.$inferSelect;
    site: typeof schema.sites.$inferSelect;
    token: typeof schema.accountTokens.$inferSelect | null;
  }>;
}

type RouteChannelCandidate = RouteMatch['channels'][number];

interface SelectedChannel {
  channel: typeof schema.routeChannels.$inferSelect;
  account: typeof schema.accounts.$inferSelect;
  site: typeof schema.sites.$inferSelect;
  token: typeof schema.accountTokens.$inferSelect | null;
  tokenValue: string;
  tokenName: string;
  actualModel: string;
}

type FailureAwareChannel = {
  failCount?: number | null;
  lastFailAt?: string | null;
};

const RECENT_FAILURE_AVOID_SEC = 10 * 60;
const MIN_EFFECTIVE_UNIT_COST = 1e-6;

function isSiteDisabled(status?: string | null): boolean {
  return (status || 'active') === 'disabled';
}

export function isChannelRecentlyFailed(
  channel: FailureAwareChannel,
  nowMs = Date.now(),
  avoidSec = RECENT_FAILURE_AVOID_SEC,
): boolean {
  if (avoidSec <= 0) return false;
  if ((channel.failCount ?? 0) <= 0) return false;
  if (!channel.lastFailAt) return false;

  const failTs = Date.parse(channel.lastFailAt);
  if (Number.isNaN(failTs)) return false;

  return nowMs - failTs < avoidSec * 1000;
}

export function filterRecentlyFailedCandidates<T extends { channel: FailureAwareChannel }>(
  candidates: T[],
  nowMs = Date.now(),
  avoidSec = RECENT_FAILURE_AVOID_SEC,
): T[] {
  if (candidates.length <= 1) return candidates;
  if (avoidSec <= 0) return candidates;

  const healthy = candidates.filter((candidate) => !isChannelRecentlyFailed(candidate.channel, nowMs, avoidSec));
  // If all channels failed recently, keep them all and let weight/random decide.
  return healthy.length > 0 ? healthy : candidates;
}

export interface RouteDecisionCandidate {
  channelId: number;
  accountId: number;
  username: string;
  siteName: string;
  tokenName: string;
  priority: number;
  weight: number;
  eligible: boolean;
  recentlyFailed: boolean;
  avoidedByRecentFailure: boolean;
  probability: number;
  reason: string;
}

export interface RouteDecisionExplanation {
  requestedModel: string;
  actualModel: string;
  matched: boolean;
  routeId?: number;
  modelPattern?: string;
  selectedChannelId?: number;
  selectedAccountId?: number;
  selectedLabel?: string;
  summary: string[];
  candidates: RouteDecisionCandidate[];
}

type CostSignal = {
  unitCost: number;
  source: 'observed' | 'configured' | 'catalog' | 'fallback';
};

function resolveEffectiveUnitCost(candidate: RouteChannelCandidate, modelName: string): CostSignal {
  const successCount = Math.max(0, candidate.channel.successCount ?? 0);
  const totalCost = Math.max(0, candidate.channel.totalCost ?? 0);
  const configured = candidate.account.unitCost ?? null;

  if (successCount > 0 && totalCost > 0) {
    return {
      unitCost: Math.max(totalCost / successCount, MIN_EFFECTIVE_UNIT_COST),
      source: 'observed',
    };
  }

  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return {
      unitCost: Math.max(configured, MIN_EFFECTIVE_UNIT_COST),
      source: 'configured',
    };
  }

  const catalogCost = getCachedModelRoutingReferenceCost({
    siteId: candidate.site.id,
    accountId: candidate.account.id,
    modelName,
  });
  if (typeof catalogCost === 'number' && Number.isFinite(catalogCost) && catalogCost > 0) {
    return {
      unitCost: Math.max(catalogCost, MIN_EFFECTIVE_UNIT_COST),
      source: 'catalog',
    };
  }

  return {
    unitCost: Math.max(config.routingFallbackUnitCost || 1, MIN_EFFECTIVE_UNIT_COST),
    source: 'fallback',
  };
}

export class TokenRouter {
  /**
   * Find matching route and select a channel for the given model.
   * Returns null if no route/channel available.
   */
  selectChannel(requestedModel: string): SelectedChannel | null {
    const match = this.findRoute(requestedModel);
    if (!match) return null;

    // Apply model mapping if configured
    let actualModel = requestedModel;
    if (match.route.modelMapping) {
      try {
        const mapping = JSON.parse(match.route.modelMapping);
        if (mapping[requestedModel]) actualModel = mapping[requestedModel];
      } catch {}
    }

    // Filter channels: enabled, not in cooldown, account/site active with token
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const available = match.channels.filter((c) =>
      c.channel.enabled &&
      c.account.status === 'active' &&
      !isSiteDisabled(c.site.status) &&
      !!this.resolveChannelTokenValue(c) &&
      (!c.channel.cooldownUntil || c.channel.cooldownUntil <= nowIso),
    );

    if (available.length === 0) return null;

    // Group by priority
    const layers = new Map<number, typeof available>();
    for (const c of available) {
      const p = c.channel.priority ?? 0;
      if (!layers.has(p)) layers.set(p, []);
      layers.get(p)!.push(c);
    }

    // Sort layers by priority (ascending = higher priority first)
    const sortedPriorities = Array.from(layers.keys()).sort((a, b) => a - b);

    // Try each priority layer
    for (const priority of sortedPriorities) {
      const candidates = filterRecentlyFailedCandidates(
        layers.get(priority)!,
        nowMs,
        RECENT_FAILURE_AVOID_SEC,
      );
      const selected = this.weightedRandomSelect(candidates, actualModel);
      if (selected) {
        const tokenValue = this.resolveChannelTokenValue(selected);
        if (!tokenValue) continue;

        return {
          ...selected,
          tokenValue,
          tokenName: selected.token?.name || 'default',
          actualModel,
        };
      }
    }

    return null;
  }

  /**
   * Select next channel for failover (exclude already-tried channels).
   */
  selectNextChannel(requestedModel: string, excludeChannelIds: number[]): SelectedChannel | null {
    const match = this.findRoute(requestedModel);
    if (!match) return null;

    let actualModel = requestedModel;
    if (match.route.modelMapping) {
      try {
        const mapping = JSON.parse(match.route.modelMapping);
        if (mapping[requestedModel]) actualModel = mapping[requestedModel];
      } catch {}
    }

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const available = match.channels.filter((c) =>
      c.channel.enabled &&
      c.account.status === 'active' &&
      !isSiteDisabled(c.site.status) &&
      !!this.resolveChannelTokenValue(c) &&
      (!c.channel.cooldownUntil || c.channel.cooldownUntil <= nowIso) &&
      !excludeChannelIds.includes(c.channel.id),
    );

    if (available.length === 0) return null;

    const layers = new Map<number, typeof available>();
    for (const c of available) {
      const p = c.channel.priority ?? 0;
      if (!layers.has(p)) layers.set(p, []);
      layers.get(p)!.push(c);
    }

    const sortedPriorities = Array.from(layers.keys()).sort((a, b) => a - b);
    for (const priority of sortedPriorities) {
      const candidates = filterRecentlyFailedCandidates(
        layers.get(priority)!,
        nowMs,
        RECENT_FAILURE_AVOID_SEC,
      );
      const selected = this.weightedRandomSelect(candidates, actualModel);
      if (!selected) continue;

      const tokenValue = this.resolveChannelTokenValue(selected);
      if (!tokenValue) continue;

      return {
        ...selected,
        tokenValue,
        tokenName: selected.token?.name || 'default',
        actualModel,
      };
    }

    return null;
  }

  explainSelection(requestedModel: string, excludeChannelIds: number[] = []): RouteDecisionExplanation {
    const match = this.findRoute(requestedModel);
    if (!match) {
      return {
        requestedModel,
        actualModel: requestedModel,
        matched: false,
        summary: ['未匹配到启用的路由'],
        candidates: [],
      };
    }

    let actualModel = requestedModel;
    if (match.route.modelMapping) {
      try {
        const mapping = JSON.parse(match.route.modelMapping) as Record<string, string>;
        if (mapping[requestedModel]) actualModel = mapping[requestedModel];
      } catch {}
    }

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const summary: string[] = [`命中路由：${match.route.modelPattern}`];
    const availableByPriority = new Map<number, RouteChannelCandidate[]>();
    const candidates: RouteDecisionCandidate[] = [];
    const candidateMap = new Map<number, RouteDecisionCandidate>();

    for (const row of match.channels) {
      const reasonParts: string[] = [];
      if (!row.channel.enabled) reasonParts.push('通道禁用');
      if (row.account.status !== 'active') reasonParts.push(`账号状态=${row.account.status}`);
      if (isSiteDisabled(row.site.status)) reasonParts.push(`站点状态=${row.site.status || 'disabled'}`);
      if (excludeChannelIds.includes(row.channel.id)) reasonParts.push('当前请求已尝试');
      const tokenValue = this.resolveChannelTokenValue(row);
      if (!tokenValue) reasonParts.push('令牌不可用');
      if (row.channel.cooldownUntil && row.channel.cooldownUntil > nowIso) reasonParts.push('冷却中');

      const recentlyFailed = isChannelRecentlyFailed(row.channel, nowMs, RECENT_FAILURE_AVOID_SEC);
      const eligible = reasonParts.length === 0;
      const candidate: RouteDecisionCandidate = {
        channelId: row.channel.id,
        accountId: row.account.id,
        username: row.account.username || `account-${row.account.id}`,
        siteName: row.site.name || 'unknown',
        tokenName: row.token?.name || 'default',
        priority: row.channel.priority ?? 0,
        weight: row.channel.weight ?? 10,
        eligible,
        recentlyFailed,
        avoidedByRecentFailure: false,
        probability: 0,
        reason: eligible ? '可用' : reasonParts.join('、'),
      };
      candidates.push(candidate);
      candidateMap.set(candidate.channelId, candidate);

      if (eligible) {
        const priority = row.channel.priority ?? 0;
        if (!availableByPriority.has(priority)) availableByPriority.set(priority, []);
        availableByPriority.get(priority)!.push(row);
      }
    }

    if (availableByPriority.size === 0) {
      summary.push('没有可用通道（全部被禁用、站点不可用、冷却或令牌不可用）');
      return {
        requestedModel,
        actualModel,
        matched: true,
        routeId: match.route.id,
        modelPattern: match.route.modelPattern,
        summary,
        candidates,
      };
    }

    const sortedPriorities = Array.from(availableByPriority.keys()).sort((a, b) => a - b);
    let selected: RouteChannelCandidate | null = null;
    let selectedPriority = 0;

    for (const priority of sortedPriorities) {
      const rawLayer = availableByPriority.get(priority) ?? [];
      if (rawLayer.length === 0) continue;

      const filteredLayer = filterRecentlyFailedCandidates(rawLayer, nowMs, RECENT_FAILURE_AVOID_SEC);
      const avoided = rawLayer.filter((row) => !filteredLayer.some((item) => item.channel.id === row.channel.id));
      if (avoided.length > 0) {
        for (const row of avoided) {
          const target = candidateMap.get(row.channel.id);
          if (!target) continue;
          target.avoidedByRecentFailure = true;
          target.reason = `最近失败，优先避让（${RECENT_FAILURE_AVOID_SEC / 60} 分钟窗口）`;
        }
      }

      const weighted = this.calculateWeightedSelection(filteredLayer, actualModel);
      for (const detail of weighted.details) {
        const target = candidateMap.get(detail.candidate.channel.id);
        if (!target) continue;
        target.probability = Number((detail.probability * 100).toFixed(2));
        if (target.eligible && !target.avoidedByRecentFailure) {
          target.reason = detail.reason;
        }
      }

      if (!weighted.selected) continue;
      selected = weighted.selected;
      selectedPriority = priority;
      summary.push(
        avoided.length > 0
          ? `优先级 P${priority}：可用 ${rawLayer.length}，因最近失败避让 ${avoided.length}`
          : `优先级 P${priority}：可用 ${rawLayer.length}`,
      );
      break;
    }

    if (!selected) {
      summary.push('本次未选出通道');
      return {
        requestedModel,
        actualModel,
        matched: true,
        routeId: match.route.id,
        modelPattern: match.route.modelPattern,
        summary,
        candidates,
      };
    }

    const selectedChannel = candidateMap.get(selected.channel.id);
    const selectedLabel = selectedChannel
      ? `${selectedChannel.username} @ ${selectedChannel.siteName} / ${selectedChannel.tokenName}`
      : `channel-${selected.channel.id}`;
    summary.push(`最终选择：${selectedLabel}（P${selectedPriority}）`);

    return {
      requestedModel,
      actualModel,
      matched: true,
      routeId: match.route.id,
      modelPattern: match.route.modelPattern,
      selectedChannelId: selected.channel.id,
      selectedAccountId: selected.account.id,
      selectedLabel,
      summary,
      candidates,
    };
  }

  /**
   * Record success for a channel.
   */
  recordSuccess(channelId: number, latencyMs: number, cost: number) {
    const ch = db.select().from(schema.routeChannels).where(eq(schema.routeChannels.id, channelId)).get();
    if (!ch) return;
    db.update(schema.routeChannels).set({
      successCount: (ch.successCount ?? 0) + 1,
      totalLatencyMs: (ch.totalLatencyMs ?? 0) + latencyMs,
      totalCost: (ch.totalCost ?? 0) + cost,
      lastUsedAt: new Date().toISOString(),
      cooldownUntil: null,
      lastFailAt: null,
    }).where(eq(schema.routeChannels.id, channelId)).run();
  }

  /**
   * Record failure and set cooldown.
   */
  recordFailure(channelId: number) {
    const ch = db.select().from(schema.routeChannels).where(eq(schema.routeChannels.id, channelId)).get();
    if (!ch) return;
    const failCount = (ch.failCount ?? 0) + 1;
    // Exponential backoff cooldown: 30s, 60s, 120s, 240s, max 5min
    const cooldownSec = Math.min(30 * Math.pow(2, failCount - 1), 300);
    const cooldownUntil = new Date(Date.now() + cooldownSec * 1000).toISOString();
    db.update(schema.routeChannels).set({
      failCount,
      lastFailAt: new Date().toISOString(),
      cooldownUntil,
    }).where(eq(schema.routeChannels.id, channelId)).run();
  }

  /**
   * Get all available models (aggregated from all routes).
   */
  getAvailableModels(): string[] {
    const routes = db.select().from(schema.tokenRoutes)
      .where(eq(schema.tokenRoutes.enabled, true)).all();
    return routes.map((r) => r.modelPattern);
  }

  // --- Private methods ---

  private findRoute(model: string): RouteMatch | null {
    const routes = db.select().from(schema.tokenRoutes)
      .where(eq(schema.tokenRoutes.enabled, true)).all();

    // Find matching route by pattern
    const matchedRoute = routes.find((r) => {
      if (r.modelPattern === model) return true; // exact match
      return minimatch(model, r.modelPattern); // glob match
    });

    if (!matchedRoute) return null;

    // Get channels with account, site and token info
    const channels = db
      .select()
      .from(schema.routeChannels)
      .innerJoin(schema.accounts, eq(schema.routeChannels.accountId, schema.accounts.id))
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .leftJoin(schema.accountTokens, eq(schema.routeChannels.tokenId, schema.accountTokens.id))
      .where(eq(schema.routeChannels.routeId, matchedRoute.id))
      .all();

    const mapped = channels.map((row) => ({
      channel: row.route_channels,
      account: row.accounts,
      site: row.sites,
      token: row.account_tokens,
    }));

    return { route: matchedRoute, channels: mapped };
  }

  private resolveChannelTokenValue(candidate: {
    channel: typeof schema.routeChannels.$inferSelect;
    account: typeof schema.accounts.$inferSelect;
    token: typeof schema.accountTokens.$inferSelect | null;
  }): string | null {
    if (candidate.channel.tokenId) {
      if (!candidate.token) return null;
      if (!candidate.token.enabled) return null;
      const token = candidate.token.token?.trim();
      return token ? token : null;
    }

    const fallback = candidate.account.apiToken?.trim();
    return fallback ? fallback : null;
  }

  private weightedRandomSelect(
    candidates: RouteChannelCandidate[],
    modelName: string,
  ) {
    return this.calculateWeightedSelection(candidates, modelName).selected;
  }

  private calculateWeightedSelection(candidates: RouteChannelCandidate[], modelName: string) {
    if (candidates.length === 0) {
      return {
        selected: null as RouteChannelCandidate | null,
        details: [] as Array<{ candidate: RouteChannelCandidate; probability: number; reason: string }>,
      };
    }

    if (candidates.length === 1) {
      return {
        selected: candidates[0],
        details: [{
          candidate: candidates[0],
          probability: 1,
          reason: '唯一可用候选',
        }],
      };
    }

    const { baseWeightFactor, valueScoreFactor, costWeight, balanceWeight, usageWeight } = config.routingWeights;
    const effectiveCosts = candidates.map((candidate) => resolveEffectiveUnitCost(candidate, modelName));

    const valueScores = candidates.map((c, i) => {
      const unitCost = effectiveCosts[i]?.unitCost || 1;
      const balance = c.account.balance || 0;
      const totalUsed = (c.channel.successCount ?? 0) + (c.channel.failCount ?? 0);
      const recentUsage = Math.max(totalUsed, 1);
      return costWeight * (1 / unitCost) + balanceWeight * balance + usageWeight * (1 / recentUsage);
    });

    const maxVS = Math.max(...valueScores, 0.001);
    const minVS = Math.min(...valueScores, 0);
    const range = maxVS - minVS || 1;
    const normalizedVS = valueScores.map((v) => (v - minVS) / range);

    const baseContributions = candidates.map((c, i) => {
      const weight = c.channel.weight ?? 10;
      return (weight + 10) * (baseWeightFactor + normalizedVS[i] * valueScoreFactor);
    });

    // Avoid over-favoring a site that has many tokens/channels for the same route.
    // Site-level total contribution remains comparable, then split across its channels.
    const siteChannelCounts = new Map<number, number>();
    for (const candidate of candidates) {
      siteChannelCounts.set(candidate.site.id, (siteChannelCounts.get(candidate.site.id) || 0) + 1);
    }

    const contributions = candidates.map((candidate, i) => {
      const siteChannels = Math.max(1, siteChannelCounts.get(candidate.site.id) || 1);
      let contribution = baseContributions[i] / siteChannels;

      // If upstream price is unknown and we are using fallback unit cost,
      // apply an explicit penalty so raising fallback cost meaningfully lowers probability.
      if (effectiveCosts[i]?.source === 'fallback') {
        contribution *= 1 / Math.max(1, effectiveCosts[i]?.unitCost || 1);
      }

      return contribution;
    });

    const totalContribution = contributions.reduce((a, b) => a + b, 0);
    const details = candidates.map((candidate, i) => {
      const probability = totalContribution > 0 ? contributions[i] / totalContribution : 0;
      const weight = candidate.channel.weight ?? 10;
      const cost = effectiveCosts[i];
      const costSourceText = cost?.source === 'observed'
        ? '实测'
        : (cost?.source === 'configured' ? '配置' : (cost?.source === 'catalog' ? '目录' : '默认'));
      const siteChannels = Math.max(1, siteChannelCounts.get(candidate.site.id) || 1);
      return {
        candidate,
        probability,
        reason: `按权重随机（W=${weight}，成本=${costSourceText}:${(cost?.unitCost || 1).toFixed(6)}，同站点通道=${siteChannels}，概率≈${(probability * 100).toFixed(1)}%）`,
      };
    });

    let rand = Math.random() * totalContribution;
    let selected = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i++) {
      rand -= contributions[i];
      if (rand <= 0) {
        selected = candidates[i];
        break;
      }
    }

    return { selected, details };
  }
}

export const tokenRouter = new TokenRouter();

