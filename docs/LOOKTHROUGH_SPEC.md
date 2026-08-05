# 穿透式组合仪表盘 — 设计规格 (LOOKTHROUGH_SPEC)

> 增量规格,不是从零设计。现有底座已具备:
> - 纯计算层 `src/lib/calc/lookThrough.ts`(ETF → 成分股拆分、NAV/equity 双分母、未穿透长尾 `unclassifiedValue`、监控线)。
> - 监控配置 `src/lib/calc/exposureConfig.ts`(NVDA 线、AI 铲子线)。
> - 静态成分表 `src/data/etf-holdings.json`(`_meta.cashLike` / `_meta.asOf`)。
> - 展示页 `src/app/exposure.tsx` + `useExposure.ts`。
> - 行情/价格管线(quote worker)、Schwab 鉴权(`useSchwabAuth.ts`)、IBKR MCP(`get_account_positions` / `get_pa_allocation` / `get_account_summary`)。
>
> 本规格补的是:**多账户合并 + 多币种归一 + 一批新穿透指标 + 自动化数据源**。计算引擎几乎不动 —— 关键是把"FX 归一后的 USD 市值"喂给现有的 `computeLookThrough`。

---

## ① 数据模型

设计原则:**`transactions` 继续服务 DCA / 业绩曲线管线(勿动)**;新增一套"当前持仓快照"表服务穿透。券商 API 直接给当前持仓,没必要从交易流水重建。

迁移按现有编号续号(下一个为 `0040_*`),保持 append-only、幂等、带 RLS。

### 1. `accounts` — 账户
```
accounts(
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references auth.users,
  broker        text not null check (broker in ('schwab','ibkr')),
  display_name  text not null,              -- "Schwab 主仓" / "IBKR"
  base_currency text not null default 'USD',
  sync_mode     text not null check (sync_mode in ('api','manual')),
  created_at    timestamptz default now()
)
-- RLS: user_id = auth.uid()
```

### 2. `account_positions` — 当前持仓快照(穿透的输入源)
券商 API/手动录入都写这里;每次刷新覆盖该账户的快照(或按 `as_of` 留历史)。
```
account_positions(
  id                 uuid pk default gen_random_uuid(),
  user_id            uuid not null,
  account_id         uuid not null references accounts,
  ticker             text not null,         -- 标准化后的代码(见下"代码规整")
  quantity           numeric not null,
  currency           text not null,         -- 'USD' | 'SEK' | 'HKD' ...
  avg_cost_native    numeric,               -- 可空
  market_price_native numeric,              -- 可空(可由 quote worker 现算)
  market_value_native numeric not null,     -- 券商给的本币市值
  as_of              timestamptz not null,
  source             text not null,         -- 'schwab_api' | 'ibkr_mcp' | 'manual'
  unique (account_id, ticker, as_of)
)
```
> 现金作为一行特殊持仓:`ticker='CASH.HKD'`、`currency='HKD'`,在 `instruments` 里 `asset_type='cash'`。

### 3. `instruments` — 标的元数据(地区/遗产税口径的来源)
```
instruments(
  ticker           text pk,
  name             text,
  asset_type       text check (asset_type in ('etf','stock','cash','tbill')),
  currency         text,
  listing_exchange text,                    -- 'NASDAQ' | 'STO'(瑞典)...
  listing_country  text,                    -- 'US' | 'SE' | 'HK'
  domicile_country text,                    -- 注册地:VOO/VGT/SMH/SGOV='US', SIVE='SE'
  is_us_situs      boolean not null default false, -- 美国遗产税敞口口径(见②)
  is_cash_like     boolean not null default false  -- SGOV 等,穿透时不拆
)
```
> 取代 `etf-holdings.json._meta.cashLike`:用 `is_cash_like` 统一。

### 4. `etf_holdings` — ETF 成分权重(取代静态 JSON)
```
etf_holdings(
  etf_ticker         text not null,
  constituent_ticker text not null,
  weight             numeric not null,      -- 小数,0.0712 = 7.12%
  as_of              date not null,
  source             text not null,         -- 'ishares_csv' | 'vanguard_csv' | 'manual'
  primary key (etf_ticker, constituent_ticker, as_of)
)
```
读取时取每个 ETF 的最新 `as_of`。`etf-holdings.json` 降级为种子/离线兜底。

### 5. `company_classification` — 成分股分类(链条/设计-制造/地区)
成分股不一定在 `instruments` 里,单独建表:
```
company_classification(
  ticker        text pk,
  in_semi_chain boolean default false,      -- 计入"半导体制造链合计%"
  chain_segment text check (chain_segment in
                 ('design','foundry','equipment','memory','optical','materials','other')),
  country       text,                       -- 'US' | 'TW'(TSM) | 'NL'(ASML) | 'SE'(SIVE)...
  region        text                        -- 'North America' | 'Europe' | 'Asia ex-CN'...
)
```
设计端 = `design`;制造/设备端 = `foundry|equipment|memory|materials`。

