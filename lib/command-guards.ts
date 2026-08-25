/**
 * Kiểm tra quyền và tính hợp lệ trước khi thực thi lệnh vận hành.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Gồm: xác định actor, quy kết
 * Affiliate, chặn chuyển trạng thái sai, và kiểm tra dữ liệu chi phí / chính
 * sách giá.
 *
 * LƯU Ý cho module M1: khi phạm vi dữ liệu chuyển sang đọc từ bảng
 * user_role_assignments, đây là nơi cần sửa cùng với lib/portal-access.ts.
 */

import type { RuntimeDatabase as D1Database } from "../db/runtime-database.ts";
import { getPortalRolePolicy, isPortalRole, portalRoleCan } from "./portal-access.ts";
import { boundedText, readInteger, readIsoDate, readString } from "./command-input.ts";
import { nextOrderState } from "./order-logic.ts";
import { queryRows } from "./operations-sql.ts";
import { defaultSettingValue } from "./settings-registry.ts";
import { resolveSetting } from "./settings-store.ts";
import {
  OperationsError,
  type Actor,
  type CommandPayload,
  type FinanceExpense,
  type FinancePricePolicy,
  type JsonRecord,
  type Location,
  type OperationEvent,
  type OperationOrder,
  type OperationsCommand,
} from "./operations-types.ts";

export function affiliateCodeOf(data: JsonRecord) {
  const rawAffiliateCode = readString(data, "affiliateCode", false).toLocaleUpperCase("en-US");
  if (rawAffiliateCode && !/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(rawAffiliateCode)) {
    throw new OperationsError("Mã Affiliate không hợp lệ.", 400, "invalid_affiliate_code");
  }
  return rawAffiliateCode || null;
}

export type ResolvedAffiliate = { affiliateCode: string | null; affiliateBps: number; affiliateId: string | null };

export async function affiliateForDatabase(d1: D1Database, data: JsonRecord, dataMode: string): Promise<ResolvedAffiliate> {
  const affiliateCode = affiliateCodeOf(data);
  if (!affiliateCode) return { affiliateCode: null, affiliateBps: 0, affiliateId: null };
  const rows = await queryRows<{ affiliateId: string; commissionBps: number; codeIsTest: number; memberIsTest: number; phone: string; email: string }>(d1.prepare(`SELECT
      c.affiliate_id AS affiliate_id,
      m.commission_bps AS commission_bps,
      c.is_test AS code_is_test,
      m.is_test AS member_is_test,
      m.phone,
      m.email
    FROM affiliate_codes c
    JOIN affiliate_members m ON m.id = c.affiliate_id
    WHERE c.code = ? AND c.status = 'active' AND m.status = 'active'
    LIMIT 1`).bind(affiliateCode));
  const affiliate = rows[0];
  if (!affiliate || (dataMode !== "test" && (Boolean(affiliate.codeIsTest) || Boolean(affiliate.memberIsTest)))) {
    throw new OperationsError("Mã Affiliate chưa được kích hoạt.", 400, "affiliate_code_not_active");
  }
  const customerPhone = readString(data, "customerPhone", false).replace(/[\s.-]/g, "");
  const customerEmail = readString(data, "customerEmail", false).toLocaleLowerCase("en-US");
  if ((customerPhone && affiliate.phone && customerPhone === affiliate.phone.replace(/[\s.-]/g, "")) || (customerEmail && affiliate.email && customerEmail === affiliate.email.toLocaleLowerCase("en-US"))) {
    throw new OperationsError("Mã Affiliate không áp dụng cho đơn của chính chủ mã.", 409, "affiliate_self_referral");
  }
  const affiliateBps = affiliate.commissionBps;
  const affiliateTiers = await resolveSetting<number[]>(d1, "commission.affiliate_tiers_bps");
  if (!affiliateTiers.includes(affiliateBps)) throw new OperationsError("Bậc Affiliate không thuộc cấu hình đang áp dụng.", 400, "invalid_affiliate_tier");
  return { affiliateCode, affiliateBps, affiliateId: affiliate.affiliateId };
}

export function affiliateForMemory(data: JsonRecord, dataMode: string): ResolvedAffiliate {
  const affiliateCode = affiliateCodeOf(data);
  if (!affiliateCode) return { affiliateCode: null, affiliateBps: 0, affiliateId: null };
  const demoCodes: Record<string, { affiliateId: string; affiliateBps: number; isTest: boolean }> = {
    HA88: { affiliateId: "affiliate-test-ha88", affiliateBps: 800, isTest: true },
    "AFF-MAIANH": { affiliateId: "affiliate-seed-maianh", affiliateBps: 600, isTest: true },
    "AFF-PRODUCT22": { affiliateId: "affiliate-seed-product22", affiliateBps: 800, isTest: true },
    "AFF-MOC": { affiliateId: "affiliate-seed-moc", affiliateBps: 1000, isTest: true },
    "AFF-THUTRANG": { affiliateId: "affiliate-seed-thutrang", affiliateBps: 800, isTest: true },
  };
  const affiliate = demoCodes[affiliateCode];
  if (!affiliate || (dataMode !== "test" && affiliate.isTest)) {
    throw new OperationsError("Mã Affiliate chưa được kích hoạt.", 400, "affiliate_code_not_active");
  }
  return { affiliateCode, affiliateBps: affiliate.affiliateBps, affiliateId: affiliate.affiliateId };
}

