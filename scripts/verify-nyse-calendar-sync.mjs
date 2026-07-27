import { readFileSync } from 'node:fs';

const CALENDAR_FILES = [
  {
    label: 'SPA',
    path: 'src/lib/nyse-calendar.ts',
    url: new URL('../src/lib/nyse-calendar.ts', import.meta.url),
  },
  {
    label: 'quote Worker',
    path: 'workers/quote/src/nyseCalendar.ts',
    url: new URL('../workers/quote/src/nyseCalendar.ts', import.meta.url),
  },
  {
    label: 'email-cron Worker',
    path: 'workers/email-cron/src/nyse-calendar.ts',
    url: new URL('../workers/email-cron/src/nyse-calendar.ts', import.meta.url),
  },
];

function extractObjectLiteral(source, path) {
  const declaration = /\b(?:export\s+)?const\s+NYSE_HOLIDAYS\b[^=]*=/.exec(source);
  if (!declaration) {
    throw new Error(`${path}: could not find NYSE_HOLIDAYS declaration`);
  }

  const openingBrace = source.indexOf('{', declaration.index + declaration[0].length);
  if (openingBrace === -1) {
    throw new Error(`${path}: NYSE_HOLIDAYS object has no opening brace`);
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace, index + 1);
    }
  }

  throw new Error(`${path}: NYSE_HOLIDAYS object has no closing brace`);
}

function parseCalendar(source, path) {
  const objectLiteral = extractObjectLiteral(source, path);
  const calendar = Function(`"use strict"; return (${objectLiteral});`)();

  if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar)) {
    throw new Error(`${path}: NYSE_HOLIDAYS must be an object`);
  }

  const normalized = {};
  for (const [year, dates] of Object.entries(calendar)) {
    if (!/^\d{4}$/.test(year) || !Array.isArray(dates)) {
      throw new Error(`${path}: invalid NYSE_HOLIDAYS entry for ${year}`);
    }
    for (const date of dates) {
      if (typeof date !== 'string' || !new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(date)) {
        throw new Error(`${path}: invalid holiday date ${String(date)} for ${year}`);
      }
    }
    if (new Set(dates).size !== dates.length) {
      throw new Error(`${path}: duplicate holiday date in ${year}`);
    }
    normalized[year] = [...dates].sort();
  }

  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)));
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

const calendars = CALENDAR_FILES.map((file) => ({
  ...file,
  calendar: parseCalendar(readFileSync(file.url, 'utf8'), file.path),
}));
const reference = calendars[0];
let mismatch = false;

for (const candidate of calendars.slice(1)) {
  const years = [...new Set([
    ...Object.keys(reference.calendar),
    ...Object.keys(candidate.calendar),
  ])].sort();

  for (const year of years) {
    const expectedDates = reference.calendar[year] ?? [];
    const actualDates = candidate.calendar[year] ?? [];
    const missing = difference(expectedDates, actualDates);
    const extra = difference(actualDates, expectedDates);

    if (missing.length > 0 || extra.length > 0) {
      if (!mismatch) {
        console.error(`NYSE 假日日历不一致（基准：${reference.path}）：`);
      }
      mismatch = true;
      if (missing.length > 0) {
        console.error(`- ${year} ${candidate.path} 缺失：${missing.join(', ')}`);
      }
      if (extra.length > 0) {
        console.error(`- ${year} ${candidate.path} 多出：${extra.join(', ')}`);
      }
    }
  }
}

if (mismatch) {
  process.exitCode = 1;
} else {
  console.log(`NYSE 假日日历一致性校验通过：${calendars.map(({ path }) => path).join(' = ')}`);
}
