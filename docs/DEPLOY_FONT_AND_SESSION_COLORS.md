# 部署说明：字体统一 + 市场状态配色对齐 TradingView

本次改动是**纯前端**（React SPA），不涉及 Supabase 迁移、RPC、Worker 或环境变量。
只需要重新构建并发布到 Cloudflare Pages。

## 改了什么

### 1. 字体统一（各端一致 + 更美观）
原先中文只靠系统 `PingFang SC` 兜底，非苹果设备（Windows/Android）会掉到系统默认字体（宋体/雅黑），各端观感不一致。现引入网络中文字体 **Noto Sans SC（思源黑体）**，所有设备渲染同一套中文字形；拉丁字母仍用 Hanken Grotesk，数字仍用 JetBrains Mono。

- `index.html` — Google Fonts 链接追加 `Noto+Sans+SC:wght@400;500;700`。
- `tailwind.config.ts` — `fontFamily.sans` 和 `fontFamily.display` 在系统字体之后、`PingFang SC` 之前插入 `"Noto Sans SC"`（拉丁字符走 Hanken，中文落到 Noto）。

### 2. 市场状态配色（对齐 TradingView）
| 状态 | 含义 | 颜色 |
|------|------|------|
| 休市 closed | 周末/节假日/非交易时段 | 灰色（neutral，未改） |
| 盘前 pre_market / 盘后 after_hours | 04:00–09:30 / 16:00–20:00 ET | 黄橙色（warn） |
| 盘中 regular | 09:30–16:00 ET | 绿色（ok，未改） |
| 夜盘 overnight | 20:00–04:00 ET | 深蓝色（新增 night tone） |

- `src/index.css` — 新增 `--night` 色值（light: `222 68% 46%`，dark: `218 80% 68%`）和 `.bg-night-soft` 工具类。
- `tailwind.config.ts` — `colors` 新增 `night: 'hsl(var(--night))'`（提供 `text-night` / `bg-night`）。
- `src/components/StatusBadge.tsx` — `StatusTone` 增加 `'night'`，映射到 `bg-night-soft`。
- `src/components/MarketStatusBar.tsx` — `sessionTone`：`pre_market` 改为 `warn`、`overnight` 改为 `night`。
- `src/app/data-health.tsx` — 两处 `Record<StatusTone, string>`（`toneClass` / `iconBg`）补上 `night` 键以满足类型。

> 备注：`HoldingsList.tsx` 里每行报价的盘前盘后小标签是独立指示器，本次未动，保持范围最小。

## 验证（已在本地通过）

```bash
npm run typecheck   # 前端 + 两个 Worker，全绿
npm run build       # tsc -b && vite build，成功
```

预览页实测：`--night` 解析为深蓝色、`.bg-night-soft` 徽章正常、`fontFamily.sans` 已含 Noto Sans SC、思源黑体 3 个字重均从 Google Fonts 加载成功。

## 部署步骤

```bash
# 在仓库根目录
npm ci            # 如果依赖未安装
npm run build     # 产物在 dist/
```

然后发布 `dist/` 到 Cloudflare Pages（按现有 Pages 流程：推送到部署分支触发自动构建，或 `wrangler pages deploy dist`）。

**无需**：Supabase 迁移、Worker 重新部署、环境变量/CORS 改动。

## 注意

- Noto Sans SC 经 Google Fonts 自动子集化按需加载（`display=swap`），首屏中文先用系统字体兜底再无闪烁切换，不阻塞渲染。
- 若 Pages 有 CSP 限制，确认允许 `fonts.googleapis.com` 与 `fonts.gstatic.com`（本次链接来源与原有字体一致，通常无需调整）。
