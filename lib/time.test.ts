import { describe, expect, it } from 'vitest';
import { dayKey, formatDayDivider } from './time';

const at = (daysAgo: number, hour = 12): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

describe('day dividers', () => {
  // Regression: the original stored display strings such as
  // "Yesterday at 2:15 PM", which stayed "Yesterday" forever.
  it('labels today and yesterday relative to now', () => {
    expect(formatDayDivider(at(0))).toBe('Today');
    expect(formatDayDivider(at(1))).toBe('Yesterday');
  });

  it('uses a weekday name within the past week', () => {
    const label = formatDayDivider(at(3));
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Yesterday');
    expect(label).toMatch(/[A-Za-z]/);
  });

  it('falls back to a full date beyond a week', () => {
    expect(formatDayDivider(at(30))).toMatch(/\d{4}/);
  });

  it('treats late last night and this morning as different days', () => {
    const lateYesterday = at(1, 23);
    const earlyToday = at(0, 1);
    expect(dayKey(lateYesterday)).not.toBe(dayKey(earlyToday));
  });
});

