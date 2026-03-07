/**
 * Date formatting utilities — Stockholm timezone, Swedish format.
 *
 * For now every timestamp is presented in Europe/Stockholm.
 * Future: adjust based on the consultant's site / region.
 */

const TIMEZONE = 'Europe/Stockholm';

/**
 * Full date-time: "2026-03-06, 14:05:30"
 */
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';

  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}, ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Date only: "2026-03-06"
 */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';

  return d.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}

/**
 * Short date for templates etc: "6 Mar 2026"
 */
export function formatDateShort(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';

  return d.toLocaleDateString('en-GB', {
    timeZone: TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
