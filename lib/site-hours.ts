export type OpeningHours = Record<string, Array<[string, string]>>;

export type SiteSchedule = {
  status: string;
  acceptsOrders: boolean | number;
  openingHoursJson: string;
  timezone: string;
  openedAt?: string | null;
  closedAt?: string | null;
};

export type SiteClosureWindow = {
  reason: string;
  startsAt: string;
  endsAt: string | null;
};

const weekdayKeys: Record<string, string> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

function timeMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function parseOpeningHours(value: string): OpeningHours | null {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const result: OpeningHours = {};
    for (const [day, rawIntervals] of Object.entries(parsed)) {
      if (!Object.values(weekdayKeys).includes(day) || !Array.isArray(rawIntervals)) return null;
      const intervals: Array<[string, string]> = [];
      for (const raw of rawIntervals) {
        if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== "string" || typeof raw[1] !== "string") return null;
        if (timeMinutes(raw[0]) === null || timeMinutes(raw[1]) === null || raw[0] === raw[1]) return null;
        intervals.push([raw[0], raw[1]]);
      }
      result[day] = intervals;
    }
    return result;
  } catch {
    return null;
  }
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: weekdayKeys[values.weekday] || "mon",
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function zonedLocalDate(year: number, month: number, day: number, minutes: number, timezone: string) {
  const target = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let candidate = target;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    candidate += target - represented;
  }
  return new Date(candidate);
}

function nextScheduledOpening(hours: OpeningHours, at: Date, timezone: string) {
  if (Object.keys(hours).length === 0) return null;
  const local = zonedParts(at, timezone);
  const calendarStart = Date.UTC(local.year, local.month - 1, local.day);
  const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  for (let offset = 0; offset <= 7; offset += 1) {
    const calendar = new Date(calendarStart + offset * 24 * 60 * 60_000);
    const day = dayKeys[calendar.getUTCDay()];
    for (const [start] of hours[day] || []) {
      const candidate = zonedLocalDate(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate(), timeMinutes(start)!, timezone);
      if (candidate.getTime() > at.getTime()) return candidate.toISOString();
    }
  }
  return null;
}

function isInIntervals(minutes: number, intervals: Array<[string, string]>) {
  return intervals.some(([start, end]) => {
    const startMinutes = timeMinutes(start)!;
    const endMinutes = timeMinutes(end)!;
    return startMinutes < endMinutes
      ? minutes >= startMinutes && minutes < endMinutes
      : minutes >= startMinutes;
  });
}

function previousWeekday(day: string) {
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return keys[(keys.indexOf(day) + 6) % 7];
}

function scheduleAllows(hours: OpeningHours, date: Date, timezone: string) {
  if (Object.keys(hours).length === 0) return true;
  const local = zonedParts(date, timezone);
  if (isInIntervals(local.minutes, hours[local.weekday] || [])) return true;
  return (hours[previousWeekday(local.weekday)] || []).some(([start, end]) => {
    const startMinutes = timeMinutes(start)!;
    const endMinutes = timeMinutes(end)!;
    return startMinutes > endMinutes && local.minutes < endMinutes;
  });
}

function activeClosure(closures: SiteClosureWindow[], at: Date) {
  const timestamp = at.getTime();
  return closures.find((closure) => {
    const startsAt = new Date(closure.startsAt).getTime();
    const endsAt = closure.endsAt ? new Date(closure.endsAt).getTime() : Number.POSITIVE_INFINITY;
    return Number.isFinite(startsAt) && startsAt <= timestamp && timestamp < endsAt;
  });
}

function formatReopening(value: string, timezone: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

export function evaluateSiteAvailability(site: SiteSchedule, closures: SiteClosureWindow[], at = new Date()) {
  const timezone = site.timezone || "Asia/Ho_Chi_Minh";
  const hours = parseOpeningHours(site.openingHoursJson);
  const openedAt = site.openedAt ? new Date(site.openedAt).getTime() : null;
  const closedAt = site.closedAt ? new Date(site.closedAt).getTime() : null;
  const closure = activeClosure(closures, at);

  let reason = "";
  let reopensAt: string | null = null;
  if (site.status !== "open") reason = "Điểm bán đang tạm đóng.";
  else if (!Boolean(site.acceptsOrders)) reason = "Điểm bán đang tạm ngừng nhận đơn.";
  else if (openedAt !== null && openedAt > at.getTime()) {
    reopensAt = new Date(openedAt).toISOString();
    reason = `Điểm bán chưa mở cửa. Mở từ ${formatReopening(reopensAt, timezone)}.`;
  } else if (closedAt !== null && closedAt <= at.getTime()) reason = "Điểm bán đã đóng cửa.";
  else if (closure) {
    reopensAt = closure.endsAt;
    reason = closure.endsAt
      ? `${closure.reason}. Dự kiến mở lại ${formatReopening(closure.endsAt, timezone)}.`
      : `${closure.reason}. Chưa có thời gian mở lại.`;
  } else if (!hours) reason = "Lịch mở cửa của điểm bán chưa hợp lệ.";
  else if (!scheduleAllows(hours, at, timezone)) {
    reopensAt = nextScheduledOpening(hours, at, timezone);
    reason = reopensAt
      ? `Điểm bán hiện ngoài giờ mở cửa. Mở lại ${formatReopening(reopensAt, timezone)}.`
      : "Điểm bán hiện ngoài giờ mở cửa và chưa có lịch mở lại.";
  }

  return { openNow: !reason, reason, reopensAt };
}

export function openingHoursSummary(openingHoursJson: string) {
  const hours = parseOpeningHours(openingHoursJson);
  if (!hours || Object.keys(hours).length === 0) return "Theo lịch của điểm bán";
  const distinct = [...new Set(Object.values(hours).flat().map(([start, end]) => `${start}–${end}`))];
  return distinct.length === 1 ? distinct[0] : "Giờ mở cửa thay đổi theo ngày";
}
