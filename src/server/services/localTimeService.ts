const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLocalDate(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

export function formatLocalDateTime(value: Date): string {
  return `${formatLocalDate(value)} ${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;
}

export function getResolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
}

export function formatUtcSqlDateTime(value: Date): string {
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())} ${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}:${pad2(value.getUTCSeconds())}`;
}

export function parseStoredUtcDateTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  let parsed: Date;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    parsed = new Date(`${text.replace(' ', 'T')}Z`);
  } else {
    parsed = new Date(text);
  }

  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function toLocalDayKeyFromStoredUtc(raw: string | null | undefined): string | null {
  const parsed = parseStoredUtcDateTime(raw);
  if (!parsed) return null;
  return formatLocalDate(parsed);
}

export function getLocalDayRangeUtc(now = new Date()): {
  localDay: string;
  startUtc: string;
  endUtc: string;
} {
  const localStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const nextLocalStart = new Date(localStart.getTime() + DAY_MS);
  return {
    localDay: formatLocalDate(now),
    startUtc: formatUtcSqlDateTime(localStart),
    endUtc: formatUtcSqlDateTime(nextLocalStart),
  };
}

export function getLocalRangeStartUtc(days: number, now = new Date()): string {
  const normalizedDays = Math.max(1, Math.floor(days || 1));
  const localStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const start = new Date(localStart.getTime() - (normalizedDays - 1) * DAY_MS);
  return formatUtcSqlDateTime(start);
}
