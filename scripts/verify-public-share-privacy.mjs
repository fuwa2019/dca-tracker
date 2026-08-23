// Public-share privacy gate.
//
// The red line in PROJECT.md is that an anonymous share response carries no
// absolute amounts, cashflows, trades, exchange loss, contact details or
// private fields. This checks that statically, against the migration set, so a
// future migration cannot widen the anonymous surface unnoticed.
//
// What it can and cannot see, stated up front:
//
//   - It CAN compute the effective anon-executable function set, read the last
//     static definition of each entry point, and check every JSON key those
//     entry points emit themselves.
//   - It CANNOT read the cache writer chain. `_performance_history_for_user_fast_base`
//     has no static definition at all: migration 0029 created it by renaming
//     the then-current `_performance_history_for_user_fast`, and every later
//     change patches it in place through `pg_get_functiondef`. Its body is only
//     knowable from a live database.
//
// That second point is why the history entry point must project the cached
// payload through an allowlist rather than trusting what the writer put there.
// The gate enforces the projection instead of trying to audit the writer.

import { readdirSync, readFileSync } from 'node:fs';

// Overridable so the negative tests below can run the gate against a mutated
// copy of the migration set without touching the repository.
const MIGRATIONS = process.env.SHARE_PRIVACY_MIGRATIONS ?? 'supabase/migrations';

/** Effective anonymous surface. Adding to this list is a deliberate act. */
const EXPECTED_ANON_FUNCTIONS = [
  'public.shared_history',
  'public.shared_performance_history',
  'public.shared_portfolio',
];

/** Every JSON key an anonymous entry point may emit itself. */
const ALLOWED_PAYLOAD_KEYS = new Set([
  'benchmark',
  'cash_weight_pct',
  'day_change_pct',
  'dirty',
  'error',
  'generated_at',
  'has_snapshot_price',
  'positions',
  'return_pct',
  'series',
  'ticker',
  'total_return_pct',
  'weight_pct',
]);

/** Fields a warning entry may keep once projected for anonymous readers. */
const ALLOWED_WARNING_KEYS = new Set(['date', 'type', 'original_date', 'ticker']);

/** Entry points that return a cached payload and therefore must project it. */
const CACHE_RETURNING_ENTRY_POINTS = ['public.shared_performance_history'];
const SANITIZER = 'public._public_share_sanitize_history';

/** A cache-only share path must never trigger a recompute for an anonymous caller. */
const RECOMPUTE_HELPERS = [
  '_performance_history_for_user_fast',
  '_public_history_for_user_fast',
  '_refresh_performance_history_cache_for_user',
  '_refresh_portfolio_history_cache_for_user',
  'refresh_shared_history_cache',
];

/** Keys that must never reach an anonymous reader, by name. */
const FORBIDDEN_KEY_PATTERN = /(^|_)(id|uuid|token|email|user)$|amount|usd|cny|cash_flow|cashflow|nav|invested|cost_basis|pnl|proceeds|exchange_loss|settled/i;

const failures = [];
const notes = [];

// ---------------------------------------------------------------- file order
// Filename order, matching scripts/verify-migration-numbering.mjs and the
// duplicate-number decision in docs/decisions/2026-07-27-migration-numbering-duplicates.md.
const files = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (files.length === 0) {
  console.error('公开分享隐私校验失败：supabase/migrations/ 下没有迁移文件。');
  process.exit(1);
}

// ------------------------------------------------------- effective anon grants
const GRANT = /grant\s+execute\s+on\s+function\s+([\w.]+)\s*\(([^)]*)\)\s+to\s+([^;]+);/gi;
const REVOKE = /revoke\s+all\s+on\s+function\s+([\w.]+)\s*\(([^)]*)\)\s+from\s+([^;]+);/gi;
const anonFunctions = new Set();

for (const file of files) {
  const sql = readFileSync(`${MIGRATIONS}/${file}`, 'utf8');
  const events = [];
  for (const match of sql.matchAll(GRANT)) events.push({ at: match.index, grant: true, fn: match[1], roles: match[3] });
  for (const match of sql.matchAll(REVOKE)) events.push({ at: match.index, grant: false, fn: match[1], roles: match[3] });
  events.sort((left, right) => left.at - right.at);
  for (const event of events) {
    if (!/\banon\b|\bpublic\b/i.test(event.roles)) continue;
    if (event.grant) anonFunctions.add(event.fn);
    else anonFunctions.delete(event.fn);
  }
}

const anonList = [...anonFunctions].sort();
if (anonList.join('|') !== EXPECTED_ANON_FUNCTIONS.join('|')) {
  failures.push(
    `匿名可执行函数集合发生变化。\n  期望：${EXPECTED_ANON_FUNCTIONS.join(', ')}\n  实际：${anonList.join(', ')}\n`
    + '  新增匿名入口必须先审查负载字段，再更新本脚本的允许清单。',
  );
}

// ------------------------------------------------------------ last definitions
const DEFINITION = /create\s+or\s+replace\s+function\s+([\w.]+)\s*\(/gi;
const definitions = new Map();
for (const file of files) {
  const sql = readFileSync(`${MIGRATIONS}/${file}`, 'utf8');
  for (const match of sql.matchAll(DEFINITION)) {
    definitions.set(match[1], { file, body: dollarQuotedBody(sql, match.index) });
  }
}

function dollarQuotedBody(sql, start) {
  const open = sql.indexOf('$$', start);
  if (open === -1) return sql.slice(start, start + 8000);
  const close = sql.indexOf('$$', open + 2);
  return sql.slice(start, close === -1 ? sql.length : close + 2);
}

// ------------------------------------------------------------------ SQL bits
function stripComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; out += c; continue; }
    if (c === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}

