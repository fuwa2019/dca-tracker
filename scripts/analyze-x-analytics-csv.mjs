#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.replace(/^--/, '').split('=');
  args.set(key, value ?? true);
}

const csvPath = args.get('csv') || args.get('file');
if (!csvPath) {
  console.error('Usage: npm run content:analyze -- --csv=/path/to/x-analytics.csv [--out=artifacts/x-content/analytics-report.md]');
  process.exit(1);
}

const outputPath = args.get('out') || 'artifacts/x-content/analytics-report.md';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function normalizeKey(key) {
  return key
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function numberValue(value) {
  if (value == null) return 0;
  const cleaned = String(value).replace(/[%,$\s]/g, '').replace(/,/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick(row, candidates) {
  for (const key of candidates) {
    if (row[key] != null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
}

function categoryFromText(text) {
  const value = text.toLowerCase();
  if (/(voo|qqqm|smh|etf|美股|半导体|ai|nvda|amd|tsm|asml|收益|仓位|投资|券商|入金)/i.test(value)) {
    return 'investment';
  }
  if (/(codex|chatgpt|openai|mac|windows|快捷键|命令|终端|自动化|浏览器|效率)/i.test(value)) {
    return 'tool_tip';
  }
  if (/(新闻|突发|发布|宣布|政策|公司|市场|热点)/i.test(value)) {
    return 'general_news';
  }
  if (/(笑|离谱|真实|生活|打工|段子|吐槽)/i.test(value)) {
    return 'light_funny';
  }
  return 'uncategorized';
}

function triggerFromText(text) {
  const value = text.toLowerCase();
  if (/你会选|选 a|选 b|二选一/.test(value)) return 'binary_choice';
  if (/有没有人|遇到过|怎么解决/.test(value)) return 'experience_request';
  if (/可能是我用法不对|我可能错|不确定/.test(value)) return 'mild_disagreement';
  if (/稳定|踩坑|试下来/.test(value)) return 'pitfall_check';
  if (/怎么排|排序|保留 3 个|保留三个/.test(value)) return 'ranking';
  if (/短期噪音|仓位调整|投资建议/.test(value)) return 'investing_discussion';
  if (/[?？]$|你们|大家|怎么看/.test(value)) return 'open_question';
  return 'none';
}

function ratio(num, den) {
  return den > 0 ? num / den : 0;
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function compact(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function table(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(column.value(row)).replace(/\n/g, ' ')).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

const raw = await readFile(csvPath, 'utf8');
const parsedRows = parseCsv(raw);
if (parsedRows.length < 2) {
  console.error('CSV has no data rows.');
  process.exit(1);
}

const headers = parsedRows[0].map(normalizeKey);
const rows = parsedRows.slice(1).map((values) => {
  const row = {};
  headers.forEach((header, index) => {
    row[header] = values[index] ?? '';
  });
  return row;
});

const mapped = rows.map((row, index) => {
  const text = pick(row, ['post_text', 'text', 'tweet_text', 'content', '内容', '帖子内容', 'post', '推文']);
  const impressions = numberValue(pick(row, ['impressions', 'views', '曝光', '展示次数', '展示', '浏览']));
  const replies = numberValue(pick(row, ['replies', 'reply', '回复', '评论']));
  const likes = numberValue(pick(row, ['likes', 'like', '点赞']));
  const reposts = numberValue(pick(row, ['reposts', 'retweets', '转发', '转帖']));
  const quotes = numberValue(pick(row, ['quotes', 'quote_posts', '引用']));
  const profileVisits = numberValue(pick(row, ['profile_visits', 'profile_clicks', '个人资料访问', '主页访问']));
  const follows = numberValue(pick(row, ['follows', 'new_followers', '关注', '新增关注']));
  const engagements = numberValue(pick(row, ['engagements', '互动', '参与次数'])) || replies + likes + reposts + quotes;
  const url = pick(row, ['url', 'post_url', 'tweet_url', '链接']);
  const date = pick(row, ['date', 'time', 'created_at', '发布时间', '日期']);
  const category = categoryFromText(text);
  const trigger = triggerFromText(text);

  return {
    index: index + 1,
    date,
    text,
    url,
    impressions,
    replies,
    likes,
    reposts,
    quotes,
    profileVisits,
    follows,
    engagements,
    category,
    trigger,
    replyRate: ratio(replies, impressions),
    engagementRate: ratio(engagements, impressions),
    followRate: ratio(follows, impressions),
    profileVisitRate: ratio(profileVisits, impressions),
  };
});

const totals = mapped.reduce((acc, row) => {
  acc.impressions += row.impressions;
  acc.replies += row.replies;
  acc.likes += row.likes;
  acc.reposts += row.reposts;
  acc.quotes += row.quotes;
  acc.profileVisits += row.profileVisits;
  acc.follows += row.follows;
  acc.engagements += row.engagements;
  return acc;
}, {
  impressions: 0,
  replies: 0,
  likes: 0,
  reposts: 0,
  quotes: 0,
  profileVisits: 0,
  follows: 0,
  engagements: 0,
});

function topBy(key, minImpressions = 0) {
  return [...mapped]
    .filter((row) => row.impressions >= minImpressions)
    .sort((a, b) => b[key] - a[key])
    .slice(0, 10);
}

function groupBy(key) {
  const groups = new Map();
  for (const row of mapped) {
    const groupKey = row[key] || 'unknown';
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { key: groupKey, posts: 0, impressions: 0, replies: 0, engagements: 0, follows: 0, profileVisits: 0 });
    }
    const group = groups.get(groupKey);
    group.posts += 1;
    group.impressions += row.impressions;
    group.replies += row.replies;
    group.engagements += row.engagements;
    group.follows += row.follows;
    group.profileVisits += row.profileVisits;
  }
  return [...groups.values()].sort((a, b) => b.impressions - a.impressions);
}

const categoryRows = groupBy('category');
const triggerRows = groupBy('trigger');
const topImpressions = topBy('impressions');
const topReplyRate = topBy('replyRate', 100);
const topFollowRate = topBy('followRate', 100);
const topReplies = topBy('replies');

function postLabel(row) {
  const text = row.text ? row.text.slice(0, 42).replace(/\|/g, '/') : `(row ${row.index})`;
  return row.url ? `[${text}](${row.url})` : text;
}

const report = `# X Analytics Report

Source CSV: ${csvPath}

## Summary

- Posts: ${mapped.length}
- Impressions: ${compact(totals.impressions)}
- Replies: ${compact(totals.replies)}
- Reply rate: ${percent(ratio(totals.replies, totals.impressions))}
- Engagements: ${compact(totals.engagements)}
- Engagement rate: ${percent(ratio(totals.engagements, totals.impressions))}
- Profile visits: ${compact(totals.profileVisits)}
- Follows: ${compact(totals.follows)}
- Follow rate: ${percent(ratio(totals.follows, totals.impressions))}

## Category Performance

${table(categoryRows, [
  { label: 'Category', value: (row) => row.key },
  { label: 'Posts', value: (row) => row.posts },
  { label: 'Impressions', value: (row) => compact(row.impressions) },
  { label: 'Reply rate', value: (row) => percent(ratio(row.replies, row.impressions)) },
  { label: 'Engagement rate', value: (row) => percent(ratio(row.engagements, row.impressions)) },
  { label: 'Follow rate', value: (row) => percent(ratio(row.follows, row.impressions)) },
])}

## Comment Trigger Performance

${table(triggerRows, [
  { label: 'Trigger', value: (row) => row.key },
  { label: 'Posts', value: (row) => row.posts },
  { label: 'Impressions', value: (row) => compact(row.impressions) },
  { label: 'Reply rate', value: (row) => percent(ratio(row.replies, row.impressions)) },
  { label: 'Follow rate', value: (row) => percent(ratio(row.follows, row.impressions)) },
])}

## Top Posts By Impressions

${table(topImpressions, [
  { label: 'Post', value: postLabel },
  { label: 'Category', value: (row) => row.category },
  { label: 'Impressions', value: (row) => compact(row.impressions) },
  { label: 'Replies', value: (row) => row.replies },
  { label: 'Follows', value: (row) => row.follows },
])}

## Top Posts By Reply Rate

${table(topReplyRate, [
  { label: 'Post', value: postLabel },
  { label: 'Trigger', value: (row) => row.trigger },
  { label: 'Impressions', value: (row) => compact(row.impressions) },
  { label: 'Reply rate', value: (row) => percent(row.replyRate) },
  { label: 'Replies', value: (row) => row.replies },
])}

## Top Posts By Follow Rate

${table(topFollowRate, [
  { label: 'Post', value: postLabel },
  { label: 'Category', value: (row) => row.category },
  { label: 'Impressions', value: (row) => compact(row.impressions) },
  { label: 'Follow rate', value: (row) => percent(row.followRate) },
  { label: 'Follows', value: (row) => row.follows },
])}

## High-Reply Candidates For Long Posts

${table(topReplies.slice(0, 5), [
  { label: 'Post', value: postLabel },
  { label: 'Category', value: (row) => row.category },
  { label: 'Trigger', value: (row) => row.trigger },
  { label: 'Replies', value: (row) => row.replies },
  { label: 'Reply rate', value: (row) => percent(row.replyRate) },
])}

## Next Actions

- Keep the top 3 comment-trigger patterns by reply rate, unless their follow rate is weak or the replies are low-signal.
- Expand high-reply posts into long posts only when replies contain experience, debate, or source additions.
- Increase categories with both above-average reply rate and follow rate.
- Retire formats that generate impressions without profile visits or follows.
- Manually inspect any post with high impressions and low reply rate for headline-only or aggregator-like wording.
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, report, 'utf8');
console.log(outputPath);
