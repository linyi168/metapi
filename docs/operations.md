# 🔧 运维手册

[返回文档中心](./README.md)

---

## 数据备份

### 方式一：目录备份（推荐）

Metapi 的所有数据存储在 `data/` 目录下的 SQLite 数据库中。最简单的备份方式：

```bash
# 手动备份
cp -r data/ data-backup-$(date +%Y%m%d)/

# 自动备份（crontab）
0 2 * * * cp -r /path/to/metapi/data/ /path/to/backups/metapi-$(date +\%Y\%m\%d)/
```

建议：
- 每日自动备份一次
- 保留最近 7~30 天
- 备份文件不要提交到 Git

### 方式二：应用内导出

在管理后台 → 「导入/导出」页面：

- **全量导出**：站点、账号、Token、路由、设置
- **仅账号**：站点和账号信息
- **仅偏好**：设置和通知配置

导出为 JSON 文件，可用于跨实例迁移。

## 数据恢复

### 目录恢复

```bash
# 1. 停止容器
docker compose down

# 2. 替换数据目录
rm -rf data/
cp -r data-backup-20260228/ data/

# 3. 重新启动
docker compose up -d
```

### 应用内导入

在管理后台 → 「导入/导出」页面上传之前导出的 JSON 文件。系统会自动校验数据完整性。

## 日志排查

### Docker 环境

```bash
# 查看实时日志
docker compose logs -f

# 查看最近 100 行
docker compose logs --tail 100

# 只看错误
docker compose logs -f 2>&1 | grep -i error
```

### 本地开发

```bash
npm run dev
# 日志直接输出到终端
```

### 重点关注的日志

| 关键词 | 含义 | 处理方式 |
|--------|------|----------|
| `auth failed` | 上游站点鉴权失败 | 检查账号凭证是否过期 |
| `no available channel` | 路由无可用通道 | 检查 Token 是否同步、通道是否被冷却 |
| `notify failed` | 通知发送失败 | 检查通知渠道配置 |
| `checkin failed` | 签到失败 | 检查账号状态和站点连通性 |
| `balance refresh failed` | 余额刷新失败 | 检查账号凭证 |

## 健康检查

### 手动检查

```bash
# 检查服务是否响应
curl -sS http://localhost:4000/v1/models \
  -H "Authorization: Bearer <PROXY_TOKEN>" | head -5

# 检查特定模型可用性
curl -sS http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer <PROXY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}'
```

### 自动化监控建议

- 定时请求 `/v1/models`，检查返回状态码和模型数量
- 定时抽样请求 `/v1/chat/completions`，检查端到端可用性
- 监控磁盘空间（SQLite WAL 日志可能增长）
- 监控 Docker 容器状态

## 常见运维操作

### 清理代理日志

代理日志会持续增长。如果磁盘空间紧张，可在管理后台 → 代理日志页面清理历史记录。

### 重置账号状态

如果账号状态异常（`unhealthy`），可以在账号管理页面：

1. 点击「刷新」重新检测账号健康状态
2. 如凭证过期，系统会尝试自动重登录
3. 手动禁用/启用账号

### 强制刷新模型

在管理后台手动触发：

- 余额刷新：立即更新所有账号余额
- 模型刷新：重新发现所有上游模型
- 签到：立即执行一次签到

## 发布前检查清单

如果你在本地开发并准备发布：

- [ ] `npm test` 通过
- [ ] `npm run build` 通过
- [ ] `.env`、`data/`、`tmp/` 未提交到 Git
- [ ] 敏感凭证已从代码中移除

## 下一步

- [常见问题](./faq.md) — 常见报错与修复
- [配置说明](./configuration.md) — 环境变量详解
