import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import { InlineBrandIcon, getBrand, useIconCdn, type BrandInfo } from '../components/BrandIcon.js';
import { useToast } from '../components/Toast.js';
import ModernSelect from '../components/ModernSelect.js';
import { tr } from '../i18n.js';

type RouteSortBy = 'modelPattern' | 'channelCount';
type RouteSortDir = 'asc' | 'desc';

type RouteChannelDraft = {
  accountId: number;
  tokenId: number;
};

type AccountRow = {
  id: number;
  username: string | null;
  status: string;
  site?: {
    name: string | null;
  } | null;
};

type TokenRow = {
  id: number;
  accountId: number;
  name: string;
  enabled: boolean;
  isDefault: boolean;
};

type RouteChannel = {
  id: number;
  accountId: number;
  tokenId: number | null;
  priority: number;
  weight: number;
  enabled: boolean;
  manualOverride: boolean;
  successCount: number;
  failCount: number;
  cooldownUntil?: string | null;
  account?: {
    username: string | null;
  };
  site?: {
    name: string | null;
  };
  token?: {
    id: number;
    name: string;
    accountId: number;
    enabled: boolean;
    isDefault: boolean;
  } | null;
};

type RouteRow = {
  id: number;
  modelPattern: string;
  modelMapping?: string | null;
  enabled: boolean;
  channels: RouteChannel[];
};

type ModelCandidate = {
  accountId: number;
  tokenId: number;
  tokenName: string;
  isDefault: boolean;
  username: string | null;
  siteId: number;
  siteName: string;
};

type RouteDecisionCandidate = {
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
};

type RouteDecision = {
  requestedModel: string;
  actualModel: string;
  matched: boolean;
  selectedChannelId?: number;
  selectedLabel?: string;
  summary: string[];
  candidates: RouteDecisionCandidate[];
};

type ChannelDecisionState = {
  probability: number;
  showBar: boolean;
  reasonText: string;
  reasonColor: string;
};

type SortableChannelRowProps = {
  channel: RouteChannel;
  decisionCandidate?: RouteDecisionCandidate;
  isExactRoute: boolean;
  loadingDecision: boolean;
  isSavingPriority: boolean;
  tokenOptions: Array<{ id: number; name: string; isDefault: boolean }>;
  activeTokenId: number;
  isUpdatingToken: boolean;
  onTokenDraftChange: (channelId: number, tokenId: number) => void;
  onSaveToken: () => void;
  onDeleteChannel: () => void;
};

const AUTO_ROUTE_DECISION_LIMIT = 80;

function isExactModelPattern(modelPattern: string): boolean {
  return !/[\*\?\[]/.test(modelPattern);
}

function normalizeRoutes(routeRows: any[]): RouteRow[] {
  return (routeRows || []).map((route) => {
    const channels = [...((route.channels || []) as RouteChannel[])].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa === pb) return (a.id ?? 0) - (b.id ?? 0);
      return pa - pb;
    });

    return {
      ...(route as RouteRow),
      channels,
    };
  });
}

function getPriorityTagStyle(priority: number): CSSProperties {
  if (priority <= 0) {
    return {
      background: 'color-mix(in srgb, var(--color-success) 16%, transparent)',
      color: 'var(--color-success)',
    };
  }

  if (priority === 1) {
    return {
      background: 'color-mix(in srgb, var(--color-info) 16%, transparent)',
      color: 'var(--color-info)',
    };
  }

  return {
    background: 'rgba(100,116,139,0.18)',
    color: 'var(--color-text-secondary)',
  };
}

function getProbabilityColor(probability: number): string {
  if (probability >= 80) return 'var(--color-success)';
  if (probability >= 60) return 'color-mix(in srgb, var(--color-success) 50%, var(--color-warning))';
  if (probability >= 40) return 'var(--color-warning)';
  if (probability >= 20) return 'color-mix(in srgb, var(--color-warning) 45%, var(--color-danger))';
  if (probability > 0) return 'var(--color-danger)';
  return 'var(--color-border)';
}

