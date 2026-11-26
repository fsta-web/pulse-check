// Semua waktu ditampilkan dalam WITA (Asia/Makassar, UTC+8, tanpa DST).
export const TZ = "Asia/Makassar";
const OFFSET_MS = 8 * 60 * 60 * 1000;

/** Tanggal WITA (YYYY-MM-DD) dari sebuah waktu. */
export function witaDate(t: number | string | Date = Date.now()): string {
  const ms = typeof t === "number" ? t : new Date(t).getTime();
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}

/** Jam WITA (0-23) dari sebuah waktu. */
export function witaHour(t: number | string | Date): number {
  const ms = typeof t === "number" ? t : new Date(t).getTime();
  return new Date(ms + OFFSET_MS).getUTCHours();
}

/** Jam WITA pecahan, mis. 8.5 = 08:30. */
export function witaHourFrac(t: number = Date.now()): number {
  const d = new Date(t + OFFSET_MS);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

/** Awal hari (00:00 WITA) dalam ms UTC. */
export function dayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`);
}

/** Waktu tertentu (jam:00 WITA) pada tanggal, dalam ms. */
export function atHourMs(date: string, hour: number): number {
  return dayStartMs(date) + hour * 3600 * 1000;
}

export function fmtTime(t: string | number | Date): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(t))
    .replace(".", ":");
}

export function fmtDateTime(t: string | number | Date): string {
  const d = new Date(t);
  const date = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(d);
  return `${date} ${fmtTime(d)}`;
}

export function fmtDateLong(date: string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(dayStartMs(date) + 12 * 3600 * 1000),
  );
}

export function minutesSince(t: string | number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(t).getTime()) / 60000));
}

export function fmtAgo(min: number): string {
  if (min < 1) return "baru saja";
  if (min < 60) return `${min} m lalu`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}j ${m}m lalu` : `${h}j lalu`;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function addDays(date: string, days: number): string {
  return witaDate(dayStartMs(date) + days * 86400000 + 3600000);
}
