# DCA Tracker 前端 UI 与数据链路优化计划

## Summary
目标是在现有代码上安全改造：先验证前端、Worker、Supabase RPC/表结构的对接，再统一成 moomoo 启发的高密度交易型 UI。收益展示只保留 `XIRR` 作为年化主指标；主题默认跟随系统，并允许手动切换浅色/深色；行情扩展到盘前、盘中、盘后、夜盘 best-effort；基准从固定 `SPY` 改成可搜索、可添加、可删除、可选择。

UI 参考只提炼交互模式，不复制品牌和素材。参考来源包括 [moomoo Google Play 截图](https://play.google.com/store/apps/details?id=com.moomoo.trade)、[moomoo Watchlist 文档](https://www.moomoo.com/us/learn/detail-what-is-the-watchlist-tab-113312-230879056)、[moomoo 社区用户分享](https://www.moomoo.com/community/feed/review-comparison-of-moomoo-nx-a-significant-upgrade-113018243842054) 和 Reddit 用户讨论。

## Key Changes
- 前后端/数据库对接先做基线检查：确认 Supabase 表、RPC、Worker `/api/quote`、`/api/chart`、`/api/history`、前端 hooks 的字段完全一致；迁移只做新增和兼容，不重写已有迁移。
- 主题系统改为三态：`system | light | dark`。默认 `system`，用系统 `prefers-color-scheme` 决定实际 `data-theme`，并加首屏初始化脚本避免闪烁。
- UI 改造范围：`AppShell`、总览、业绩、设置、数据健康、交易表单。采用更紧凑的行情状态条、资产/XIRR 主卡、持仓/观察列表行、快捷操作、分段控件和移动端底部导航。
- 特别处理 iOS 输入框问题：所有日期框、金额框、数字框、搜索框统一高度、字号、圆角和 `appearance`，避免之前 iOS 上日期框和其他输入框尺寸不一致的回归。
- 年化收益：首页和业绩页只突出 `XIRR`。现有缓存曲线继续用于历史走势和基准对照，但 UI 不再强调 `TWR` 术语和复杂解释。
- 基准管理：在 settings 增加 `benchmarks` 和当前选择基准；默认 `SPY`。设置页支持搜索、添加、删除、选择基准；数据健康页把持仓、watchlist、benchmarks 一起纳入覆盖检查。
- Supabase RPC 改为 benchmark-aware：`performance_history`、`refresh_performance_history_cache`、`performance_cache_status` 支持选定基准；分享页默认只展示账户 owner 当前选择的基准，避免公开页复杂化和缓存膨胀。
- 行情 Worker 扩展 Yahoo 免费字段：读取 `preMarketPrice`、`postMarketPrice`、`marketState` 等；`/api/chart` 的日内图允许 `includePrePost=true`；夜盘如果 Yahoo 没有字段则明确降级显示最近可用价格。
- 免费方案约束：不加付费数据源，不加高频 cron；Worker quote 缓存降到适合前台使用的较短 TTL，历史和回测数据仍保持较长缓存；批量搜索和回填限制数量。

## Verification Plan
- 本地基线：先跑 `npm run test:finance`，安装依赖后跑 `npm run typecheck` 和 `npm run build`。
- Supabase 验证：用 MCP 检查新字段、RPC 参数、缓存行、RLS；确认公开分享 RPC 不暴露金额、现金流、交易明细。
- Worker 验证：测试普通行情、盘前/盘后字段存在时的显示、字段缺失时的降级、benchmark 搜索、history persist。
- 前端验证：用浏览器检查桌面和移动端核心页面；重点看主题切换、iOS 日期/输入框高度、总览 XIRR、基准切换、数据健康回填、交易表单。
- 回归测试：确认原有登录、分享链接、持仓计算、现金余额、交易录入和性能缓存刷新不被破坏。

## Assumptions
- 主题默认使用系统主题，用户手动选择后持久化。
- 只保留 `XIRR` 作为“年化收益”主指标；历史曲线底层缓存可以继续沿用现有性能引擎。
- 行情继续用 Yahoo 免费能力；夜盘作为 best-effort，不承诺所有 ticker 都有夜盘价。
- 分享页只显示 owner 当前选择的一个基准，不让访客自由切换多个基准。
- 先完成核心全套 UI，不做无关重构；任何数据库变更都走新增 idempotent migration。
