# X Content Ops

This folder is the operating system for the X account growth workflow. It is intentionally draft-only: it helps collect hotspots, write candidates, score risk, plan hourly posts, and review results. It never posts, replies, likes, follows, DMs, or changes X settings.

## Daily Target

- 24 hourly main posts.
- 1 long post.
- 30-36 candidates before screening.
- Every hourly post must include a real comment trigger.

## Content Mix

Use this as the daily default:

| Category | Count | Purpose |
| --- | ---: | --- |
| Investment / finance / tech | 8 | Keep the account's long-term trust and investing identity. |
| Codex / Mac / Windows tips | 6 | Build a second growth engine around practical workflows. |
| General news quick takes | 4 | Capture timely attention without becoming a news aggregator. |
| Light / funny / life observations | 4 | Add human texture and broader reach. |
| Explicit interaction prompts | 2 | Ask clean questions that invite real experience, not engagement farming. |

## Hotspot Collection

Preferred source order:

1. Computer Use / Browser / Chrome: inspect live pages, trends, X discussions, Grok, Google Trends, tech communities, and news homepages.
2. Primary or near-primary source: company blog, official docs, SEC / IR page, exchange page, product release note, original news report.
3. Search fallback: use broad search only to locate original sources or compare coverage.

Computer Use is for read-only research by default. Do not use it to publish, reply, like, follow, DM, upload, authorize, or change account settings unless the user explicitly confirms that exact action at action time.

## Candidate Requirements

Each candidate must include:

- `topic`: what the post is about.
- `source`: URL, page name, screenshot note, or "personal experience".
- `draft`: publish-ready text or a close draft.
- `comment_trigger`: the exact sentence intended to invite replies.
- `content_mode`: `reply_first`, `save_share_first`, or `personality`.
- `risk`: `green`, `yellow`, or `red`.
- `risk_note`: what needs to be verified or softened.

Reject candidates that are only rewritten headlines, copied jokes, pure news summaries, or bait.

## Comment Triggers

Rotate these patterns:

- Binary choice: "你会选 A 还是 B?"
- Experience request: "有没有人也遇到过? 最后怎么解决的?"
- Mild disagreement: "我现在越来越觉得 X 不如 Y，可能是我用法不对。"
- Pitfall verification: "这个方法我试下来有用，但不知道是不是所有机器都稳定。"
- Ranking: "如果只能保留 3 个工具，你会怎么排?"
- Investing discussion: "你们会把这个当短期噪音，还是当仓位调整信号?"

Avoid asking for comments in exchange for anything. Never use "评论区抽奖", "评论领资料", "互关互赞", or similar engagement exchange wording.

## Screening Rules

Risk levels:

- `green`: original, low-risk, source is clear, no exaggerated claim.
- `yellow`: usable after verification, source improvement, or wording softening.
- `red`: discard. Usually copied, misleading, inflammatory, adult / hateful / violent, unverifiable, or looks like platform manipulation.

Before moving a candidate into the 24-post publishing pool, check:

- Does it include a personal view, tested workflow, real scenario, or uncertainty?
- Is the comment trigger natural and not manipulative?
- Are news, finance, Codex / OpenAI, system commands, and product claims verified?
- Does investment content avoid personalized advice, return promises, and copy-trading framing?
- Does humor avoid copyright copying, harassment, hate, adult content, and misleading synthetic media?

## Hourly Publishing Pool

Interleave categories. Do not publish many same-category posts in a row.

Recommended rhythm:

- 00:00 tool tip
- 01:00 light / funny
- 02:00 general news
- 03:00 investing
- Repeat with local adjustments for market hours and active audience windows.

The user publishes manually. If a post needs screenshots, sources, or fact checks, mark it before publishing.

Balance each day across three post modes:

- `reply_first`: asks for experience, choices, ranking, correction, or debate.
- `save_share_first`: offers a checklist, compact workflow, source-backed explainer, or useful comparison.
- `personality`: light observation, personal routine, or human texture.

Do not make all 24 hourly posts reply-first. If impressions rise while engagement rate, reposts, and bookmarks stay weak, increase save/share-first posts.

## Long Post

Pick one of:

- The highest-quality comment thread from yesterday.
- A high-performing hourly post that deserves depth.
- A market or tool topic with enough source material.

Default long-post shape:

1. What happened or what I tested.
2. Why it matters to an ordinary user / investor.
3. My current view.
4. What I may be wrong about.
5. A specific discussion question.

Investment long posts should include: "个人记录，不构成投资建议".

## Nightly Review

Record these:

- Impressions.
- Replies.
- Reply rate.
- Profile visits.
- Follows.
- Saves / bookmarks if available.
- Comment quality: `experience`, `debate`, `source_addition`, `low_signal`.
- Whether the post should become a long post, a series, or be retired.

The winning metric is not raw replies alone. Prefer replies that contain personal experience, useful disagreement, or additional sources.

## Local Commands

Generate a blank daily operating file:

```bash
npm run content:day -- --date=2026-07-02
```

Analyze an exported X Analytics CSV:

```bash
npm run content:analyze -- --csv=/path/to/x-analytics.csv
```

The analyzer writes a Markdown report with totals, category performance, comment-trigger performance, top posts by impressions, top posts by reply rate, top posts by follow rate, and candidates to expand into long posts.