export function actorOf(payload: CommandPayload): Actor {
  const role = payload.actor?.role?.trim();
  if (role !== "customer" && !isPortalRole(role)) throw new OperationsError("Thiếu phiên hoặc vai trò vận hành hợp lệ.", 401, "portal_session_required");
  const fallbackName = role === "customer" ? "Khách hàng Tào Phớ 88" : getPortalRolePolicy(role).actorName;
  return {
    role,
    name: payload.actor?.name?.trim() || fallbackName,
    userId: payload.actor?.userId?.trim() || undefined,
    scope: payload.actor?.scope ?? null,
  };
}

export function operationEvent(entityType: string, entityId: string, action: string, actor: Actor, fromState: string | null, toState: string | null, payload: JsonRecord = {}): OperationEvent {
  return {
    id: crypto.randomUUID(),
    entityType,
    entityId,
    action,
    actorRole: actor.role,
    actorName: actor.name,
    fromState,
    toState,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
  };
}



export function assertActor(actor: Actor, allowed: string[], action: string) {
  if (!allowed.includes(actor.role)) throw new OperationsError(`Vai trò ${actor.role} không được phép ${action}.`, 403, "forbidden_role");
}

export function assertCommandPermission(actor: Actor, command: OperationsCommand, data: JsonRecord) {
  if (command === "order.create") {
    if (actor.role !== "customer") throw new OperationsError("Đơn khách hàng phải đi qua luồng đặt món công khai.", 403, "forbidden_role");
    return;
  }
  if (!isPortalRole(actor.role) || !portalRoleCan(actor.role, command)) {
    throw new OperationsError(`Vai trò ${actor.role} không được phép thực hiện ${command}.`, 403, "forbidden_role");
  }
  if (actor.role === "control" && command === "finance.settle") {
    const reference = readString(data, "settlementId", false) || readString(data, "ledgerId", false) || readString(data, "entryId", false);
    if (!reference) throw new OperationsError("Kiểm soát nội bộ chỉ được duyệt/đối chiếu giao dịch đã có, không được tạo giao dịch nguồn.", 403, "control_source_transaction_forbidden");
  }
}

export function assertOrderTransition(actor: Actor, order: OperationOrder, nextStatus: string) {
  if (nextStatus === "delivery_failed") {
    if (!["shipper", "store-owner"].includes(actor.role)) {
      throw new OperationsError("Chỉ shipper hoặc chủ cửa hàng được báo giao thất bại.", 403, "forbidden_delivery_failure");
    }
    if (!['assigned', 'picked_up', 'delivering'].includes(order.orderStatus)) {
      throw new OperationsError("Chỉ đơn đang trong quá trình giao mới được báo thất bại.", 409, "invalid_delivery_failure_state");
    }
    return;
  }
  const sequential = nextOrderState(order.orderStatus, order.fulfillmentType);
  if (nextStatus === "cancelled") {
    if (!["manager", "region-manager", "super-admin", "store-owner", "owner"].includes(actor.role)) {
      throw new OperationsError("Chỉ quản lý được phép hủy đơn.", 403, "forbidden_order_cancellation");
    }
    if (!["new", "accepted"].includes(order.orderStatus)) {
      throw new OperationsError("Đơn đã vào khâu chuẩn bị nên cần quy trình xử lý riêng.", 409, "order_already_in_preparation");
    }
    if (["paid", "partially_paid", "overpaid"].includes(order.paymentStatus)) {
      throw new OperationsError("Đơn đã nhận tiền; cần hoàn tiền trước khi hủy.", 409, "refund_required");
    }
    return;
  }
  if (actor.role === "shipper") {
    const allowed: Record<string, string> = { assigned: "picked_up", picked_up: "delivering", delivering: "delivered" };
    if (allowed[order.orderStatus] !== nextStatus) throw new OperationsError("Shipper chỉ được quét nhận, bắt đầu giao và xác nhận giao xong theo thứ tự.", 403, "forbidden_order_transition");
    return;
  }
  if (["store", "kitchen", "distribution", "manager", "store-staff", "store-owner"].includes(actor.role)) {
    if (order.fulfillmentType === "pickup" && order.orderStatus === "ready" && nextStatus === "delivered" && ["store", "distribution", "manager", "store-staff", "store-owner"].includes(actor.role)) return;
    if (!["new", "accepted", "preparing"].includes(order.orderStatus) || sequential !== nextStatus) {
      throw new OperationsError("Vai trò này chỉ được chuyển đơn tuần tự từ nhận đơn tới sẵn sàng.", 403, "forbidden_order_transition");
    }
    return;
  }
  if (sequential !== nextStatus) throw new OperationsError("Đơn chỉ được chuyển sang bước kế tiếp.", 409, "invalid_order_transition");
}

