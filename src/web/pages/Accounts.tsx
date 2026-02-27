import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.js';
import ModernSelect from '../components/ModernSelect.js';
import { getAccountsAddPanelStyle } from './helpers/accountsPanelStyle.js';
import { tr } from '../i18n.js';

export default function Accounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<'token' | 'login'>('token');
  const [loginForm, setLoginForm] = useState({ siteId: 0, username: '', password: '' });
  const [tokenForm, setTokenForm] = useState({ siteId: 0, accessToken: '', platformUserId: '' });
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const toast = useToast();

  const load = () => {
    api.getAccounts().then(setAccounts).catch(() => toast.error('加载账号列表失败'));
    api.getSites().then(setSites);
  };
  useEffect(() => { load(); }, []);

  const handleLoginAdd = async () => {
    if (!loginForm.siteId || !loginForm.username || !loginForm.password) return;
    setSaving(true);
    try {
      const result = await api.loginAccount(loginForm);
      if (result.success) {
        setShowAdd(false);
        setLoginForm({ siteId: 0, username: '', password: '' });
        const msg = result.apiTokenFound
          ? `账号 "${loginForm.username}" 已添加，API Key 已自动获取`
          : `账号 "${loginForm.username}" 已添加（未找到 API Key，请手动设置）`;
        toast.success(msg);
        load();
      } else {
        toast.error(result.message || '登录失败');
      }
    } catch (e: any) {
      toast.error(e.message || '登录请求失败');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyToken = async () => {
    if (!tokenForm.siteId || !tokenForm.accessToken) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.verifyToken({
        siteId: tokenForm.siteId,
        accessToken: tokenForm.accessToken,
        platformUserId: tokenForm.platformUserId ? parseInt(tokenForm.platformUserId) : undefined,
      });
      setVerifyResult(result);
      if (result.success) {
        toast.success(`验证成功: ${result.userInfo?.username || '未知用户'}`);
      } else {
        toast.error(result.message || 'Token 无效');
      }
    } catch (e: any) {
      toast.error(e.message || '验证失败');
      setVerifyResult({ success: false, message: e.message });
    } finally {
      setVerifying(false);
    }
  };

  const handleTokenAdd = async () => {
    if (!tokenForm.siteId || !tokenForm.accessToken) return;
    setSaving(true);
    try {
      const result = await api.addAccount({
        siteId: tokenForm.siteId,
        accessToken: tokenForm.accessToken,
        platformUserId: tokenForm.platformUserId ? parseInt(tokenForm.platformUserId) : undefined,
      });
      setShowAdd(false);
      setTokenForm({ siteId: 0, accessToken: '', platformUserId: '' });
      setVerifyResult(null);
      if (result.tokenType === 'apikey') {
        toast.success('已添加为 API Key 账号（可用于代理转发）');
      } else {
        const parts: string[] = [];
        if (result.usernameDetected) parts.push('用户名已自动识别');
        if (result.apiTokenFound) parts.push('API Key 已自动获取');
        const extra = parts.length ? `（${parts.join('，')}）` : '';
        toast.success(`账号已添加${extra}`);
      }
      load();
    } catch (e: any) {
      toast.error(e.message || '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const withLoading = async (key: string, fn: () => Promise<any>, successMsg?: string) => {
    setActionLoading(s => ({ ...s, [key]: true }));
    try { await fn(); if (successMsg) toast.success(successMsg); load(); }
    catch (e: any) { toast.error(e.message || '操作失败'); }
    finally { setActionLoading(s => ({ ...s, [key]: false })); }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)', fontSize: 13, outline: 'none',
    background: 'var(--color-bg)', color: 'var(--color-text-primary)',
  };

  const runtimeHealthMap: Record<string, {
    label: string;
    cls: string;
    dotClass: string;
    pulse: boolean;
  }> = {
    healthy: { label: '健康', cls: 'badge-success', dotClass: 'status-dot-success', pulse: true },
    unhealthy: { label: '异常', cls: 'badge-error', dotClass: 'status-dot-error', pulse: true },
    degraded: { label: '降级', cls: 'badge-warning', dotClass: 'status-dot-pending', pulse: true },
    disabled: { label: '已禁用', cls: 'badge-muted', dotClass: 'status-dot-muted', pulse: false },
    unknown: { label: '未知', cls: 'badge-muted', dotClass: 'status-dot-pending', pulse: false },
  };

  const resolveRuntimeHealth = (account: any) => {
    const fallbackState = account.status === 'disabled' || account.site?.status === 'disabled'
      ? 'disabled'
      : (account.status === 'expired' ? 'unhealthy' : 'unknown');
    const state = account.runtimeHealth?.state || fallbackState;
    const cfg = runtimeHealthMap[state] || runtimeHealthMap.unknown;
    const reason = account.runtimeHealth?.reason
      || (state === 'disabled'
        ? '账号或站点已禁用'
        : (state === 'unhealthy' ? '最近健康检查失败' : '尚未获取运行健康信息'));
    return { state, reason, ...cfg };
  };

  const handleRefreshRuntimeHealth = async () => {
    setActionLoading((s) => ({ ...s, 'health-refresh': true }));
    try {
      const res = await api.refreshAccountHealth();
      if (res?.queued) {
        toast.info(res.message || '账号状态刷新任务已提交，完成后会自动更新。');
      } else {
        toast.success(res?.message || '账号状态已刷新');
      }
      load();
    } catch (e: any) {
      toast.error(e.message || '刷新账号状态失败');
    } finally {
      setActionLoading((s) => ({ ...s, 'health-refresh': false }));
    }
  };

  const handleToggleCheckin = async (account: any) => {
    const key = `checkin-toggle-${account.id}`;
    const nextEnabled = !account.checkinEnabled;
    setActionLoading((s) => ({ ...s, [key]: true }));
    try {
      await api.updateAccount(account.id, { checkinEnabled: nextEnabled });
      toast.success(nextEnabled ? '已开启签到' : '已关闭签到（全部签到会忽略此账号）');
      load();
    } catch (e: any) {
      toast.error(e.message || '切换签到状态失败');
    } finally {
      setActionLoading((s) => ({ ...s, [key]: false }));
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h2 className="page-title">{tr('账号管理')}</h2>
        <div className="page-actions">
          <button onClick={() => withLoading('checkin-all', () => api.triggerCheckinAll(), '已触发全部签到')} disabled={actionLoading['checkin-all']}
            className="btn btn-soft-primary">
            {actionLoading['checkin-all'] ? <><span className="spinner spinner-sm" />{tr('签到中...')}</> : tr('全部签到')}
          </button>
          <button
            onClick={handleRefreshRuntimeHealth}
            disabled={actionLoading['health-refresh']}
            className="btn btn-soft-primary"
          >
            {actionLoading['health-refresh'] ? <><span className="spinner spinner-sm" />{tr('刷新状态中...')}</> : tr('刷新账户状态')}
          </button>
          <button onClick={() => { setShowAdd(!showAdd); setAddMode('token'); setVerifyResult(null); }} className="btn btn-primary">
            {showAdd ? tr('取消') : tr('+ 添加账号')}
          </button>
        </div>
      </div>

      {/* Add Panel */}
      {showAdd && (
        <div className="card animate-scale-in" style={getAccountsAddPanelStyle()}>
          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 0, background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', padding: 3, marginBottom: 16 }}>
            <button onClick={() => { setAddMode('token'); setVerifyResult(null); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                background: addMode === 'token' ? 'var(--color-bg-card)' : 'transparent',
                color: addMode === 'token' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                boxShadow: addMode === 'token' ? 'var(--shadow-sm)' : 'none'
              }}>
              Cookie / Token 导入
            </button>
            <button onClick={() => { setAddMode('login'); setVerifyResult(null); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                background: addMode === 'login' ? 'var(--color-bg-card)' : 'transparent',
                color: addMode === 'login' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                boxShadow: addMode === 'login' ? 'var(--shadow-sm)' : 'none'
              }}>
              账号密码登录
            </button>
          </div>

          {addMode === 'token' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="info-tip">
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>支持两种 Token 类型，系统自动识别</div>
                  <div><strong>API Key</strong>（在站点「令牌」页面生成）→ 用于代理转发</div>
                  <div><strong>Session Token</strong>（从浏览器获取）→ 支持签到、余额查询等全部功能</div>
                  <div style={{ opacity: 0.7, borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: 6, marginTop: 6 }}>
                    获取 Session Token: <kbd style={{ padding: '1px 5px', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 3, fontSize: 11 }}>F12</kbd> → Application → Local Storage</div>
                </div>
              </div>
              <ModernSelect
                value={String(tokenForm.siteId || 0)}
                onChange={(nextValue) => {
                  const nextSiteId = Number.parseInt(nextValue, 10) || 0;
                  setTokenForm((f) => ({ ...f, siteId: nextSiteId }));
                  setVerifyResult(null);
                }}
                options={[
                  { value: '0', label: '选择站点' },
                  ...sites.map((s: any) => ({
                    value: String(s.id),
                    label: `${s.name} (${s.platform})`,
                  })),
                ]}
                placeholder="选择站点"
              />
              <textarea placeholder="粘贴 Session Token 或 API Key&#10;（系统会自动识别 Token 类型）"
                value={tokenForm.accessToken}
                onChange={e => { setTokenForm(f => ({ ...f, accessToken: e.target.value.trim() })); setVerifyResult(null); }}
                style={{ ...inputStyle, fontFamily: 'var(--font-mono)', height: 72, resize: 'none' as const }} />

              {/* Verify results */}
              {verifyResult && verifyResult.success && verifyResult.tokenType === 'session' && (
                <div className="alert alert-success animate-scale-in">
                  <div className="alert-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    会话令牌有效
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                    <div>用户名: <strong>{verifyResult.userInfo?.username || '未知'}</strong></div>
                    {verifyResult.balance && <div>余额: <strong>${(verifyResult.balance.balance || 0).toFixed(2)}</strong></div>}
                    <div>API Key: <span style={{ fontWeight: 500, color: verifyResult.apiToken ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                      {verifyResult.apiToken ? '已找到 (' + verifyResult.apiToken.substring(0, 8) + '...)' : '未找到'}
                    </span></div>
                  </div>
                </div>
              )}
              {verifyResult && verifyResult.success && verifyResult.tokenType === 'apikey' && (
                <div className="alert alert-info animate-scale-in">
                  <div className="alert-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                    识别为 API Key
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                    <div>可用模型: <strong>{verifyResult.modelCount} 个</strong></div>
                    {verifyResult.models && <div style={{ color: 'var(--color-text-muted)' }}>包含: {verifyResult.models.join(', ')}{verifyResult.modelCount > 10 ? ' ...' : ''}</div>}
                  </div>
                </div>
              )}
              {verifyResult && !verifyResult.success && verifyResult.needsUserId && (
                <div className="alert alert-warning animate-scale-in">
                  <div className="alert-title">
                    Token 已识别，但此站点需要提供用户 ID
                  </div>
                  <input placeholder="用户 ID（数字）" value={tokenForm.platformUserId}
                    onChange={e => setTokenForm(f => ({ ...f, platformUserId: e.target.value.replace(/\D/g, '') }))}
                    style={{ ...inputStyle, borderColor: 'color-mix(in srgb, var(--color-warning) 45%, transparent)' }} />
                </div>
              )}
              {verifyResult && !verifyResult.success && !verifyResult.needsUserId && (
                <div className="alert alert-error animate-scale-in">
                  <div className="alert-title">
                    {verifyResult.message || 'Token 无效或已过期'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>请检查 Token 是否正确</div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleVerifyToken} disabled={verifying || !tokenForm.siteId || !tokenForm.accessToken}
                  className="btn btn-ghost" style={{ border: '1px solid var(--color-border)', padding: '8px 14px' }}>
                  {verifying ? <><span className="spinner spinner-sm" />验证中...</> : '验证 Token'}
                </button>
                <button onClick={handleTokenAdd} disabled={saving || !tokenForm.siteId || !tokenForm.accessToken}
                  className="btn btn-success">
                  {saving ? <><span className="spinner spinner-sm" style={{ borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} />添加中...</> : '添加账号'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="info-tip">
                输入目标站点的账号密码，将自动登录并获取访问令牌和 API Key
              </div>
              <ModernSelect
                value={String(loginForm.siteId || 0)}
                onChange={(nextValue) => {
                  const nextSiteId = Number.parseInt(nextValue, 10) || 0;
                  setLoginForm((f) => ({ ...f, siteId: nextSiteId }));
                }}
                options={[
                  { value: '0', label: '选择站点' },
                  ...sites.map((s: any) => ({
                    value: String(s.id),
                    label: `${s.name} (${s.platform})`,
                  })),
                ]}
                placeholder="选择站点"
              />
              <input placeholder="用户名" value={loginForm.username} onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))} style={inputStyle} />
              <input type="password" placeholder="密码" value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleLoginAdd()} style={inputStyle} />
              <button onClick={handleLoginAdd} disabled={saving || !loginForm.siteId || !loginForm.username || !loginForm.password}
                className="btn btn-success" style={{ alignSelf: 'flex-start' }}>
                {saving ? <><span className="spinner spinner-sm" style={{ borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} />登录并添加...</> : '登录并添加'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Accounts Table */}
      <div className="card" style={{ overflowX: 'auto' }}>
        {accounts.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>站点</th>
                <th>运行健康状态</th>
                <th>余额</th>
                <th>已用</th>
                <th>签到</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a: any, i: number) => (
                <tr key={a.id} className={`animate-slide-up stagger-${Math.min(i + 1, 5)}`}>
                  <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{a.username || '未命名'}</td>
                  <td>
                    {a.site?.url ? (
                      <a
                        href={a.site.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="badge-link"
                      >
                        <span className="badge badge-muted" style={{ fontSize: 11 }}>
                          {a.site?.name || '-'}
                        </span>
                      </a>
                    ) : (
                      <span className="badge badge-muted" style={{ fontSize: 11 }}>
                        {a.site?.name || '-'}
                      </span>
                    )}
                  </td>
                  <td>
                    {(() => {
                      const health = resolveRuntimeHealth(a);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span className={`badge ${health.cls}`} style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, width: 'fit-content' }}>
                            <span className={`status-dot ${health.dotClass} ${health.pulse ? 'animate-pulse-dot' : ''}`} style={{ marginRight: 0 }} />
                            {health.label}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--color-text-muted)',
                              maxWidth: 200,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={health.reason}
                          >
                            {health.reason}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>${(a.balance || 0).toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: (a.todayReward || 0) > 0 ? 'var(--color-success)' : 'var(--color-text-muted)', fontWeight: 500 }}>
                      +{(a.todayReward || 0).toFixed(2)}
                    </div>
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                    <div>${(a.balanceUsed || 0).toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: (a.todaySpend || 0) > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)', fontWeight: 500 }}>
                      -{(a.todaySpend || 0).toFixed(2)}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`checkin-toggle-badge ${a.checkinEnabled ? 'is-on' : 'is-off'}`}
                      onClick={() => handleToggleCheckin(a)}
                      disabled={!!actionLoading[`checkin-toggle-${a.id}`]}
                      title={a.checkinEnabled ? '点击关闭签到，全部签到会忽略此账号' : '点击开启签到'}
                    >
                      {actionLoading[`checkin-toggle-${a.id}`]
                        ? <span className="spinner spinner-sm" />
                        : (a.checkinEnabled ? '开启' : '关闭')}
                    </button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                      <button onClick={() => withLoading(`refresh-${a.id}`, () => api.refreshBalance(a.id), '余额已刷新')} disabled={actionLoading[`refresh-${a.id}`]}
                        className="btn btn-link btn-link-primary">
                        {actionLoading[`refresh-${a.id}`] ? <span className="spinner spinner-sm" /> : '刷新'}
                      </button>
                      <button onClick={() => withLoading(`models-${a.id}`, () => api.checkModels(a.id), '模型已更新')} disabled={actionLoading[`models-${a.id}`]}
                        className="btn btn-link btn-link-info">
                        {actionLoading[`models-${a.id}`] ? <span className="spinner spinner-sm" /> : '模型'}
                      </button>
                      <button onClick={() => withLoading(`checkin-${a.id}`, () => api.triggerCheckin(a.id), '签到完成')} disabled={actionLoading[`checkin-${a.id}`]}
                        className="btn btn-link btn-link-warning">
                        {actionLoading[`checkin-${a.id}`] ? <span className="spinner spinner-sm" /> : '签到'}
                      </button>
                      <button onClick={() => withLoading(`delete-${a.id}`, () => api.deleteAccount(a.id), '已删除')} disabled={actionLoading[`delete-${a.id}`]}
                        className="btn btn-link btn-link-danger">
                        {actionLoading[`delete-${a.id}`] ? <span className="spinner spinner-sm" /> : '删除'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <div className="empty-state-title">暂无账号</div>
            <div className="empty-state-desc">请先添加站点，然后添加账号</div>
          </div>
        )}
      </div>
    </div>
  );
}
