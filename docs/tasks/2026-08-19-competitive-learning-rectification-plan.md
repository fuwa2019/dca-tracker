# 竞品学习整改计划（2026-08-19）

输入：`competitive-learning-plan-2026-08-19.pptx`（会议版竞品学习方案）、
`docs/research/competitive/2026-08/`（scorecard、decisions、backlog、
requirements-audit）、`HANDOFF.md`（2026-08-19 已验证状态）。

本计划把 PPT 的学习结论翻译成可执行、可验收的整改项。它不授权任何生产
迁移、性能方法切换或部署；这些仍按 `AGENTS.md` 与
`docs/decisions/2026-08-18-ledger-import-release-gate.md` 单独授权。

2026-08-19 调整（用户指示）：

1. Wealthfolio 与 Portfolio Performance 仍在本机运行，实机 computer-use
   学习成为常规证据通道（记录为 S1b，见 `observations.md`）；Ghostfolio
   的 Colima 实例已停，需要时再单独授权重启。
2. 前端整改由 Claude 直接实施：每个前端整改项按「实机参考 → 纯计算/组件
   实现 → 测试 → Playwright/浏览器视觉验证」的顺序交付，仍走既有
   CI-equivalent 验证，不涉及生产部署。
3. B4 首个切片已交付：`src/lib/calc/navBridge.ts` +
   `scripts/verify-nav-bridge.mjs`（已入 `test:finance`）+ Performance 页
   「计算拆解」卡片（期初净值 + 外部净流入 + 期间盈亏 = 期末净值，随图表
   区间联动，含恒等式校验与语义诚实注记）。桌面与 390px 视觉验证通过。

## 一、PPT 结论提要（整改依据）

1. 参考分工：Wealthfolio v3.6.2 = 交互/导入流程参考（71 分）；
   Portfolio Performance 0.86.0 = 计算解释参考（67 分）；
   Ghostfolio 3.36.0 = 外壳/分享/PWA 结构参考（36 分）。
2. 优先级顺序：先把账记对（导入可信）→ 再把结果讲清（计算可解释）→
   最后把产品做窄（单人单组合边界）。
3. 四条数据合同：Source adapters（纯解析）、Preview & audit（逐行状态与
   回执）、Ledger（`LedgerTrade[]` / `LedgerCashEvent[]`）、Calc & share
   （XIRR/TWR 与百分比-only 公共缓存）。
4. 三条工程红线：解析器不直接写数据库；异常不静默修正；公开缓存不泄露
   金额。
5. 拒绝清单（边界而非欠账）：多账户财富管理、预算/负债/退休规划、实时
   交易同步、交易执行、复制竞品视觉与品牌。

## 二、路线图与仓库现状对照

24 周路线（PPT 第 10 页）与 2026-08-19 已验证状态的差距：

| 阶段 | 计划周 | 现状 | 剩余差距 |
|---|---|---|---|
| 产品基线 | W1–2 | 已完成：`PRODUCT.md`/`DESIGN.md`、固定版本研究、评分与决策 | 无（保持冻结） |
| 可信导入 | W3–8 | 大部分完成：三源适配器、四行状态预览、`0050` 已上线、workbench 为默认路径 | 每个 import state 的回归 fixture；真实文件预览由用户单独复核 |
| 财务账本 | W9–14 | 部分完成：现金事件契约、PP 对齐日流/XIRR 对账门禁进入 `test:finance` | `ledger_twr_v2` 切换门禁未过：完整重导入 + PP 精确 quote-history TTWROR/XIRR 对账仍 pending |
| 界面重建 | W15–19 | 部分完成：任务型 workbench 已发布并通过桌面/390px 检查 | WCAG 2.2 AA 全路由审计、reduced-motion、键盘全路径证据仍为 partial/missing |
| 分析与发布 | W20–24 | 未开始 | 收益组成、回撤、隐私快照、Lighthouse 预算、发布检查单全部 missing |

结论：研究与导入阶段提前于计划完成，整改重心应压在
**账本计算门禁（B）、可达性证据（C）、V2 分享缓存（D）、发布门禁（E）**。

## 三、整改工作流

### A. 可信导入收尾（Wealthfolio 参考）

- A1 为每个 import 行状态（valid / duplicate / blocked / warning）与每种
  模式（`append` / `replace_source` / `reset_all`）各建一个最小回归
  fixture，纳入 `test:portfolio-import` 或新增脚本；验收 = 全部状态在
  CI-equivalent 中有断言。
- A2 回执完整性：最终导入回执必须报告 imported / duplicates / skipped /
  total 四数（对齐 Wealthfolio 的 0/13/14/14 语义），并对 blocked 行保留
  原因文本（不静默修正）。
- A3 真实 Schwab CSV 预览留给用户单独复核；`reset_all` 实际写入必须由
  用户逐次确认（延续 `HANDOFF.md` 既定边界）。
- A4 语义降级可见化：不支持的现金事件（如税费映射损失）在预览中显式
  标注，参照 decisions 中 “unsupported cash events remain visible”。

### B. 财务账本与 `ledger_twr_v2` 门禁（Portfolio Performance 参考）

- B1 完成 PP 0.86.0 精确 quote-history TTWROR/XIRR 对账：为固定
  synthetic run 配齐报价历史与期界对齐，目标 = TWR 零差、XIRR
  亚基点差（延续现有 `test:finance` 对账门禁标准）。
