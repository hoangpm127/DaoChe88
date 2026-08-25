import type { StorePoint } from "../data/stores";
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

export const distanceBetweenCoordinates = (origin: string, destination: string) => {
  const [originLatitude, originLongitude] = origin.split(",").map((value) => Number(value.trim()));
  const [destinationLatitude, destinationLongitude] = destination.split(",").map((value) => Number(value.trim()));

  if (![originLatitude, originLongitude, destinationLatitude, destinationLongitude].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(destinationLatitude - originLatitude);
  const longitudeDelta = toRadians(destinationLongitude - originLongitude);
  const originLatitudeRadians = toRadians(originLatitude);
  const destinationLatitudeRadians = toRadians(destinationLatitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitudeRadians) * Math.cos(destinationLatitudeRadians) * Math.sin(longitudeDelta / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

export const nearestStoreForCoordinates = (stores: StorePoint[], coordinates: string) => {
  const withCoordinates = stores.filter((store) => store.coordinates);
  if (!withCoordinates.length) return stores[0] || null;
  if (!coordinates) return withCoordinates[0];
  return withCoordinates.reduce((nearest, store) =>
    distanceBetweenCoordinates(coordinates, store.coordinates) < distanceBetweenCoordinates(coordinates, nearest.coordinates)
      ? store
      : nearest,
  );
};
