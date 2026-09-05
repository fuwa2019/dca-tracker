// 静态回放 supabase/migrations/ 中的函数定义，检查最终状态里是否存在无法解析的重载。
//
// 背景：`_performance_source_hash` 有单参包装器和双参主体两个重载。0028 曾把双
// 参形式的 `default 'SPY'` 去掉，因为带默认值时 `_performance_source_hash(uuid)`
// 有两个候选，Postgres 报 42725。0043 又把默认值加了回来，0047 沿用，于是
// `refresh_due_performance_caches` 静默失败了一个月都没有任何测试发现。
//
// 这里只做文本回放，不连数据库：按文件名顺序处理 create/drop，得到每个函数最终
// 存活的签名集合，然后检查两个签名的实参个数区间是否重叠且前缀类型相同。

import { readFileSync, readdirSync } from 'node:fs';

// 已知的历史歧义，非阻塞：0027 给 performance_history / performance_cache_status /
// refresh_performance_history_cache 各建了一个「带默认值的单参形式 + 零参兼容包装
// 器」，0034 对 tracked_symbol_coverage 做了同样的事。零参调用因此有两个候选。这
// 四个只在前端的兜底分支里被无参调用，尚未观测到线上失败，改动会动到 authenticated
// 的 grant 面和 0052 的 V2 缓存契约，需要单独决策，故先登记不阻塞。
const KNOWN_HISTORICAL_AMBIGUITIES = new Set([
  'performance_history/0/',
  'performance_cache_status/0/',
  'refresh_performance_history_cache/0/',
  'tracked_symbol_coverage/0/',
]);

const MIGRATIONS_DIRECTORY = new URL('../supabase/migrations/', import.meta.url);
const MIGRATION_FILENAME = /^\d{4}_.+\.sql$/;

/** 跳过 dollar-quoted 函数体、字符串和注释，只留下顶层 SQL 文本。 */
function stripNestedText(sql) {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);

    const dollarOpen = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollarOpen) {
      const tag = dollarOpen[0];
      const close = sql.indexOf(tag, index + tag.length);
      index = close === -1 ? sql.length : close + tag.length;
      out += ' ';
      continue;
    }

    const char = sql[index];
    if (char === "'") {
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === "'" && sql[cursor + 1] === "'") cursor += 2;
        else if (sql[cursor] === "'") break;
        else cursor += 1;
      }
      // 参数默认值需要保留字面量本身，用占位符顶替即可。
      out += "''";
      index = cursor + 1;
      continue;
    }

    if (char === '-' && sql[index + 1] === '-') {
      const newline = sql.indexOf('\n', index);
      index = newline === -1 ? sql.length : newline;
      continue;
    }

    out += char;
    index += 1;
  }
  return out;
}

/** 从左括号处读到配对的右括号，返回括号内文本和结束下标。 */
function readParenthesized(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(openIndex + 1, index), endIndex: index };
    }
  }
  return null;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

/** `p_benchmark text default ''` -> { type: 'text', hasDefault: true }。 */
function parseParameter(raw) {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (cleaned === '') return null;
  const withoutDefault = cleaned.split(/\s+(?:default\s|=\s)/i)[0];
  const hasDefault = withoutDefault.length !== cleaned.length;
  const tokens = withoutDefault.split(' ');
  const mode = /^(in|out|inout|variadic)$/i.test(tokens[0] ?? '') ? tokens.shift().toLowerCase() : 'in';
  // 形如 `p_user_id uuid`：去掉参数名后剩下的就是类型。命名可省略，此时只有类型。
  const type = (tokens.length > 1 ? tokens.slice(1) : tokens).join(' ').toLowerCase().replace(/^public\./, '');
  return { mode, type, hasDefault };
}

function signatureKey(parameters) {
  return parameters.map((parameter) => parameter.type).join(',');
}

