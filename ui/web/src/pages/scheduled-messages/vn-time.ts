// All scheduled-message times are anchored to Vietnam time (GMT+7, Asia/Ho_Chi_Minh)
// regardless of the viewer's browser timezone, so a time picked here always fires
// at that wall-clock moment in Vietnam.

const VN_TZ = "Asia/Ho_Chi_Minh";

/** Epoch ms → "YYYY-MM-DDTHH:mm" wall-clock string in Vietnam time (for <input type="datetime-local">). */
export function msToVNInput(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "YYYY-MM-DDTHH:mm" (interpreted as Vietnam wall-clock) → epoch ms. */
export function vnInputToMs(value: string): number {
  if (!value) return NaN;
  return Date.parse(`${value}:00+07:00`);
}

/** Epoch ms → human-readable Vietnam-time string (dd/mm/yyyy HH:mm). */
export function formatVN(ms: number): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

/** A sensible default new time: tomorrow 08:00 Vietnam time. */
export function defaultNewTimeMs(): number {
  const now = Date.now();
  const tomorrow = msToVNInput(now + 24 * 60 * 60 * 1000).slice(0, 10); // YYYY-MM-DD
  return vnInputToMs(`${tomorrow}T08:00`);
}
