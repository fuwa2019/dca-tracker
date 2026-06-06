# 本地版 + 前端 UI 升级 — 交接给 Codex（部署用）

> 这份文档给 Codex：说明这次改了什么、改在哪些文件、本地版怎么跑/怎么部署，
> 以及云端正式版**不受影响**。代码已经由 Claude 改完并自测通过（typecheck /
> `test:finance` / `npm run build` / `npm run build:local` 全绿）。Codex 只需按
> 下面「部署」一节执行即可，不需要重写逻辑。

---

## 1. 这次做了两件事

1. **本地版（离线版）**：用环境变量 `VITE_LOCAL_MODE=1` 构建。这个版本
   - **不需要邮箱/验证码登录**（自动注入一个本地用户，直接进总览）；
   - **完全不连 Supabase、不连 Quote Worker**；
   - 直接展示**内置的 10 年 QQQ 每月定投模拟数据**（数据已打包进 `src/data/local-dataset.json`，
     由 Yahoo Finance 下载的 QQQ / SPY 复权收盘价生成）。
   - 业绩曲线、XIRR、持仓、$1M 进度等全部用前端纯函数 `buildEquityHistory`
     （`src/lib/calc/history.ts`）本地算出来，和云端口径一致。
2. **前端 UI 视觉大改版 —— 「编辑杂志 × 数据终端」风**（电脑 + 手机、深 / 浅色均已截图验证）：
   - 字体：杂志衬线 **Fraunces**（大标题 / hero 大数字）+ 等宽 **JetBrains Mono**（金额，`.font-num`）+ **Hanken Grotesk**（正文 UI）；
   - 配色：浅色「暖纸」、深色「深墨」，统一**胭脂红**强调色（`--brand`）贯穿全站；
   - 版式：刊头式栏目标题（序号 + 英文 kicker + 中文，组件 `Kicker`）、细分隔线、考究留白；
   - 总览页重做为「杂志头版」：超大衬线 NAV、`01/02/03` 栏目、入场分层揭幕 + 数字 count-up + 曲线绘制等惊艳动效；
   - 该风格已推广到全部页面（总览 / 业绩 / 交易 / 资金 / 数据健康 / 设置 / 登录）；
   - 本地版左上角 / 移动端顶部仍显示「本地预览」徽标。

> 设计开关只有一个：`VITE_LOCAL_MODE`。不设或设为 `0` → 行为和原来云端版**完全一样**。

---

## 2. 新增文件

| 文件 | 作用 |
| --- | --- |
| `src/lib/localMode.ts` | `LOCAL_MODE` 开关（读 `VITE_LOCAL_MODE`）+ 合成本地用户 `LOCAL_USER` |
| `src/lib/localData.ts` | 从数据集生成本地的 交易/入金/设置/价格Map/行情/业绩曲线/缓存状态 |
| `src/data/local-dataset.json` | 打包进 bundle 的 10 年 QQQ + SPY 复权收盘价（约 120KB，gzip ~40KB） |
| `scripts/build-local-dataset.mjs` | 重新下载并生成上面这个 JSON（`npm run build:dataset`） |
| `src/components/Kicker.tsx` | 全站通用刊头式栏目标题（序号 + 英文 kicker + 中文） |
| `src/app/dashboard/model.ts` | 总览共享数据 hook `useDashboardModel`（计算与展示分离） |
| `src/app/dashboard/shared.tsx` | 总览共享件：空状态 / 快捷操作 / 业绩曲线（带绘制动画）/ 重导出 Kicker |
| `src/app/dashboard/VariantA.tsx` | 总览「杂志头版」呈现层 |
| `.claude/launch.json` | 仅本地预览用的 dev server 配置（部署可忽略） |
| `CODEX_DEPLOY.md` | 本文档 |

## 3. 修改的文件

**本地版数据接入（都用 `if (LOCAL_MODE) return ...` 短路，不影响云端路径）：**
- `src/hooks/useAuth.ts` — 本地版直接给 `LOCAL_USER`，`loading=false`，跳过 Supabase 会话
- `src/hooks/usePortfolio.ts` — `useTransactions/useCashflows/useSettings/usePortfolioHistory` 本地返回内置数据
- `src/hooks/usePerformanceCache.ts` — `usePerformanceCacheStatus` / refresh 本地返回合成状态
- `src/hooks/useQuotes.ts` — 本地返回内置“最新收盘价”
- `src/hooks/useDailyPrices.ts` — 本地返回内置价格 Map
- `src/lib/trackedSymbols.ts` — 本地版 `registerTrackedSymbols` 直接 no-op（不写库）
- `src/App.tsx` — 本地版 `/login` 重定向到 `/`

