import { actionHubVerses } from "../data/content";

export function pickDailyActionHubVerse() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dateKey = Number(`${values.year}${values.month}${values.day}`);
  return actionHubVerses[dateKey % actionHubVerses.length];
}

export const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value)}đ`;

export const promisedAtFromSlot = (createdAt: string, slot: string) => {
  const fallback = new Date(new Date(createdAt).getTime() + 30 * 60_000);
  const match = /^(\d{1,2}):(\d{2})$/.exec(slot.trim());
  if (!match) return fallback.toISOString();
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback.toISOString();
  const promisedAt = new Date(createdAt);
  promisedAt.setHours(hours, minutes, 0, 0);
  if (promisedAt.getTime() < new Date(createdAt).getTime() - 5 * 60_000) promisedAt.setDate(promisedAt.getDate() + 1);
  return promisedAt.toISOString();
};
