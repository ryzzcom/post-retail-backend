/**
 * Pakistan Standard Time (PKT, UTC+5) Date/Time Formatting & Query Helpers
 */

/**
 * Format a date into '11 Oct 2026' (or specified UK/PK formatted date)
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  }).format(d);
}

/**
 * Format time in Pakistan Standard Time (e.g. '2:05 PM')
 */
export function formatPktTime(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format date & time in Pakistan Standard Time (e.g. '11 Oct 2026, 2:05 PM')
 */
export function formatPktDateTime(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Build a Prisma date range filter ({ gte, lte }) from optional start and end date strings.
 */
export function buildDateRangeFilter(
  startDate?: string,
  endDate?: string,
): { gte?: Date; lte?: Date } | undefined {
  if (!startDate && !endDate) return undefined;
  const filter: { gte?: Date; lte?: Date } = {};
  if (startDate) {
    const start = new Date(startDate);
    if (!isNaN(start.getTime())) filter.gte = start;
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!isNaN(end.getTime())) filter.lte = end;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Get date boundaries for a given 'YYYY-MM' month string in PKT.
 * Returns { startDate, endDate, prevStartDate, prevEndDate }
 */
export function getMonthDateBoundaries(monthStr?: string): {
  startDate: Date;
  endDate: Date;
  prevStartDate: Date;
  prevEndDate: Date;
} {
  let year: number;
  let month: number; // 0-indexed

  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    const [y, m] = monthStr.split('-').map(Number);
    year = y;
    month = m - 1;
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
  }

  const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevStartDate = new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0));
  const prevEndDate = new Date(Date.UTC(prevYear, prevMonth + 1, 0, 23, 59, 59, 999));

  return { startDate, endDate, prevStartDate, prevEndDate };
}