- B2 `ledger_twr_v2` 切换前置条件（全部满足才可申请授权）：
  完整重新导入通过、B1 对账通过、V1 旧数据回归不变、
  `VITE_LEDGER_IMPORT_V2=0` 回滚路径验证。
- B3 保持 “ordinary close + 显式股息/税/费事件” 与
  “adjusted close 基准代理” 分离，杜绝总回报双计（decisions 已裁定）。
- B4 现金账户与绩效现金流语义分离：外部出入金 vs 内部股息/卖出流动，
  在计算拆解 UI 中可见（PP 的解释边界）。
  【进度 2026-08-19】账户级 NAV 桥已上线 Performance 页（见文首调整项 3）。
  下一切片：待 V2 现金事件写入路径解锁后，把「期间盈亏」进一步拆为
  资本利得 / 已实现 / 股息利息收入 / 费用 / 税款（对齐 PP 收益计算树）。

### C. 界面与可达性证据（DESIGN.md WCAG 2.2 AA 基线）

- C1 为 login、overview、performance、ledger/import、data health、
  settings、share 全路由补自动化 + 手动 WCAG 审计记录；
  requirements-audit 当前为 partial。
- C2 键盘全路径：每个路由 forward/reverse Tab、可见 focus、菜单可键盘
  展开，纳入 Playwright 检查（桌面 + 390px）。
- C3 reduced-motion：应用侧提供 `prefers-reduced-motion` 降级样式并以
  emulation 断言；不再依赖 macOS 系统设置探针（该探针已明确不可用）。
- C4 移动端反例落地：避免 PP 392px “固定侧栏裁切表格” 的失败模式，
  所有数据表在 390px 内自身滚动而非页面横向溢出。

### D. V2 缓存与分享（Ghostfolio 外壳参考，隐私红线）

- D1 requirements-audit 中唯一整段 missing 的合同项：dashboard 与公开
  分享使用同一 V2 缓存且不泄露金额。整改 = 实现 V2 缓存/RPC 后立即做
  隐私快照测试（匿名请求只能拿到百分比、日期、标签、权重）。
- D2 吸收 Ghostfolio 教训：公开视图隐藏金额但暴露了 manual UUID——
  分享 payload 增加 “无内部标识符泄露” 断言。
- D3 分享页继续只读缓存，禁止匿名重算或实时 API 重建历史
  （`PROJECT.md` 既有契约，回归中保持断言）。

### E. 分析与发布门禁（Phase 5，当前 missing）

- E1 收益组成、费用/税、回撤、目标漂移分析，全部先在 synthetic
  fixture 上实现并验证。
- E2 发布门禁补齐：Lighthouse 预算、跨浏览器兼容记录、隐私快照、
  发布检查单；requirements-audit 中 “Performance/Lighthouse/compatibility
  gates” 由 missing 转 proved 才算关闭。
- E3 每阶段独立发布、独立可回退；数据迁移、算法切换、视觉重建不绑定
  同一次上线（PPT 发布原则）。

### F. 学习纪律流水线（Learning Loop）

- F1 每次竞品学习产出固定五件套：任务记录、截图索引、数字对账、
  采用/拒绝决策、回归用例；只允许 synthetic fixture，不触真实文件。
- F2 每条 adopt 决策必须关联一个数字、一个任务或一个回归用例，
  否则退回 hypothesis。
- F3 partial gate 不得包装成完整认证（例如 WCAG）；证据状态以
  `requirements-audit.md` 的 proved/partial/missing 三态为准并持续更新。

## 四、近两周冲刺（对齐 PPT 第 12 页）

1. 三款固定版本复盘记录收尾并归档（研究窗口已按无 macOS 变更边界
   关闭，未证明项保持 partial/missing 记录）。
2. 锁定 `PRODUCT.md` / `DESIGN.md` 的边界与 WCAG 基线（已定稿即冻结，
   变更走 decisions）。
3. 完成 A1：每个 import state 一个 regression fixture。
4. 启动 B1 的报价历史配齐与期界对齐。
5. 前端（Claude 实施）：B4 已交付账户级计算拆解；下一项按优先级为
   账本表格的事件类型芯片与现金事件行样式（Wealthfolio Activities
   参考），随后是导入回执四数语义对齐（imported / duplicates /
   skipped / total 的展示措辞与现有回执字段映射说明）。

## 五、授权与边界（整改期间不变）

- 生产迁移、`ledger_twr_v2` 切换、部署、密钥轮换：每次单独授权。
- 研究与测试只用 synthetic 数据；真实券商文件不读、不拷、不导入。
- 公开分享保持百分比-only；绝对金额、现金流、交易明细、汇损、联系
  方式永不进入公共 JSON。
- 拒绝清单内的能力不因 “竞品有” 而立项。

## 六、验收命令

默认 CI-equivalent：`npm run test:finance`、`npm run test:email-reminder`、
`npm run test:quote-status`、`npm run typecheck`、`npm run build`。
按整改域追加：`test:portfolio-import`（A）、`test:competitive-fixture` 与
finance 对账门禁（B）、`test:ui` + Playwright 桌面/390px（C）、隐私快照
测试（D，待建）、Lighthouse 预算（E，待建）。
