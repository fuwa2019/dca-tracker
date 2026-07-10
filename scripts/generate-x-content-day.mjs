#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.replace(/^--/, '').split('=');
  args.set(key, value ?? true);
}

const today = new Date();
const localDate = args.get('date') || [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, '0'),
  String(today.getDate()).padStart(2, '0'),
].join('-');

const outputDir = args.get('out') || 'artifacts/x-content';
const candidateCount = Number(args.get('candidates') || 36);

const categories = [
  ['investment', 8, '投资/财经/科技'],
  ['tool_tip', 6, 'Codex/Mac/Windows 技巧'],
  ['general_news', 4, '泛新闻快评'],
  ['light_funny', 4, '轻松/搞笑/生活观察'],
  ['interaction', 2, '明确互动问题'],
];

const triggers = [
  ['binary_choice', '你会选 A 还是 B?'],
  ['experience_request', '有没有人也遇到过? 最后怎么解决的?'],
  ['mild_disagreement', '我现在越来越觉得 X 不如 Y，可能是我用法不对。'],
  ['pitfall_check', '这个方法我试下来有用，但不知道是不是所有机器都稳定。'],
  ['ranking', '如果只能保留 3 个工具，你会怎么排?'],
  ['investing_discussion', '你们会把这个当短期噪音，还是当仓位调整信号?'],
];

const contentModes = [
  'reply_first',
  'save_share_first',
  'reply_first',
  'personality',
  'save_share_first',
  'reply_first',
];

function categoryForCandidate(index) {
  const expanded = [
    ...Array(12).fill(['investment', '投资/财经/科技']),
    ...Array(9).fill(['tool_tip', 'Codex/Mac/Windows 技巧']),
    ...Array(6).fill(['general_news', '泛新闻快评']),
    ...Array(6).fill(['light_funny', '轻松/搞笑/生活观察']),
    ...Array(3).fill(['interaction', '明确互动问题']),
  ];
  return expanded[index % expanded.length];
}

function publishCategoryForHour(hour) {
  const rhythm = [
    ['tool_tip', 'Codex/Mac/Windows 技巧'],
    ['light_funny', '轻松/搞笑/生活观察'],
    ['general_news', '泛新闻快评'],
    ['investment', '投资/财经/科技'],
    ['tool_tip', 'Codex/Mac/Windows 技巧'],
    ['interaction', '明确互动问题'],
    ['investment', '投资/财经/科技'],
    ['general_news', '泛新闻快评'],
    ['tool_tip', 'Codex/Mac/Windows 技巧'],
    ['investment', '投资/财经/科技'],
    ['light_funny', '轻松/搞笑/生活观察'],
    ['investment', '投资/财经/科技'],
  ];
  return rhythm[hour % rhythm.length];
}

function candidateBlock(index) {
  const [category, label] = categoryForCandidate(index);
  const [triggerType, trigger] = triggers[index % triggers.length];
  const mode = contentModes[index % contentModes.length];
  const n = String(index + 1).padStart(2, '0');
  return `### Candidate ${n}

- category: ${category} (${label})
- content_mode: ${mode}
- topic:
- source:
- source_status: needs_check
- draft:
- comment_trigger_type: ${triggerType}
- comment_trigger: ${trigger}
- risk: yellow
- risk_note:
- publish_decision: revise
`;
}

function publishingSlot(hour) {
  const [category, label] = publishCategoryForHour(hour);
  const time = `${String(hour).padStart(2, '0')}:00`;
  const [triggerType, trigger] = triggers[hour % triggers.length];
  const mode = contentModes[hour % contentModes.length];
  return `### ${time}

- category: ${category} (${label})
- content_mode: ${mode}
- selected_candidate:
- source:
- final_draft:
- comment_trigger_type: ${triggerType}
- comment_trigger: ${trigger}
- final_check:
  - original_view_added: no
  - source_verified: no
  - no_engagement_exchange: yes
  - no_clickbait: yes
  - investment_disclaimer_needed: no
- publish_status: manual_pending
`;
}

const checklist = `## Operating Checklist

- [ ] Collect hotspots with Computer Use / Browser / Chrome in read-only mode.
- [ ] Verify news, finance, OpenAI/Codex, product, and command claims before publishing.
- [ ] Fill ${candidateCount} candidates.
- [ ] Mark red candidates as discard.
- [ ] Select 24 green or repaired yellow candidates for the hourly pool.
- [ ] Confirm every hourly post has a natural comment trigger.
- [ ] Balance hourly posts across reply_first, save_share_first, and personality.
- [ ] Pick one hourly post or thread for the long post.
- [ ] Complete nightly review.

## Daily Mix Target

${categories.map(([, count, label]) => `- ${label}: ${count}`).join('\n')}
`;

const candidates = Array.from({ length: candidateCount }, (_, index) => candidateBlock(index)).join('\n');
const publishingPool = Array.from({ length: 24 }, (_, hour) => publishingSlot(hour)).join('\n');

const nightlyReview = Array.from({ length: 24 }, (_, hour) => {
  const time = `${String(hour).padStart(2, '0')}:00`;
  return `### Post ${time}

- category:
- content_mode:
- topic:
- impressions:
- replies:
- reply_rate:
- profile_visits:
- follows:
- comment_quality:
  - experience:
  - debate:
  - source_addition:
  - low_signal:
- decision: expand_to_long_post | make_series | keep_template | retire
- notes:
`;
}).join('\n');

const content = `# X Content Day Plan - ${localDate}

${checklist}

## Hotspot Research Notes

- Morning:
- Midday:
- Market window:
- Night:

## Candidate Pool

${candidates}

## Hourly Publishing Pool

${publishingPool}

## Long Post

- source_candidate:
- topic:
- source:
- outline:
  1. What happened or what I tested:
  2. Why it matters:
  3. My current view:
  4. What I may be wrong about:
  5. Specific discussion question:
- draft:
- final_check:
  - source_verified: no
  - personal_view_added: no
  - no_return_promise_or_copy_trading: yes
  - investment_disclaimer_needed: no

## Nightly Review

${nightlyReview}
`;

const outputPath = path.join(outputDir, `${localDate}.md`);
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, content, 'utf8');
console.log(outputPath);