**视觉大改版（编辑杂志 × 终端）：**
- `index.html` — 引入 Fraunces（衬线）+ Hanken Grotesk + JetBrains Mono
- `tailwind.config.ts` — `font-serif`(Fraunces) / `font-display` / `font-num`；新增 `accent-rose` / `accent-amber`
- `src/index.css` — 纸×墨配色 + 胭脂强调（`--brand`）、氛围光晕，新增 `.font-serif-fig` / `.kicker` / `.rule-top` / `.surface-card` / `.bg-grid` / `.animate-sheen` 工具类
- `src/components/ui/card.tsx`、`StatCard.tsx` — `.surface-card` + `.font-num`
- `src/components/AppShell.tsx` — 刊头式侧栏、胭脂渐变 Logo、kicker 分组、「本地预览」徽标
- `src/components/AnimatedNumber.tsx` — 复用做 NAV / 指标 count-up（文件未改）
- `src/app/dashboard.tsx` — 薄壳，渲染 `DashboardVariantA`（总览逻辑搬到 `dashboard/model.ts`）
- `src/app/{performance,transactions,transactions-all,cashflows,settings,data-health,login}.tsx` — 加 `Kicker` 栏目头、关键标题衬线化、胭脂强调统一

**配置：**
- `.env.example` — 新增 `VITE_LOCAL_MODE` 说明
- `package.json` — 新增脚本 `dev:local` / `build:local` / `build:dataset`

---

## 4. 新增的 npm 脚本

```bash
npm run dev:local       # 本地版开发预览（VITE_LOCAL_MODE=1 vite）
npm run build:local     # 构建本地版（产物在 dist/，纯静态，无需任何 env / 后端）
npm run build:dataset   # 重新下载 QQQ/SPY 价格，刷新 src/data/local-dataset.json
npm run build           # 云端正式版（不变，仍需 VITE_SUPABASE_* / VITE_QUOTE_WORKER_URL）
```

---

## 5. 部署（Codex 执行）

这是一个 Cloudflare Pages 上的纯前端 SPA（见 `CLAUDE.md` 架构图）。两种产物都是
`dist/`，部署方式和现在的 Pages 流程一致。

### A. 本地版（离线、免登录）
本地版**不需要任何环境变量、不需要后端**，构建即用：

```bash
npm ci
npm run build:local
# 产物 dist/ 是完全自包含的静态站点
```

部署任选其一：
- **Cloudflare Pages（建议单独建一个 Pages 项目 / 单独分支）**：把 `dist/` 发上去即可，
  构建命令填 `npm run build:local`，输出目录 `dist`，**无需配置任何环境变量**。
- **本机直接看**：`npm run build:local && npm run preview`，浏览器打开提示的地址。
- 注意 `public/_redirects`（`/* /index.html 200`）已存在，SPA 深链可用，别删。

> 本地版只读：用于演示 / 离线查看 10 年 QQQ 定投效果，录入类表单（交易/入金/设置保存）
> 在本地版下不会写入任何后端（目前是已知限制，演示场景无需）。

### B. 云端正式版（不变）
照旧，仍走原来的 Pages 流程和环境变量：

```bash
npm ci
npm run build      # 需要 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_QUOTE_WORKER_URL
```

Workers（quote / email-cron）这次**没有改动**，无需重新部署。

---

## 6. 验证（已自测通过，Codex 可复跑）

```bash
npm run typecheck      # 前端 + 两个 worker，全绿
npm run test:finance   # 业绩算法回归 fixtures，"performance fixtures ok"
npm run build          # 云端版构建成功（CI 同款）
npm run build:local    # 本地版构建成功
```

本地版人工验证点（`npm run dev:local` 后打开页面）：
- 不出现登录页，直接进「总览」，左上 / 顶部有「本地预览」徽标；
- 总览显示 NAV、XIRR、组合累计表现、业绩曲线（10 年 QQQ 上行曲线）、$1M 进度、持仓 QQQ；
- 电脑 / 手机两种宽度、深色 / 浅色两种主题都正常（已用预览工具截图确认）。

---

## 7. 维护小贴士
- 想刷新模拟数据（比如一年后）：`npm run build:dataset` 重新下载再提交 `src/data/local-dataset.json`。
- `VITE_LOCAL_MODE` 千万别在云端正式版里设成 1，否则正式站也会变离线 demo。
- 字体走 Google Fonts CDN（`index.html` 里的 `<link>`）；若要完全离线可改成自托管字体，但当前
  本地版离线时字体仅退化为系统字体，不影响功能。
