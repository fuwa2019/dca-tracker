import assert from 'node:assert/strict';

import { monthlyReminderCandidate } from '../workers/email-cron/src/nyse-calendar.ts';

const REMINDER_TIME_ZONE = 'Asia/Shanghai';

function verify(nowIso, expected) {
  const actual = monthlyReminderCandidate(new Date(nowIso), REMINDER_TIME_ZONE);
  assert.deepEqual(actual, expected);
}

verify('2026-05-30T03:00:00Z', {
  todayLocal: '2026-05-30',
  candidate: '2026-05-31',
  firstOfMonth: '2026-05-01',
  shouldSend: false,
});

verify('2026-05-31T03:00:00Z', {
  todayLocal: '2026-05-31',
  candidate: '2026-06-01',
  firstOfMonth: '2026-06-01',
  shouldSend: true,
});

verify('2026-01-01T03:00:00Z', {
  todayLocal: '2026-01-01',
  candidate: '2026-01-02',
  firstOfMonth: '2026-01-02',
  shouldSend: true,
});

console.log('email reminder date fixtures passed');