### 6. `fx_rates` — 汇率(归一到 USD)
```
fx_rates(
  date          date not null,
  currency      text not null,              -- 'SEK' | 'HKD'
  usd_per_unit  numeric not null,           -- 1 单位本币 = ? USD
  source        text,
  primary key (date, currency)
)
```
USD 行恒为 1。quote worker cron 顺便抓 `SEK=X` / `HKD=X`(Yahoo)写入。

### 7. `falsification_signals` — 逻辑证伪看板(手动维护)
```
falsification_signals(
  id          uuid pk default gen_random_uuid(),
  user_id     uuid not null,
  key         text not null,                -- 'hyperscaler_capex' | 'wfe_orders' | 'dram_price' | 'nvda_dc_qoq'
  label       text not null,
  status      text check (status in ('green','amber','red')) default 'green',
  note        text,
  source_url  text,
  updated_at  timestamptz default now(),
  unique (user_id, key)
)
```

### 8. `lookthrough_snapshots` — 每日趋势线(让赢家跑的漂移)
```
lookthrough_snapshots(
  user_id        uuid not null,
  date           date not null,
  total_nav_usd  numeric,
  chain_pct      numeric,     -- AI 制造链 / NAV
  nvda_pct       numeric,     -- NVDA 穿透 / NAV
  design_mfg_ratio numeric,
  us_situs_usd   numeric,     -- 美国遗产税敞口市值
  vgt_semi_pct   numeric,     -- VGT 内半导体权重
  payload        jsonb,       -- 完整明细备查
  primary key (user_id, date)
)
```
监控线阈值:**先留在 `exposureConfig.ts`**(已有,改起来快);需要每用户可调时再加 `monitor_lines` 表覆盖。注意当前 NVDA `ceiling=0.12` 要按需求改到 `0.22~0.25`。

---

## ② 穿透权重计算公式

记单标的归一后 USD 市值 `MV(h) = market_value_native(h) × usd_per_unit(currency(h))`。**FX 在喂进引擎之前完成**,`computeLookThrough` 接口不变。

**1. 单公司穿透市值**
```
LTV(c) = Σ_{直接持有 c} MV(h)
       + Σ_{ETF e} [ MV(e) × w_e(c) ]
```
未列出的成分计入 `unclassifiedValue`(已实现,诚实标记"未穿透",不凭空消失)。

**2. 单票穿透权重**(排行榜:NVDA / TSM / AVGO)
```
weight_nav(c)    = LTV(c) / TotalNAV         (含现金/国债,保守)
weight_equity(c) = LTV(c) / EquityValue       (剔除现金/国债)
TotalNAV   = Σ_all MV(h)
EquityValue = TotalNAV − Σ_{is_cash_like} MV(h)
```
NVDA 监控线用 `weight_nav`(分母含现金,更保守)。

**3. 半导体制造链合计%**
```
chain% = Σ_{c: in_semi_chain} LTV(c) / TotalNAV
```
= ETF 内半导体成分 + 直接持有的光通信/制造链单票(AAOI、LITE、SIVE…)加总。

**4. 设计端 vs 制造/设备端 比值**
```
design = Σ_{chain_segment='design'} LTV(c)            -- NVDA/AVGO/AMD/QCOM/MRVL/ARM
mfg    = Σ_{chain_segment∈(foundry,equipment,memory,materials)} LTV(c)
                                                       -- TSM/ASML/AMAT/LRCX/KLAC/MU
design_mfg_ratio = design / mfg
```

**5. 行业/地区/国家暴露**
```
country_exposure[k] = Σ_{c: classification.country = k} LTV(c) / TotalNAV
```
SIVE 直接持有 → 瑞典/欧洲;TSM(SMH 成分)→ 台湾。区域同理按 `region` 聚合。

**6. SMH : VGT 偏离**(用 ETF 本身市值,不穿透)
```
ratio = MV(SMH) / MV(VGT)        目标 = 1.0
deviation% = ratio − 1
```
偏离超阈值(如 ±15%)高亮"下次定投偏向少的那只"。

**7. NRA 美国遗产税敞口**(在**持仓层**算,不穿透 —— situs 看你"持有什么",不看底层)
```
us_situs_usd = Σ_{h: instruments.is_us_situs} MV(h)
```
- 计入:US 注册 ETF(VOO/VGT/SMH/SGOV)+ 美股个股(NVDA 直接/AAOI/LITE)。
- **不计入**:SIVE(瑞典注册)、HKD 现金。卡片需明确标注哪些被排除及原因。
- 文案固定:**仅信息提示,非税务建议**。

