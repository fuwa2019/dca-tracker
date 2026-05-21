  P0 必修

  1. 邮件 Worker 无鉴权触发发信
     位置：workers/email-cron/src/index.ts:43
     问题：公网 POST /run?force=1 可绕过日期和去重。
     修改：增加 ADMIN_SECRET，要求 Authorization: Bearer ...；或生产环境删除 /
     run?force=1。force 也要保留频控/去重。
  2. 总资产/盈亏没有现金仓位
     位置：src/app/dashboard.tsx:81、src/hooks/usePortfolio.ts:56
     问题：只算股票市值，不算未买入现金；入金未买满会显示假亏损。
     修改：新增 cash balance 口径：现金 = 累计到账USD - 买入成交额 + 卖出成交
     额，总资产用 持仓市值 + 现金。XIRR、TWR、资产曲线、$1M 进度都用 NAV。
  3. TWR 现金流分段公式错误
     位置：src/lib/calc/twr.ts:98
     问题：当前 cashflow 被算进上一段收益，违背 TWR。
     修改：现金流日作为分段边界；先计算前一段 V_end / V_start - 1，再把现金流加
     入下一段起始 NAV。或改用每日 NAV 链接法。
  4. 卖出可超过持仓
     位置：src/components/TxnForm.tsx:43、src/lib/calc/position.ts:63
     问题：超卖后 FIFO 静默吞掉错误，持仓和已实现盈亏失真。
     修改：前端提交卖出前计算当前可卖股数并拦截；计算层遇到超卖应抛错或返回
     validation error。必要时数据库用 RPC 写交易，统一校验。
  5. Cloudflare Pages 深层路由可能 404
     位置：src/App.tsx:29
     问题：/share/:token 直接打开可能不回退到 SPA。
     修改：新增 public/_redirects：/* /index.html 200。

  P1 重要

  6. 汇兑损耗口径不完整
     位置：src/components/CashflowForm.tsx:45
     问题：没录入/计算 fees_cny，fees_usd 也没纳入口径；target_rate 标注成 USD/
     CNY 但实际按 CNY/USD 用。
     修改：表单增加 CNY 手续费；文案改为“参考汇率 CNY/USD”。推荐公式：总CNY成本
     = cny_amount + fees_cny，理想USD = 总CNY成本 / target_rate，损耗 = 理想USD
     - usd_amount。fees_usd 只做拆分展示，避免重复扣。
  7. 再平衡默认比例和碎股不符合要求
     位置：src/app/rebalance.tsx:23、src/lib/calc/rebalance.ts:68
     问题：默认等权，且只支持整股。
     修改：默认 VOO:QQQM:SMH = 2:1:1，即 50/25/25。买入股数改为 0.0001 精度：
     Math.floor(rawShares * 10000) / 10000，显示 toFixed(4)，文案删除“整股”。
  8. 再平衡 settings 异步加载后不同步
     位置：src/app/rebalance.tsx:23
     问题：weights 只在首次 render 初始化，watchlist 后续变化不会更新。
     修改：用 useEffect 监听 watchlist，当用户未手动修改或标的变化时重建默认权
     重。
  9. Supabase 部署文档漏跑 0002_daily_prices.sql
     位置：README.md:74、supabase/README.md:5
     问题：新部署缺 daily_prices 表，资产曲线失败。
     修改：文档改成按顺序执行 0001_init.sql 和 0002_daily_prices.sql。
  10. Quote Worker CORS 预览域名匹配错误

     位置：workers/quote/src/index.ts:373、workers/quote/wrangler.toml:15
     问题：注释说支持 preview pattern，代码实际精确匹配。
     修改：支持 *.pages.dev 或明确列出生产域名/本地域名；不要让注释和实现矛盾。
  11. SPY 基准遇到周末/假日入金会漏买

     位置：src/lib/calc/history.ts:93
     问题：cashflow 当天无 SPY close 时，只增加 invested，不增加 SPY shares。
     修改：把 cashflow 规范到下一个交易日，或用 pendingSpyCash 在后续第一个有
     SPY close 的日期买入。
  12. 图表交易标记在金额模式下坐标错误

     位置：src/components/EquityCurveChart.tsx:102
     问题：金额模式用 navUser 放 marker，但主线是 pnlUser。
     修改：Scatter value 改为：收益率模式 returnPctUser，金额模式 pnlUser。
  13. 分享视图收益率在卖出后不准

     位置：supabase/migrations/0001_init.sql:205
     问题：shared_portfolio 用所有历史买入均价，没有按卖出扣减剩余成本。
     修改：SQL 函数按平均成本等比例扣减卖出成本，或改为 RPC 返回脱敏后的前端同口
     径计算结果。

  P2 质量/部署

  14. .env.example 缺失

     位置：README.md:107
     问题：文档要求复制 .env.example，但文件不存在。
     修改：新增 .env.example，只放占位值：VITE_SUPABASE_URL、
     VITE_SUPABASE_ANON_KEY、VITE_QUOTE_WORKER_URL。
  15. lint 脚本不可运行

     位置：package.json:11
     问题：定义了 eslint，但没安装 ESLint。
     修改：要么补齐 eslint、typescript-eslint、eslint-plugin-react-hooks 配置；
     要么删除 lint 脚本，避免假质量门。
  16. .gitignore 太少

     位置：.gitignore:1
     问题：未排除 node_modules/、dist/、worker node_modules、.env*。
     修改：加入这些目录和环境文件，避免提交依赖、构建产物和密钥。
  17. 前端 typecheck 不覆盖 Worker

     位置：tsconfig.json:1、worker tsconfig
     问题：根 npm run typecheck 只检查前端和 Vite 配置。
     修改：根 package 增加脚本，例如同时跑 tsc -b、cd workers/quote && tsc
     --noEmit、cd workers/email-cron && tsc --noEmit。
  18. 新建交易/资金流默认日期用 UTC

     位置：src/components/TxnForm.tsx:23、src/components/CashflowForm.tsx:22
     问题：中国早上会默认成前一天。
     修改：用本地日期格式化函数，或固定 Asia/Shanghai。
  19. 美股开盘判断忽略 NYSE 假日

     位置：src/lib/quote.ts:32
     问题：节假日会误判盘中并 1 分钟刷新。
     修改：复用 NYSE holiday calendar，或文案改成“工作日盘中估算”。
  20. 邮件提醒默认开启

     位置：supabase/migrations/0001_init.sql:102
     问题：注册后自动订阅提醒。
     修改：开源/多用户场景建议默认 email_enabled=false，让用户主动开启。
  21. README 引用不存在/本机路径

     位置：README.md:5
     问题：写 CLAUDE.md 和本机 .claude 路径，仓库内实际是 AGENT.md。
     修改：可不改；如果开源，建议改成 AGENT.md 或删除本机路径。