function getChannelDecisionState(
  candidate: RouteDecisionCandidate | undefined,
  channel: RouteChannel,
  isExactRoute: boolean,
  loadingDecision: boolean,
): ChannelDecisionState {
  if (!isExactRoute) {
    return {
      probability: 0,
      showBar: true,
      reasonText: '实时决策',
      reasonColor: 'var(--color-text-muted)',
    };
  }

  if (!candidate) {
    return {
      probability: 0,
      showBar: true,
      reasonText: loadingDecision ? '计算中...' : '无可用通道',
      reasonColor: 'var(--color-text-muted)',
    };
  }

  if (candidate.avoidedByRecentFailure) {
    return {
      probability: 0,
      showBar: true,
      reasonText: '失败避让',
      reasonColor: 'var(--color-warning)',
    };
  }

  if (!candidate.eligible) {
    const nowIso = new Date().toISOString();
    const cooldownActive = !!channel.cooldownUntil && channel.cooldownUntil > nowIso;
    if (cooldownActive || candidate.reason.includes('冷却中')) {
      return {
        probability: 0,
        showBar: true,
        reasonText: '冷却中',
        reasonColor: 'var(--color-danger)',
      };
    }

    return {
      probability: 0,
      showBar: true,
      reasonText: candidate.reason || '不可用',
      reasonColor: 'var(--color-text-muted)',
    };
  }

  const probability = Number(candidate.probability || 0);
  if (probability <= 0) {
    if (candidate.recentlyFailed) {
      return {
        probability: 0,
        showBar: false,
        reasonText: '近期失败',
        reasonColor: 'var(--color-warning)',
      };
    }

    return {
      probability: 0,
      showBar: false,
      reasonText: candidate.reason || '概率为 0%',
      reasonColor: 'var(--color-text-muted)',
    };
  }

  return {
    probability,
    showBar: true,
    reasonText: '',
    reasonColor: 'var(--color-text-muted)',
  };
}

function SortableChannelRow({
  channel,
  decisionCandidate,
  isExactRoute,
  loadingDecision,
  isSavingPriority,
  tokenOptions,
  activeTokenId,
  isUpdatingToken,
  onTokenDraftChange,
  onSaveToken,
  onDeleteChannel,
}: SortableChannelRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: channel.id,
    disabled: isSavingPriority,
  });

  const rowStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
    zIndex: isDragging ? 10 : 1,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderLeft: '2px solid var(--color-primary)',
    borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
    background: isDragging ? 'rgba(59,130,246,0.08)' : 'rgba(79,70,229,0.02)',
    boxShadow: isDragging ? 'var(--shadow-sm)' : 'none',
  };

  const decisionState = getChannelDecisionState(decisionCandidate, channel, isExactRoute, loadingDecision);

  return (
    <div ref={setNodeRef} style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap', minWidth: 0 }}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={isSavingPriority}
          className="btn btn-ghost"
          style={{
            width: 22,
            minWidth: 22,
            height: 22,
            padding: 0,
            border: '1px solid var(--color-border-light)',
            color: 'var(--color-text-muted)',
            cursor: isSavingPriority ? 'not-allowed' : 'grab',
          }}
          title="拖拽调整优先级"
        >
          <svg width="12" height="12" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
            <circle cx="3" cy="2" r="1" />
            <circle cx="9" cy="2" r="1" />
            <circle cx="3" cy="6" r="1" />
            <circle cx="9" cy="6" r="1" />
            <circle cx="3" cy="10" r="1" />
            <circle cx="9" cy="10" r="1" />
          </svg>
        </button>

        <span
          className="badge"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.1,
            ...getPriorityTagStyle(channel.priority ?? 0),
          }}
        >
          P{channel.priority ?? 0}
        </span>

        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {channel.account?.username || `account-${channel.accountId}`}
        </span>

        <span className="badge badge-muted" style={{ fontSize: 10 }}>
          {channel.site?.name || 'unknown'}
        </span>

        <span
          className="badge"
          style={{
            fontSize: 10,
            background: 'color-mix(in srgb, var(--color-info) 15%, transparent)',
            color: 'var(--color-info)',
          }}
        >
          {channel.token?.name || '默认令牌'}
        </span>

        {channel.manualOverride ? (
          <span
            className="badge badge-warning"
            style={{ fontSize: 10 }}
            title="该通道由用户手动添加，而非系统自动生成"
          >
            手动配置
          </span>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>选中概率</span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 120 }}>
            <div
              title={decisionState.probability <= 0 ? decisionState.reasonText : undefined}
              style={{
                width: 80,
                height: 6,
                background: 'var(--color-border)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, decisionState.probability))}%`,
                  height: '100%',
                  background: getProbabilityColor(decisionState.probability),
                  borderRadius: 999,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span
              title={decisionState.probability <= 0 ? decisionState.reasonText : undefined}
              style={{
                fontSize: 11,
                color: decisionState.probability > 0 ? 'var(--color-text-secondary)' : decisionState.reasonColor,
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {decisionState.probability.toFixed(1)}%
            </span>
          </div>

          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>成功/失败</span>
          <span style={{ fontSize: 11 }}>
            <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{channel.successCount || 0}</span>
            <span style={{ color: 'var(--color-text-muted)', margin: '0 2px' }}>/</span>
            <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{channel.failCount || 0}</span>
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ minWidth: 150, flex: 1 }}>
          <ModernSelect
            size="sm"
            value={String(activeTokenId || 0)}
            onChange={(nextValue) => onTokenDraftChange(channel.id, Number.parseInt(nextValue, 10) || 0)}
            disabled={isUpdatingToken}
            options={[
              { value: '0', label: '默认令牌' },
              ...tokenOptions.map((token) => ({
                value: String(token.id),
                label: `${token.name}${token.isDefault ? '（默认）' : ''}`,
              })),
            ]}
            placeholder="默认令牌"
          />
        </div>
        <button
          onClick={onSaveToken}
          disabled={isUpdatingToken}
          className="btn btn-link btn-link-info"
        >
          {isUpdatingToken ? <span className="spinner spinner-sm" /> : '改令牌'}
        </button>
      </div>

      <button
        onClick={onDeleteChannel}
        className="btn btn-link btn-link-danger"
      >
        移除
      </button>
    </div>
  );
}