**8. VGT 内半导体权重**(OpenAI/Anthropic GICS 跟踪)
```
vgt_semi_pct = Σ_{c ∈ VGT 成分, in_semi_chain} w_VGT(c)
```
逐日写入 `lookthrough_snapshots.vgt_semi_pct`。若新巨头被 GICS 划入"信息技术"并进入 VGT → 该值下滑 → 提示"VGT 半导体被稀释,考虑调高 SMH 以维持 SMH:VGT 实质暴露"。

---

## ③ 分阶段实现路线

每阶段独立可发布、可回退;不破坏现有 `transactions`/业绩曲线管线。

### Phase 0 — 数据模型 + 多币种(地基)
- 迁移 `0040_lookthrough_accounts.sql` … 建表 1–8 + RLS。
- 用真实持仓做种子(Schwab:SMH/VGT/LITE/SGOV/VOO占位;IBKR:AAOI/SIVE(SEK)/SGOV/HKD现金)。
- 手动填 1–2 行 `fx_rates`(SEK、HKD)。
- `useExposure` 数据源从"交易重建"切到"`account_positions` 合并",并在喂进 `computeLookThrough` 前乘 `usd_per_unit` 完成 FX 归一。**引擎不改。**
- 验收:Top 穿透持仓、NVDA 线、铲子线在合并 + 多币种下数值正确。

### Phase 1 — 自动拉取(券商 + 汇率)
- **IBKR**:MCP `get_account_positions` / `get_account_summary` → 写 `account_positions`(`source='ibkr_mcp'`)。
- **Schwab**:沿用现有 API 鉴权拉 positions → 写 `account_positions`(`source='schwab_api'`)。
- **FX**:quote worker cron 增抓 `SEK=X` / `HKD=X` → upsert `fx_rates`(与 `daily_prices` 同一 cron)。
- UI:手动刷新按钮 + "各账户 as_of"提示;IBKR 自动、Schwab 自动(失败可手动补)。
- 代码规整:建一张映射(SIVE.STO→SIVE 等)统一两家券商的代码到 `instruments.ticker`。

### Phase 2 — ETF 成分自动更新
- worker cron 周更:VanEck(SMH)、Vanguard(VGT/VOO)、Invesco(QQQ/QQQM)官网完整持仓 → 原子替换 `etf_holdings`;仅刷新仍被持有的 ETF,最后持有人清仓后物理删除动态快照。
- 读取从 `etf-holdings.json` 切到 DB(JSON 保留为离线兜底/首屏)。
- `_meta.asOf` 由 `etf_holdings.as_of` 取代,页面显示真实更新日。

实现状态(2026-08-05):代码与 migrations `0048_etf_holdings_refresh.sql`、`0049_restrict_etf_holding_table_privileges.sql` 已部署,包含手动刷新、交易变更协调、每周 cron、逐 ETF 失败保留旧快照和公开只读成分契约。Quote Worker 与 Pages 已上线;仍需用合成账户完成已认证刷新、最后持有人清仓删除和重新买入验收。

### Phase 3 — 新仪表盘卡片(一屏看完)
默认一屏:总览(总值 / 各桶权重 / SMH:VGT 偏离)→ 穿透 Top 持仓 → 三条监控线状态。补:
- 半导体制造链合计% 卡 + 设计/制造比值卡。
- 地区/国家暴露条(高亮台湾 via TSM、瑞典/欧洲 via SIVE)。
- NRA 美国遗产税敞口卡(US-situs 合计 + 排除清单 + 免责声明)。
- 逻辑证伪看板(读 `falsification_signals`,任一 `red` 标红;设置页可手动改状态)。
- 移动端:卡片单列堆叠,监控线状态用色块徽标即可读。

### Phase 4 — 趋势线 + 主动提醒
- 每日 cron 计算并写 `lookthrough_snapshots`(chain% / nvda% / design_mfg / us_situs / vgt_semi%)。
- AI 制造链占比、NVDA 穿透权重、VGT 半导体% 三条趋势线(让赢家跑的漂移可视化)。
- 复用 `email-cron` worker 发提醒:NVDA `weight_nav` 漂过 22–25%、SMH:VGT 偏离超阈、VGT 半导体% 明显下滑。提醒只"叫你回看一次",不自动操作。

---

## 一句话总览
FX 归一 → 合并两账户当前持仓 → 喂给已有的 `computeLookThrough` → 在其结果上加 5 个聚合指标(链合计/设计-制造/地区/遗产税/VGT 半导体)+ 每日快照趋势线 + 手动证伪看板。数据源按"先手动种子 → 接券商+FX → 接 ETF 成分"三步自动化。
