/**
 * Timestamp formatting.
 *
 * Messages store ISO 8601 strings. The original stored pre-formatted display
 * strings ("10:30 AM", "Yesterday at 2:15 PM"), which could not be sorted,
 * grouped by day, or localised, and mixed formats as soon as a new message
 * was sent.
 */

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const fullFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'short',
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole days between two instants, by calendar day rather than elapsed hours. */
function daysApart(a: Date, b: Date): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);
}

/** "9:41 AM" - the time a message was sent, in the viewer's locale. */
export function formatMessageTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** "Today", "Yesterday", "Tuesday", or "March 4, 2026" for a day divider. */
export function formatDayDivider(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const delta = daysApart(date, now);

  if (delta === 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  if (delta > 1 && delta < 7) return weekdayFormatter.format(date);
  return dateFormatter.format(date);
}

/** Full timestamp for a tooltip / `title` attribute. */
export function formatFullTimestamp(iso: string): string {
  return fullFormatter.format(new Date(iso));
}

/** Stable calendar-day key used to group messages into dated sections. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