export default function TokenRoutes() {
  const cdn = useIconCdn();
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [modelCandidates, setModelCandidates] = useState<Record<string, ModelCandidate[]>>({});

  const [search, setSearch] = useState('');
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const [sortBy, setSortBy] = useState<RouteSortBy>('channelCount');
  const [sortDir, setSortDir] = useState<RouteSortDir>('desc');

  const [showManual, setShowManual] = useState(false);
  const [form, setForm] = useState({ modelPattern: '', modelMapping: '' });
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const [channelDraftByRoute, setChannelDraftByRoute] = useState<Record<number, RouteChannelDraft>>({});
  const [channelTokenDraft, setChannelTokenDraft] = useState<Record<number, number>>({});
  const [updatingChannel, setUpdatingChannel] = useState<Record<number, boolean>>({});
  const [savingPriorityByRoute, setSavingPriorityByRoute] = useState<Record<number, boolean>>({});

  const [decisionByRoute, setDecisionByRoute] = useState<Record<number, RouteDecision | null>>({});
  const [loadingDecision, setLoadingDecision] = useState(false);
  const [decisionAutoSkipped, setDecisionAutoSkipped] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const toast = useToast();

  const loadRouteDecisions = async (routeRows: RouteRow[], options?: { force?: boolean }) => {
    const rows = routeRows || [];
    const exactRoutes = rows.filter((route) => isExactModelPattern(route.modelPattern));
    const defaultState: Record<number, RouteDecision | null> = {};
    for (const route of rows) defaultState[route.id] = null;

    if (exactRoutes.length === 0) {
      setDecisionByRoute(defaultState);
      setDecisionAutoSkipped(false);
      return;
    }

    if (!options?.force && exactRoutes.length > AUTO_ROUTE_DECISION_LIMIT) {
      setDecisionByRoute(defaultState);
      setDecisionAutoSkipped(true);
      return;
    }

    setLoadingDecision(true);
    try {
      setDecisionAutoSkipped(false);
      const res = await api.getRouteDecisionsBatch(exactRoutes.map((route) => route.modelPattern));
      const decisionMap = (res?.decisions || {}) as Record<string, RouteDecision | null>;
      const next = { ...defaultState };
      for (const route of exactRoutes) {
        next[route.id] = decisionMap[route.modelPattern] || null;
      }
      setDecisionByRoute(next);
    } catch {
      setDecisionByRoute(defaultState);
      setDecisionAutoSkipped(false);
    } finally {
      setLoadingDecision(false);
    }
  };

  const load = async () => {
    const [routeRows, accountRows, tokenRows, candidateRows] = await Promise.all([
      api.getRoutes(),
      api.getAccounts(),
      api.getAccountTokens(),
      api.getModelTokenCandidates(),
    ]);

    const normalizedRoutes = normalizeRoutes(routeRows || []);
    setRoutes(normalizedRoutes);
    setAccounts((accountRows || []) as AccountRow[]);
    setTokens((tokenRows || []) as TokenRow[]);
    setModelCandidates((candidateRows?.models || {}) as Record<string, ModelCandidate[]>);
    void loadRouteDecisions(normalizedRoutes, { force: true });
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch {
        toast.error('加载路由配置失败');
      }
    })();
  }, []);

  const handleRebuild = async () => {
    try {
      setRebuilding(true);
      const res = await api.rebuildRoutes(true);
      if (res?.queued) {
        toast.info(res.message || '已开始重建路由，请稍后查看日志');
        await load();
        return;
      }
      const createdRoutes = res?.rebuild?.createdRoutes ?? 0;
      const createdChannels = res?.rebuild?.createdChannels ?? 0;
      toast.success(`自动重建完成（新增 ${createdRoutes} 条路由 / ${createdChannels} 个通道）`);
      await load();
    } catch (e: any) {
      toast.error(e.message || '重建路由失败');
    } finally {
      setRebuilding(false);
    }
  };

  const handleRefreshRouteDecisions = async () => {
    try {
      await loadRouteDecisions(routes, { force: true });
      toast.success('路由选择概率已刷新');
    } catch {
      toast.error('刷新路由选择概率失败');
    }
  };

  const exactRouteCount = useMemo(
    () => routes.filter((route) => isExactModelPattern(route.modelPattern)).length,
    [routes],
  );

  const handleAddRoute = async () => {
    if (!form.modelPattern.trim()) return;

    setSaving(true);
    try {
      await api.addRoute({
        modelPattern: form.modelPattern.trim(),
        modelMapping: form.modelMapping.trim() ? form.modelMapping.trim() : undefined,
      });
      setShowManual(false);
      setForm({ modelPattern: '', modelMapping: '' });
      toast.success('路由已创建');
      await load();
    } catch (e: any) {
      toast.error(e.message || '创建路由失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRoute = async (routeId: number) => {
    try {
      await api.deleteRoute(routeId);
      toast.success('路由已删除');
      await load();
    } catch (e: any) {
      toast.error(e.message || '删除路由失败');
    }
  };

  const activeAccountOptions = useMemo(
    () =>
      accounts
        .filter((account) => account.status === 'active')
        .map((account) => ({
          id: account.id,
          label: `${account.username || `account-${account.id}`} @ ${account.site?.name || 'unknown'}`,
        })),
    [accounts],
  );

  const tokensByAccount = useMemo(() => {
    const grouped: Record<number, TokenRow[]> = {};
    for (const token of tokens) {
      if (!token.enabled) continue;
      if (!grouped[token.accountId]) grouped[token.accountId] = [];
      grouped[token.accountId].push(token);
    }

    for (const accountId of Object.keys(grouped)) {
      grouped[Number(accountId)].sort((a, b) => {
        if (a.isDefault === b.isDefault) return a.id - b.id;
        return a.isDefault ? -1 : 1;
      });
    }

    return grouped;
  }, [tokens]);

  const brandList = useMemo(() => {
    const grouped = new Map<string, { count: number; brand: BrandInfo }>();
    let otherCount = 0;

    for (const route of routes) {
      const brand = getBrand(route.modelPattern);
      if (!brand) {
        otherCount++;
        continue;
      }

      const existing = grouped.get(brand.name);
      if (existing) {
        existing.count++;
      } else {
        grouped.set(brand.name, { count: 1, brand });
      }
    }

    return {
      list: [...grouped.entries()].sort((a, b) => {
        if (a[1].count === b[1].count) return a[0].localeCompare(b[0]);
        return b[1].count - a[1].count;
      }),
      otherCount,
    };
  }, [routes]);

  const filteredRoutes = useMemo(() => {
    let list = routes;

    if (activeBrand) {
      if (activeBrand === '__other__') {
        list = list.filter((route) => !getBrand(route.modelPattern));
      } else {
        list = list.filter((route) => getBrand(route.modelPattern)?.name === activeBrand);
      }
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((route) => route.modelPattern.toLowerCase().includes(q));
    }

    return [...list].sort((a, b) => {
      if (sortBy === 'channelCount') {
        const countCmp = (a.channels?.length ?? 0) - (b.channels?.length ?? 0);
        if (countCmp !== 0) return sortDir === 'asc' ? countCmp : -countCmp;
      }

      const nameCmp = a.modelPattern.localeCompare(b.modelPattern, undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? nameCmp : -nameCmp;
    });
  }, [routes, activeBrand, search, sortBy, sortDir]);

  const getModelCandidates = (route: RouteRow): ModelCandidate[] | null => {
    if (!route?.modelPattern || !isExactModelPattern(route.modelPattern)) return null;
    const candidates = modelCandidates[route.modelPattern] || [];
    return candidates.length > 0 ? candidates : [];
  };

  const getAccountOptionsForRoute = (route: RouteRow) => {
    const candidates = getModelCandidates(route);
    if (candidates === null) return activeAccountOptions;

    const accountMap = new Map<number, string>();
    for (const candidate of candidates) {
      const label = `${candidate.username || `account-${candidate.accountId}`} @ ${candidate.siteName}`;
      accountMap.set(candidate.accountId, label);
    }

    return Array.from(accountMap.entries()).map(([id, label]) => ({ id, label }));
  };

  const getTokenOptionsForRouteAccount = (route: RouteRow, accountId: number) => {
    if (!accountId) return [] as Array<{ id: number; name: string; isDefault: boolean }>;

    const candidates = getModelCandidates(route);
    if (candidates !== null) {
      return candidates
        .filter((candidate) => candidate.accountId === accountId)
        .map((candidate) => ({
          id: candidate.tokenId,
          name: candidate.tokenName,
          isDefault: candidate.isDefault,
        }))
        .sort((a, b) => {
          if (a.isDefault === b.isDefault) return a.id - b.id;
          return a.isDefault ? -1 : 1;
        });
    }

    return (tokensByAccount[accountId] || []).map((token) => ({
      id: token.id,
      name: token.name,
      isDefault: !!token.isDefault,
    }));
  };

  const handleRouteAccountChange = (route: RouteRow, accountId: number) => {
    const tokenOptions = getTokenOptionsForRouteAccount(route, accountId);
    const defaultTokenId = tokenOptions.find((token) => token.isDefault)?.id || tokenOptions[0]?.id || 0;
    setChannelDraftByRoute((prev) => ({
      ...prev,
      [route.id]: {
        accountId,
        tokenId: defaultTokenId,
      },
    }));
  };

  const handleRouteTokenChange = (routeId: number, tokenId: number) => {
    setChannelDraftByRoute((prev) => ({
      ...prev,
      [routeId]: {
        accountId: prev[routeId]?.accountId || 0,
        tokenId,
      },
    }));
  };

  const handleAddChannel = async (route: RouteRow) => {
    const draft = channelDraftByRoute[route.id];
    if (!draft?.accountId) return;

    const tokenOptions = getTokenOptionsForRouteAccount(route, draft.accountId);
    if (draft.tokenId && tokenOptions.length > 0 && !tokenOptions.some((token) => token.id === draft.tokenId)) {
      toast.error('该令牌不支持当前模型');
      return;
    }

    try {
      await api.addChannel(route.id, {
        accountId: draft.accountId,
        tokenId: draft.tokenId || undefined,
      });
      toast.success('通道已添加');
      setChannelDraftByRoute((prev) => ({
        ...prev,
        [route.id]: {
          accountId: 0,
          tokenId: 0,
        },
      }));
      await load();
    } catch (e: any) {
      toast.error(e.message || '添加通道失败');
    }
  };

  const handleDeleteChannel = async (channelId: number) => {
    try {
      await api.deleteChannel(channelId);
      toast.success('通道已移除');
      await load();
    } catch (e: any) {
      toast.error(e.message || '移除通道失败');
    }
  };

  const handleChannelTokenSave = async (route: RouteRow, channelId: number, accountId: number) => {
    const tokenId = channelTokenDraft[channelId];
    const tokenOptions = getTokenOptionsForRouteAccount(route, accountId);

    if (tokenId && tokenOptions.length > 0 && !tokenOptions.some((token) => token.id === tokenId)) {
      toast.error('该令牌不支持当前模型');
      return;
    }

    setUpdatingChannel((prev) => ({ ...prev, [channelId]: true }));
    try {
      await api.updateChannel(channelId, { tokenId: tokenId || null });
      toast.success('通道令牌已更新');
      await load();
    } catch (e: any) {
      toast.error(e.message || '更新令牌失败');
    } finally {
      setUpdatingChannel((prev) => ({ ...prev, [channelId]: false }));
    }
  };

  const handleChannelDragEnd = async (route: RouteRow, event: DragEndEvent) => {
    if (savingPriorityByRoute[route.id]) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const channels = route.channels || [];
    const oldIndex = channels.findIndex((channel) => channel.id === Number(active.id));
    const newIndex = channels.findIndex((channel) => channel.id === Number(over.id));

    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

    const previousChannels = [...channels];
    const reordered = arrayMove(channels, oldIndex, newIndex).map((channel: RouteChannel, index: number) => ({
      ...channel,
      priority: index,
    }));

    setRoutes((prev) =>
      prev.map((item) => (item.id === route.id ? { ...item, channels: reordered } : item)),
    );
    setSavingPriorityByRoute((prev) => ({ ...prev, [route.id]: true }));

    try {
      await api.batchUpdateChannels(
        reordered.map((channel: RouteChannel) => ({
          id: channel.id,
          priority: channel.priority,
        })),
      );

      if (isExactModelPattern(route.modelPattern)) {
        try {
          const res = await api.getRouteDecision(route.modelPattern);
          setDecisionByRoute((prev) => ({
            ...prev,
            [route.id]: (res?.decision || null) as RouteDecision | null,
          }));
        } catch {
          // ignore route decision refresh failures after reorder
        }
      }
    } catch (e: any) {
      setRoutes((prev) =>
        prev.map((item) => (item.id === route.id ? { ...item, channels: previousChannels } : item)),
      );
      toast.error(e.message || '保存通道优先级失败，已回滚');
    } finally {
      setSavingPriorityByRoute((prev) => ({ ...prev, [route.id]: false }));
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', gap: 24, minHeight: 400 }}>
      {!filterCollapsed && (
        <div className="filter-panel">
          <div className="filter-panel-section">
            <div className="filter-panel-title">
              品牌
              {activeBrand && <button onClick={() => setActiveBrand(null)}>重置</button>}
            </div>

            <div className={`filter-item ${!activeBrand ? 'active' : ''}`} onClick={() => setActiveBrand(null)}>
              <span
                className="filter-item-icon"
                style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}
              >
                ✦
              </span>
              全部品牌
              <span className="filter-item-count">{routes.length}</span>
            </div>

            {brandList.list.map(([brandName, { count, brand }]) => (
              <div
                key={brandName}
                className={`filter-item ${activeBrand === brandName ? 'active' : ''}`}
                onClick={() => setActiveBrand(activeBrand === brandName ? null : brandName)}
              >
                <span className="filter-item-icon" style={{ background: 'var(--color-bg)', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={`${cdn}/${brand.icon.replace(/\./g, '-')}.png`}
                    alt={brandName}
                    style={{ width: 14, height: 14, objectFit: 'contain' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    loading="lazy"
                  />
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brandName}</span>
                <span className="filter-item-count">{count}</span>
              </div>
            ))}

            {brandList.otherCount > 0 && (
              <div
                className={`filter-item ${activeBrand === '__other__' ? 'active' : ''}`}
                onClick={() => setActiveBrand(activeBrand === '__other__' ? null : '__other__')}
              >
                <span
                  className="filter-item-icon"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)', fontSize: 10 }}
                >
                  ?
                </span>
                其他
                <span className="filter-item-count">{brandList.otherCount}</span>
              </div>
            )}
          </div>

          <button
            className="btn btn-ghost"
            style={{
              width: '100%',
              fontSize: 12,
              padding: '6px 10px',
              marginTop: 8,
              justifyContent: 'center',
              border: '1px solid var(--color-border)',
            }}
            onClick={() => setFilterCollapsed(true)}
          >
            {tr('收起')}
          </button>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {activeBrand && activeBrand !== '__other__' ? `${activeBrand} ${tr('路由')}` : tr('模型路由')}
              <span className="badge badge-info" style={{ fontSize: 12, fontWeight: 500 }}>
                {tr('共')} {filteredRoutes.length} {tr('条路由')}
              </span>
            </h2>
            {activeBrand && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
                {activeBrand === '__other__' ? tr('查看未归类品牌路由') : `${tr('查看')} ${activeBrand} ${tr('品牌路由')}`}
              </p>
            )}
          </div>

          <div className="page-actions" style={{ flexWrap: 'wrap' }}>
            {filterCollapsed && (
              <button
                className="btn btn-ghost"
                style={{ border: '1px solid var(--color-border)', padding: '8px 14px' }}
                onClick={() => setFilterCollapsed(false)}
              >
                {tr('筛选')}
              </button>
            )}

            <button
              onClick={handleRefreshRouteDecisions}
              disabled={loadingDecision}
              className="btn btn-ghost"
              style={{ border: '1px solid var(--color-border)', padding: '8px 14px' }}
            >
              {loadingDecision ? (
                <>
                  <span className="spinner spinner-sm" /> 刷新中...
                </>
              ) : (
                tr('刷新选中概率')
              )}
            </button>

            <button
              onClick={handleRebuild}
              disabled={rebuilding}
              className="btn btn-ghost"
              style={{ border: '1px solid var(--color-border)', padding: '8px 14px' }}
            >
              {rebuilding ? (
                <>
                  <span className="spinner spinner-sm" /> 重建中...
                </>
              ) : (
                tr('自动重建')
              )}
            </button>

            <button
              onClick={() => setShowManual((v) => !v)}
              className="btn btn-ghost"
              style={{ border: '1px solid var(--color-border)', padding: '8px 14px' }}
            >
              {showManual ? tr('隐藏手动模式') : tr('手动增改路由')}
            </button>
          </div>
        </div>

        <div className="toolbar">
          <div className="toolbar-search" style={{ minWidth: 280 }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr('搜索模型路由...')}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ minWidth: 128 }}>
              <ModernSelect
                size="sm"
                value={sortBy}
                onChange={(nextValue) => {
                  const nextSortBy = nextValue as RouteSortBy;
                  setSortBy(nextSortBy);
                  setSortDir(nextSortBy === 'modelPattern' ? 'asc' : 'desc');
                }}
                options={[
                  { value: 'modelPattern', label: tr('模型名称') },
                  { value: 'channelCount', label: tr('通道数量') },
                ]}
                placeholder={tr('排序字段')}
              />
            </div>
            <button
              className="btn btn-ghost"
              style={{ border: '1px solid var(--color-border)', padding: '8px 12px', fontSize: 12 }}
              onClick={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              title={tr('切换排序方向')}
            >
              {sortDir === 'asc' ? tr('升序 ↑') : tr('降序 ↓')}
            </button>
          </div>
        </div>

        <div className="info-tip" style={{ marginBottom: 12 }}>
          {tr('系统会根据模型可用性自动生成路由。精确模型路由会自动过滤只支持该模型的账号和令牌。优先级 P0 最高，数字越大优先级越低。选中概率表示请求到达时该通道被选中的概率。成本来源优先级为：实测成本 → 账号配置成本 → 目录参考价 → 默认回退单价。')}
          {decisionAutoSkipped ? ` ${tr('当前精确路由')} ${exactRouteCount} ${tr('条，为避免首屏卡顿，默认不自动计算概率，点击“加载选择解释”后按需获取。')}` : ''}
        </div>

        {showManual && (
          <div className="card animate-scale-in" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
              {tr('手动模式适合高级场景；自动路由仍会保持开启。')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                placeholder={tr('模型匹配（如 gpt-4o、claude-*）')}
                value={form.modelPattern}
                onChange={(e) => setForm((f) => ({ ...f, modelPattern: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  outline: 'none',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <input
                placeholder="模型映射 JSON（可选）"
                value={form.modelMapping}
                onChange={(e) => setForm((f) => ({ ...f, modelMapping: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  outline: 'none',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <button
                onClick={handleAddRoute}
                disabled={saving || !form.modelPattern.trim()}
                className="btn btn-success"
                style={{ alignSelf: 'flex-start' }}
              >
                {saving ? (
                  <>
                    <span
                      className="spinner spinner-sm"
                      style={{ borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }}
                    />{' '}
                    保存中...
                  </>
                ) : (
                  '保存路由'
                )}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredRoutes.map((route, i) => {
            const accountOptions = getAccountOptionsForRoute(route);
            const selectedAccountId = channelDraftByRoute[route.id]?.accountId || 0;
            const draftTokenOptions = getTokenOptionsForRouteAccount(route, selectedAccountId);
            const candidateMode = getModelCandidates(route) !== null;
            const routeDecision = decisionByRoute[route.id] || null;
            const decisionMap = new Map<number, RouteDecisionCandidate>(
              (routeDecision?.candidates || []).map((candidate) => [candidate.channelId, candidate]),
            );
            const exactRoute = isExactModelPattern(route.modelPattern);

            return (
              <div
                key={route.id}
                className={`card animate-slide-up stagger-${Math.min(i + 1, 5)}`}
                style={{ padding: 16 }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <code
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        background: 'var(--color-bg)',
                        padding: '4px 10px',
                        borderRadius: 6,
                        color: 'var(--color-text-primary)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <InlineBrandIcon model={route.modelPattern} size={20} />
                      {route.modelPattern}
                    </code>
                    <span className={`badge ${route.enabled ? 'badge-success' : 'badge-muted'}`} style={{ fontSize: 11 }}>
                      {route.enabled ? tr('启用') : tr('禁用')}
                    </span>
                    <span className="badge badge-info" style={{ fontSize: 10 }}>
                      {route.channels?.length || 0} {tr('通道')}
                    </span>
                    {candidateMode && (
                      <span className="badge badge-info" style={{ fontSize: 10 }}>
                        {tr('按模型过滤')}
                      </span>
                    )}
                    {savingPriorityByRoute[route.id] ? (
                      <span className="badge badge-warning" style={{ fontSize: 10 }}>
                        {tr('排序保存中')}
                      </span>
                    ) : null}
                  </div>

                  <button
                    onClick={() => handleDeleteRoute(route.id)}
                    className="btn btn-link btn-link-danger"
                  >
                    {tr('删除路由')}
                  </button>
                </div>

                {!exactRoute && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                    {tr('通配符路由按请求实时决策；概率解释仅在精确模型路由中展示。')}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 10 }}>
                  <ModernSelect
                    size="sm"
                    value={String(selectedAccountId || 0)}
                    onChange={(nextValue) => handleRouteAccountChange(route, Number.parseInt(nextValue, 10) || 0)}
                    options={[
                      { value: '0', label: tr('选择账号') },
                      ...accountOptions.map((option) => ({
                        value: String(option.id),
                        label: option.label,
                      })),
                    ]}
                    placeholder={tr('选择账号')}
                  />

                  <ModernSelect
                    size="sm"
                    value={String(channelDraftByRoute[route.id]?.tokenId || 0)}
                    onChange={(nextValue) => handleRouteTokenChange(route.id, Number.parseInt(nextValue, 10) || 0)}
                    disabled={!selectedAccountId}
                    options={[
                      { value: '0', label: '选择令牌（可选）' },
                      ...draftTokenOptions.map((token) => ({
                        value: String(token.id),
                        label: `${token.name}${token.isDefault ? '（默认）' : ''}`,
                      })),
                    ]}
                    placeholder="选择令牌（可选）"
                  />

                  <button
                    onClick={() => handleAddChannel(route)}
                    className="btn btn-ghost"
                    style={{
                      fontSize: 12,
                      padding: '6px 10px',
                      color: 'var(--color-primary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    + 添加通道
                  </button>
                </div>

                {candidateMode && accountOptions.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--color-warning)', marginBottom: 8 }}>
                    当前没有任何账号/令牌可用此模型，请先同步令牌与模型。
                  </div>
                )}

                {route.channels?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(event: DragEndEvent) => {
                        void handleChannelDragEnd(route, event);
                      }}
                    >
                      <SortableContext
                        items={(route.channels || []).map((channel) => channel.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {(route.channels || []).map((channel) => {
                          const tokenOptions = getTokenOptionsForRouteAccount(route, channel.accountId);
                          const activeTokenId = channelTokenDraft[channel.id] ?? channel.tokenId ?? 0;

                          return (
                            <SortableChannelRow
                              key={channel.id}
                              channel={channel}
                              decisionCandidate={decisionMap.get(channel.id)}
                              isExactRoute={exactRoute}
                              loadingDecision={loadingDecision}
                              isSavingPriority={!!savingPriorityByRoute[route.id]}
                              tokenOptions={tokenOptions}
                              activeTokenId={activeTokenId}
                              isUpdatingToken={!!updatingChannel[channel.id]}
                              onTokenDraftChange={(channelId, tokenId) =>
                                setChannelTokenDraft((prev) => ({ ...prev, [channelId]: tokenId }))
                              }
                              onSaveToken={() => handleChannelTokenSave(route, channel.id, channel.accountId)}
                              onDeleteChannel={() => handleDeleteChannel(channel.id)}
                            />
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', paddingLeft: 4 }}>暂无通道</div>
                )}
              </div>
            );
          })}

          {filteredRoutes.length === 0 && (
            <div className="card">
              <div className="empty-state">
                <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                  />
                </svg>
                <div className="empty-state-title">{routes.length === 0 ? '暂无路由' : '没有匹配的路由'}</div>
                <div className="empty-state-desc">
                  {routes.length === 0
                    ? '点击“自动重建”可按当前模型可用性生成路由。'
                    : '请调整品牌筛选、搜索词或排序条件。'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
