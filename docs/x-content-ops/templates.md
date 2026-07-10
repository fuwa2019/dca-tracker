# X Content Ops Templates

## Hotspot Research Prompt

```text
你现在是我的 X 热点检索助手。

账号目标：
- 每天 24 条小时主帖 + 1 条长文。
- 小时帖要引发真实评论，不做互赞互关、不做搬运聚合。
- 内容方向包括：投资/财经/科技、Codex/Mac/Windows 使用技巧、泛新闻快评、轻松搞笑/生活观察。

请基于最近 24 小时的真实热点，输出 12 个候选主题。

每个候选必须包含：
1. 主题
2. 来源链接或来源页面
3. 核心事实一句话
4. 我可以加入的个人视角
5. 适合的评论触发器
6. 风险等级：green/yellow/red
7. 发布前需要核验什么

不要输出纯搬运标题。
不要推荐低俗、仇恨、成人、暴力、阴谋论、无法核验、诱导互赞互关的内容。
```

## Hourly Post Draft Prompt

```text
你现在帮我写 X 小时主帖。

账号风格：
- 普通人真实记录。
- 可以写投资、工具技巧、新闻快评、轻松观察。
- 不装专家，不标题党，不像 AI 总结。
- 每条都要有一个自然的评论触发器。

素材：
【粘贴热点、来源、个人角度】

请输出 3 个版本，每个 80-220 字：
A. 更稳健
B. 更有讨论感
C. 更短更像随手发

硬性要求：
- 不能只复述新闻。
- 必须包含个人判断、使用场景、踩坑或不确定性。
- 结尾放一个自然问题。
- 不要写“评论区告诉我”“转发收藏”这类互动诱导。
- 如果是投资内容，不构成投资建议。
- 如果是 Codex/OpenAI/Mac/Windows 功能或命令，标出发布前要核验的点。
```

## Long Post Draft Prompt

```text
你现在帮我写一条 X 长文。

目标：
- 来自今天表现好的小时帖或热点。
- 既有信息密度，也像真人记录。
- 结尾要能引发高质量评论。

素材：
【粘贴小时帖、评论、来源、数据】

结构：
1. 今天看到/测试了什么
2. 为什么这件事值得普通人关注
3. 我的理解或当前做法
4. 我可能错在哪里
5. 结尾提一个具体问题

要求：
- 800-1500 中文字。
- 不要像营销号，不要像研报。
- 新闻、金融、工具功能必须可核验。
- 投资内容避免荐股、喊单、收益承诺。
- 如涉及投资，结尾加：个人记录，不构成投资建议。
```

## Candidate Record

```md
### Candidate XX

- category:
- content_mode: reply_first | save_share_first | personality
- topic:
- source:
- source_status: verified | needs_check | personal_experience
- draft:
- comment_trigger:
- risk: green | yellow | red
- risk_note:
- publish_decision: publish | revise | discard
```

## Hourly Post Formula

```text
【个人观察 / 事实】

我自己的理解是：【个人判断 / 使用场景 / 踩坑】。

这里我不太确定的是：【不确定性或边界】。

【自然问题】
```

## Tool Tip Formula

```text
今天试了一个【Codex/Mac/Windows】小用法：

【具体动作或场景】

我觉得它适合【人群/场景】，但不一定适合【边界】。

有没有人有更省事的做法？
```

## Investing Formula

```text
今天看到【市场/公司/ETF/宏观现象】。

我的理解是【个人视角】，放到我的阶段更像是【观察信号/短期噪音/执行提醒】。

我不会因为一条新闻直接改仓位，还是先看【指标/后续事实】。

你们会把这个当短期噪音，还是当仓位调整信号？

个人记录，不构成投资建议。
```

## News Quick Take Formula

```text
今天看到【新闻】。

最有意思的不是【表层】，而是【个人观察】。

我现在的判断是【温和判断】，但这里可能有一个盲点：【盲点】。

你怎么看这个角度？
```

## Light / Funny Formula

```text
今天看到一个很真实的场景：

【生活/工作/工具使用观察】

我第一反应是【轻松表达】，后来发现【一点反转或共鸣】。

有没有人也这样？
```

## Nightly Review Record

```md
### Post HH:00

- category:
- content_mode:
- topic:
- source:
- comment_trigger_type:
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
```