export function expenseData(data: JsonRecord, actor: Actor, now: string, allowedCategories = defaultSettingValue<string[]>("finance.expense_categories")) {
  const category = readString(data, "category");
  if (!allowedCategories.includes(category)) throw new OperationsError("Nhóm chi phí không hợp lệ.", 400, "invalid_expense_category");
  const description = readString(data, "description");
  if (description.length > 240) throw new OperationsError("Mô tả chi phí tối đa 240 ký tự.", 400, "description_too_long");
  const amount = readInteger(data, "amount", { min: 1, max: 500_000_000 });
  const id = readString(data, "expenseId", false) || crypto.randomUUID();
  return {
    id,
    expenseCode: readString(data, "expenseCode", false) || `CP-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(Date.now()).slice(-4)}`,
    siteId: readString(data, "siteId", false) || readString(data, "locationId"),
    category,
    description,
    amount,
    expenseDate: readIsoDate({ ...data, expenseDate: readString(data, "expenseDate", false) || readString(data, "occurredAt", false) } as JsonRecord, "expenseDate", new Date().toISOString().slice(0, 10)),
    vendor: readString(data, "vendor", false),
    receiptUrl: readString(data, "receiptUrl", false) || readString(data, "receiptReference", false),
    status: "pending",
    submittedBy: readString(data, "submittedBy", false) || actor.name,
    approvedBy: null,
    approvedAt: null,
    note: readString(data, "note", false),
    createdAt: now,
    updatedAt: now,
  } satisfies FinanceExpense;
}

export function canSubmitExpense(actor: Actor, site: Location) {
  if (actor.role === "super-admin" || actor.role === "owner") return true;
  if (["store", "manager"].includes(actor.role)) return site.kind.startsWith("official");
  if (actor.role === "kitchen") return site.kind === "central-kitchen";
  if (actor.role === "distribution") return site.kind === "partner-counter";
  // Vai trò chuẩn theo điểm: điểm nào cũng được, miễn là nơi bán hàng. Việc điểm
  // đó có thuộc phạm vi của người này không thì siteIsInPortalScope đã kiểm ngay
  // trước lời gọi này — không kiểm lại ở đây để tránh hai luật lệch nhau.
  if (["store-owner", "store-staff"].includes(actor.role)) {
    return site.kind.startsWith("official") || site.kind === "partner-counter";
  }
  return false;
}

export function validatePricePolicy(data: JsonRecord, now: string, affiliateTiers = defaultSettingValue<number[]>("commission.affiliate_tiers_bps")): FinancePricePolicy {
  const retailBps = data.retailBps === undefined ? 10_000 : readInteger(data, "retailBps", { min: 10_000, max: 10_000 });
  const workshopCostBps = data.workshopCostBps === undefined ? 2_000 : readInteger(data, "workshopCostBps", { min: 0, max: 10_000 });
  const landedPartnerBps = data.landedPartnerBps === undefined ? 4_000 : readInteger(data, "landedPartnerBps", { min: workshopCostBps, max: 10_000 });
  const channelPoolBps = data.channelPoolBps === undefined ? retailBps - landedPartnerBps : readInteger(data, "channelPoolBps", { min: 0, max: 10_000 });
  const configuredDefault = affiliateTiers[2] ?? affiliateTiers.find((tier) => tier > 0) ?? 0;
  const defaultAffiliateBps = data.defaultAffiliateBps === undefined ? configuredDefault : readInteger(data, "defaultAffiliateBps", { min: 0, max: 2_000 });
  if (landedPartnerBps + channelPoolBps !== retailBps) throw new OperationsError("Giá giao tới điểm và pool kênh phải cộng đủ 100% giá bán lẻ.", 400, "invalid_price_waterfall");
  if (!affiliateTiers.includes(defaultAffiliateBps)) throw new OperationsError("Bậc Affiliate mặc định không thuộc cấu hình đang áp dụng.", 400, "invalid_affiliate_tier");
  return {
    id: readString(data, "policyId", false) || `policy-${Date.now()}`,
    name: readString(data, "name", false) || "Chính sách giá Tào Phớ 88",
    status: "active",
    retailBps,
    workshopCostBps,
    landedPartnerBps,
    channelPoolBps,
    defaultAffiliateBps,
    effectiveFrom: readIsoDate(data, "effectiveFrom", new Date().toISOString().slice(0, 10)),
    createdAt: now,
    updatedAt: now,
  };
}

