import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { resolveSetting } from "./settings-store.ts";
import { OperationsError, type JsonRecord } from "./operations-types.ts";
import { queryRows } from "./operations-sql.ts";

export type DeliveryFeeResolution = {
  fee: number;
  ruleId: string | null;
  ruleType: string;
  distanceMeters: number;
  freeShippingApplied: boolean;
};

type DeliveryFeeRule = {
  id: string;
  siteId: string | null;
  ruleType: "distance" | "order_value" | "time_window";
  minValue: number;
  maxValue: number | null;
  fee: number;
  freeOverAmount: number | null;
  priority: number;
};

export type DeliveryCheckoutQuoteData = {
  siteId: string;
  latitudeE6: number;
  longitudeE6: number;
  distanceMeters: number;
  subtotalAmount: number;
  itemFingerprint: string;
  internalFee: number;
  lalamoveFee: number | null;
  lalamoveQuotationId: string | null;
  quotedFee: number;
  providerPreference: "internal" | "lalamove";
};

function radians(value: number) {
  return value * Math.PI / 180;
}

export function haversineDistanceMeters(originLatitudeE6: number, originLongitudeE6: number, destinationLatitudeE6: number, destinationLongitudeE6: number) {
  for (const [value, limit] of [[originLatitudeE6, 90_000_000], [destinationLatitudeE6, 90_000_000], [originLongitudeE6, 180_000_000], [destinationLongitudeE6, 180_000_000]] as const) {
    if (!Number.isInteger(value) || Math.abs(value) > limit) throw new OperationsError("Tọa độ giao hàng không hợp lệ.", 400, "invalid_delivery_coordinates");
  }
  const lat1 = radians(originLatitudeE6 / 1_000_000);
  const lat2 = radians(destinationLatitudeE6 / 1_000_000);
  const deltaLatitude = lat2 - lat1;
  const deltaLongitude = radians((destinationLongitudeE6 - originLongitudeE6) / 1_000_000);
  const halfChord = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord)));
}

export function assertWithinServiceRadius(distanceMeters: number, serviceRadiusM: number) {
  if (!Number.isSafeInteger(distanceMeters) || distanceMeters < 0) throw new OperationsError("Khoảng cách giao hàng không hợp lệ.", 400, "invalid_delivery_distance");
  if (!Number.isSafeInteger(serviceRadiusM) || serviceRadiusM <= 0 || distanceMeters > serviceRadiusM) {
    throw new OperationsError("Địa chỉ giao nằm ngoài bán kính phục vụ của điểm đã chọn.", 409, "out_of_service_area", { distanceMeters, serviceRadiusM });
  }
}

function minutesAt(at: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(at));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

export async function resolveDeliveryFee(database: RuntimeDatabase, input: { siteId: string; distanceMeters: number; orderValue: number; at: string }): Promise<DeliveryFeeResolution> {
  const rules = await queryRows<DeliveryFeeRule>(database.prepare(`SELECT id, site_id, rule_type, min_value, max_value, fee, free_over_amount, priority
    FROM delivery_fee_rules
    WHERE (site_id IS NULL OR site_id = ?) AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
    ORDER BY priority DESC, CASE WHEN site_id = ? THEN 1 ELSE 0 END DESC, created_at DESC, id DESC`).bind(input.siteId, input.at, input.at, input.siteId));
  const timeValue = minutesAt(input.at);
  const matched = rules.find((rule) => {
    const value = rule.ruleType === "distance" ? input.distanceMeters : rule.ruleType === "order_value" ? input.orderValue : timeValue;
    return value >= Number(rule.minValue) && (rule.maxValue === null || value <= Number(rule.maxValue));
  });
  if (!matched) {
    const [fee, threshold] = await Promise.all([
      resolveSetting<number>(database, "delivery.default_fee_vnd", input.siteId),
      resolveSetting<number>(database, "delivery.free_shipping_threshold_vnd", input.siteId),
    ]);
    return { fee: input.orderValue >= threshold ? 0 : fee, ruleId: null, ruleType: "default", distanceMeters: input.distanceMeters, freeShippingApplied: input.orderValue >= threshold };
  }
  const freeShippingApplied = matched.freeOverAmount !== null && input.orderValue >= Number(matched.freeOverAmount);
  return { fee: freeShippingApplied ? 0 : Number(matched.fee), ruleId: matched.id, ruleType: matched.ruleType, distanceMeters: input.distanceMeters, freeShippingApplied };
}

function stableItems(items: unknown) {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const item = raw && typeof raw === "object" ? raw as JsonRecord : {};
    const optionCodes = Array.isArray(item.optionCodes) ? item.optionCodes.map(String).sort() : [];
    return {
      productCode: String(item.productCode || "").trim().toLocaleUpperCase("en-US"),
      quantity: Number(item.quantity || 0),
      optionCodes,
      topping: String(item.topping || ""),
      sweetness: String(item.sweetness || ""),
      temperature: String(item.temperature || ""),
    };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
}

export async function deliveryItemFingerprint(items: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableItems(items)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseCheckoutQuoteData(value: string): DeliveryCheckoutQuoteData {
  try {
    const parsed = JSON.parse(value) as DeliveryCheckoutQuoteData;
    if (!parsed || !Number.isSafeInteger(parsed.latitudeE6) || !Number.isSafeInteger(parsed.longitudeE6) || !Number.isSafeInteger(parsed.distanceMeters) || !Number.isSafeInteger(parsed.subtotalAmount) || !/^[a-f0-9]{64}$/.test(parsed.itemFingerprint)) throw new Error("invalid");
    const quotedFee = Number.isSafeInteger(parsed.quotedFee) ? parsed.quotedFee : parsed.internalFee;
    if (!Number.isSafeInteger(quotedFee) || quotedFee < 0) throw new Error("invalid");
    return { ...parsed, lalamoveQuotationId: parsed.lalamoveQuotationId || null, quotedFee };
  } catch {
    throw new OperationsError("Dữ liệu báo giá giao hàng bị lỗi.", 500, "corrupt_delivery_quote");
  }
}