function splitTopLevelArguments(text, from) {
  const args = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      current += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === '(') { depth += 1; current += c; continue; }
    if (c === ')') {
      if (depth === 0) { args.push(current); return args; }
      depth -= 1;
      current += c;
      continue;
    }
    if (c === ',' && depth === 0) { args.push(current); current = ''; continue; }
    current += c;
  }
  return args;
}

function emittedPairs(body) {
  const cleaned = stripComments(body);
  const pairs = [];
  for (const match of cleaned.matchAll(/jsonb?_build_object\s*\(/gi)) {
    const args = splitTopLevelArguments(cleaned, match.index + match[0].length);
    for (let i = 0; i < args.length; i += 2) {
      const rawKey = args[i].trim();
      const literal = /^'([^']*)'$/.exec(rawKey);
      pairs.push({
        key: literal ? literal[1] : null,
        rawKey,
        value: (args[i + 1] ?? '').replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return pairs;
}

// --------------------------------------------------- entry point payload keys
for (const name of anonList) {
  const definition = definitions.get(name);
  if (!definition) {
    failures.push(`${name} 是匿名入口，但迁移集中找不到它的静态定义。`);
    continue;
  }

  for (const helper of RECOMPUTE_HELPERS) {
    if (new RegExp(`public\\.${helper}\\s*\\(`).test(stripComments(definition.body))) {
      failures.push(`${name}（${definition.file}）调用了重算函数 ${helper}：匿名分享必须只读缓存。`);
    }
  }

  for (const pair of emittedPairs(definition.body)) {
    if (pair.key === null) {
      failures.push(`${name}（${definition.file}）用非字面量作为 JSON 键：${pair.rawKey.slice(0, 60)}`);
      continue;
    }
    if (!ALLOWED_PAYLOAD_KEYS.has(pair.key)) {
      failures.push(`${name}（${definition.file}）输出了不在允许清单里的键 '${pair.key}'。`);
    }
    if (FORBIDDEN_KEY_PATTERN.test(pair.key)) {
      failures.push(`${name}（${definition.file}）输出了疑似内部标识或金额的键 '${pair.key}'。`);
    }
    if (/\bv_user_id\b|\bp_token\b|share_links/.test(pair.value)) {
      failures.push(`${name}（${definition.file}）把内部标识写进了 '${pair.key}' 的值：${pair.value.slice(0, 60)}`);
    }
  }
}

// ------------------------------------------------ cached payloads are projected
for (const name of CACHE_RETURNING_ENTRY_POINTS) {
  const definition = definitions.get(name);
  if (!definition) {
    failures.push(`${name} 应当返回缓存负载，但找不到它的定义。`);
    continue;
  }
  const body = stripComments(definition.body);
  const returnsCache = /\breturn\s+[^;]*\bv_(cached|legacy)\b/.test(body);
  const projects = new RegExp(`${SANITIZER.replace('.', '\\.')}\\s*\\(`).test(body);
  if (returnsCache && !projects) {
    failures.push(
      `${name}（${definition.file}）直接返回缓存负载而没有经过 ${SANITIZER}。`
      + '缓存写入链是动态打补丁的、静态不可审计，所以公开边界必须做白名单投影。',
    );
  }
  if (!returnsCache && !projects) {
    failures.push(`${name}（${definition.file}）既不返回缓存也不投影：请确认它仍是缓存读取路径。`);
  }
}

const sanitizer = definitions.get(SANITIZER);
if (!sanitizer) {
  failures.push(`找不到 ${SANITIZER}：公开分享的白名单投影缺失。`);
} else {
  const allowed = [...stripComments(sanitizer.body).matchAll(/'([a-z_]+)'/gi)].map((m) => m[1]);
  const inList = allowed.filter((key) => ALLOWED_WARNING_KEYS.has(key));
  const extra = allowed.filter((key) => !ALLOWED_WARNING_KEYS.has(key) && key !== 'warnings');
  if (inList.length !== ALLOWED_WARNING_KEYS.size) {
    failures.push(`${SANITIZER}（${sanitizer.file}）的白名单与脚本预期不一致：${allowed.join(', ')}`);
  }
  for (const key of extra) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      failures.push(`${SANITIZER}（${sanitizer.file}）的白名单里出现了金额或标识字段 '${key}'。`);
    }
  }
}

// ----------------------------------- dynamic patches must not add payload keys
let patchedReplacements = 0;
for (const file of files) {
  const sql = stripComments(readFileSync(`${MIGRATIONS}/${file}`, 'utf8'));
  for (const match of sql.matchAll(/replace\s*\(\s*v_def\s*,/gi)) {
    const args = splitTopLevelArguments(sql, match.index + match[0].length - 1 + 1);
    patchedReplacements += 1;
    const replacement = args[1] ?? '';
    if (/jsonb?_build_object/i.test(replacement)) {
      failures.push(
        `${file} 用动态补丁改写函数体时引入了 jsonb_build_object：`
        + '这类改写在静态审计之外，不得新增负载字段。',
      );
    }
  }
}
notes.push(`扫描了 ${files.length} 个迁移文件，${patchedReplacements} 处动态函数体改写。`);
notes.push(`匿名入口：${anonList.join(', ')}`);
notes.push(`未静态审计：_performance_history_for_user_fast_base（0029 重命名后一直原地打补丁），由公开边界的白名单投影兜底。`);

if (failures.length > 0) {
  console.error('公开分享隐私校验失败：');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('公开分享隐私校验通过。');
for (const note of notes) console.log(`  · ${note}`);