const migrationFiles = readdirSync(MIGRATIONS_DIRECTORY, { withFileTypes: true })
  .filter((entry) => entry.isFile() && MIGRATION_FILENAME.test(entry.name))
  .map((entry) => entry.name)
  .sort();

/** name -> Map(signatureKey -> { parameters, definedIn }) */
const liveFunctions = new Map();

const STATEMENT_PATTERN =
  /\b(?:(create)\s+(?:or\s+replace\s+)?|(drop)\s+)function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi;

for (const filename of migrationFiles) {
  const sql = stripNestedText(readFileSync(new URL(filename, MIGRATIONS_DIRECTORY), 'utf8'));

  // create 与 drop 必须按文件内出现的顺序回放：0053 就是先 drop 再 create，分两轮
  // 扫描会把刚建好的重载删掉，检查随之失效。
  STATEMENT_PATTERN.lastIndex = 0;
  for (let match = STATEMENT_PATTERN.exec(sql); match !== null; match = STATEMENT_PATTERN.exec(sql)) {
    const parenthesized = readParenthesized(sql, STATEMENT_PATTERN.lastIndex - 1);
    if (parenthesized === null) continue;
    const parameters = splitTopLevel(parenthesized.inner)
      .map(parseParameter)
      .filter((parameter) => parameter !== null && parameter.mode !== 'out');
    const name = match[3].toLowerCase();
    const key = signatureKey(parameters);

    if (match[1]) {
      if (!liveFunctions.has(name)) liveFunctions.set(name, new Map());
      liveFunctions.get(name).set(key, { parameters, definedIn: filename });
    } else {
      liveFunctions.get(name)?.delete(key);
    }
  }
}

function arityRange(parameters) {
  const required = parameters.filter((parameter) => !parameter.hasDefault).length;
  return { min: required, max: parameters.length };
}

const conflicts = [];
for (const [name, signatures] of liveFunctions) {
  const entries = [...signatures.values()];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const a = entries[left];
      const b = entries[right];
      const rangeA = arityRange(a.parameters);
      const rangeB = arityRange(b.parameters);
      const from = Math.max(rangeA.min, rangeB.min);
      const to = Math.min(rangeA.max, rangeB.max);
      for (let arity = from; arity <= to; arity += 1) {
        const prefixA = signatureKey(a.parameters.slice(0, arity));
        const prefixB = signatureKey(b.parameters.slice(0, arity));
        if (prefixA !== prefixB) continue;
        conflicts.push({ name, arity, prefix: prefixA, key: `${name}/${arity}/${prefixA}`, a, b });
        break;
      }
    }
  }
}

function describe(conflict) {
  const render = (entry) => entry.parameters
    .map((parameter) => parameter.type + (parameter.hasDefault ? ' default' : ''))
    .join(', ');
  return `public.${conflict.name}(${conflict.prefix}) 有 ${conflict.arity} 个实参时无法解析：\n`
    + `      ${conflict.a.definedIn}: (${render(conflict.a)})\n`
    + `      ${conflict.b.definedIn}: (${render(conflict.b)})`;
}

const known = conflicts.filter((conflict) => KNOWN_HISTORICAL_AMBIGUITIES.has(conflict.key));
const unexpected = conflicts.filter((conflict) => !KNOWN_HISTORICAL_AMBIGUITIES.has(conflict.key));

for (const conflict of known) {
  console.warn(`警告：已知历史歧义，非阻塞：${describe(conflict)}`);
}

if (unexpected.length > 0) {
  console.error('函数重载校验失败：以下调用形式有多个候选，Postgres 会报 42725。');
  for (const conflict of unexpected) console.error(`  - ${describe(conflict)}`);
  console.error('修复方式：新增 migration，drop 后重建去掉多余默认值的那一个重载。');
  process.exit(1);
}

console.log(
  `函数重载校验通过：${migrationFiles.length} 个 migration，${liveFunctions.size} 个函数名，`
  + `${known.length} 处已登记的历史歧义，无新增歧义重载。`,
);
