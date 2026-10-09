/**
 * Africa/Lagos timezone helpers.
 * All business dates are stored as "YYYY-MM-DD" strings computed in Lagos time.
 */

const LAGOS_TZ = 'Africa/Lagos';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: LAGOS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const weekdayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: LAGOS_TZ,
  weekday: 'short',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: LAGOS_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** "YYYY-MM-DD" for the given instant in Lagos. */
export function lagosTodayYmd(d: Date = new Date()): string {
  return dateFmt.format(d);
}

/** Weekday 0=Sun..6=Sat for the given instant in Lagos. */
export function lagosWeekday(d: Date = new Date()): number {
  const short = weekdayFmt.format(d);
  const n = WEEKDAY_MAP[short];
  if (n === undefined) throw new Error(`Unexpected weekday from Intl: ${short}`);
  return n;
}

/** Minutes since midnight for the given instant in Lagos. */
export function lagosMinutes(d: Date = new Date()): number {
  const [h, m] = timeFmt.format(d).split(':').map(Number);
  return h * 60 + m;
}

/** "HH:mm" for the given instant in Lagos. */
export function lagosHhmm(d: Date = new Date()): string {
  return timeFmt.format(d);
}

/** "19:00" -> "7:00 PM", "08:05" -> "8:05 AM". */
export function formatTime12h(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Invalid HH:mm time: ${hhmm}`);
  let h = Number(m[1]);
  const min = m[2];
  if (h < 0 || h > 23) throw new Error(`Invalid HH:mm time: ${hhmm}`);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${suffix}`;
}

/** "2026-10-08" -> "Thu, 08 Oct 2026". Pure function (no TZ dependence). */
export function formatDateLong(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`Invalid YYYY-MM-DD date: ${ymd}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${days[d.getUTCDay()]}, ${m[3]} ${months[d.getUTCMonth()]} ${m[1]}`;
}

/** "HH:mm" -> minutes since midnight. Throws on invalid input. */
export function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Invalid HH:mm time: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid HH:mm time: ${hhmm}`);
  return h * 60 + min;
}

/** minutes since midnight -> "HH:mm" (wraps past midnight). */
export function minutesToHhmm(minutes: number): string {
  const norm = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
