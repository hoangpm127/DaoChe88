import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { queryRows } from "./operations-sql.ts";
import { evaluateSiteAvailability, openingHoursSummary, type SiteClosureWindow } from "./site-hours.ts";

type PublicSiteRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
  address: string;
  district: string;
  phone: string;
  latitudeE6: number | null;
  longitudeE6: number | null;
  openingHoursJson: string;
  serviceRadiusM: number;
  fulfillmentJson: string;
  acceptsOrders: number | boolean;
  timezone: string;
  openedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
};

export type PublicSite = {
  id: string;
  code: string;
  name: string;
  kind: string;
  address: string;
  district: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  openingHours: Record<string, Array<[string, string]>>;
  hoursLabel: string;
  fulfillment: string[];
  serviceRadiusM: number;
  openNow: boolean;
  closureReason: string;
  reopensAt: string | null;
  distanceMeters: number | null;
  etaMinutes: number | null;
  updatedAt: string;
};

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseHours(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, Array<[string, string]>>
      : {};
  } catch {
    return {};
  }
}

function distanceMeters(originLatitude: number, originLongitude: number, latitude: number, longitude: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(latitude - originLatitude);
  const longitudeDelta = radians(longitude - originLongitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(originLatitude)) * Math.cos(radians(latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
}

export async function listPublicSites(
  database: RuntimeDatabase,
  options: { latitude?: number; longitude?: number; at?: Date } = {},
) {
  const at = options.at || new Date();
  const rows = await queryRows<PublicSiteRow>(database.prepare(`SELECT id, code, name, kind, status, address, district, phone,
    latitude_e6, longitude_e6, opening_hours_json, service_radius_m, fulfillment_json,
    accepts_orders, timezone, opened_at, closed_at, updated_at
    FROM operation_sites
    WHERE status = 'open' AND kind IN ('official-store', 'official-express', 'partner-counter')
    ORDER BY kind, name`));
  const closureRows = await queryRows<SiteClosureWindow & { siteId: string }>(database.prepare(`SELECT site_id, reason, starts_at, ends_at
    FROM site_closures WHERE starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`
  ).bind(at.toISOString(), at.toISOString()));
  const closuresBySite = new Map<string, SiteClosureWindow[]>();
  for (const closure of closureRows) closuresBySite.set(closure.siteId, [...(closuresBySite.get(closure.siteId) || []), closure]);

  const hasOrigin = Number.isFinite(options.latitude) && Number.isFinite(options.longitude);
  const sites: PublicSite[] = rows.map((row) => {
    const latitude = row.latitudeE6 === null ? null : row.latitudeE6 / 1_000_000;
    const longitude = row.longitudeE6 === null ? null : row.longitudeE6 / 1_000_000;
    const distance = hasOrigin && latitude !== null && longitude !== null
      ? distanceMeters(options.latitude!, options.longitude!, latitude, longitude)
      : null;
    const availability = evaluateSiteAvailability(row, closuresBySite.get(row.id) || [], at);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      address: row.address,
      district: row.district,
      phone: row.phone,
      latitude,
      longitude,
      openingHours: parseHours(row.openingHoursJson),
      hoursLabel: openingHoursSummary(row.openingHoursJson),
      fulfillment: parseStringArray(row.fulfillmentJson),
      serviceRadiusM: row.serviceRadiusM,
      openNow: availability.openNow,
      closureReason: availability.reason,
      reopensAt: availability.reopensAt,
      distanceMeters: distance,
      etaMinutes: distance === null ? null : Math.max(10, Math.ceil(10 + distance / 1_000 * 3)),
      updatedAt: row.updatedAt,
    };
  });
  return sites.sort((left, right) => {
    if (left.distanceMeters !== null && right.distanceMeters !== null) return left.distanceMeters - right.distanceMeters;
    if (left.distanceMeters !== null) return -1;
    if (right.distanceMeters !== null) return 1;
    return left.name.localeCompare(right.name, "vi");
  });
}
