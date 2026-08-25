/**
 * Phân bổ tài chính theo chính sách giá.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Toàn bộ là hàm thuần, không
 * chạm database — nhờ vậy kiểm thử được trực tiếp và không tạo vòng phụ thuộc.
 *
 * Tiền luôn là số nguyên VND, tỷ lệ luôn là basis point (10.000 = 100%).
 */

import {
  DEFAULT_POLICY_ID,
  OperationsError,
  type FinanceLedgerEntry,
  type FinanceOrderAllocation,
  type FinancePricePolicy,
  type OperationOrder,
} from "./operations-types.ts";
import { defaultSettingValue } from "./settings-registry.ts";

function defaultAffiliateTier() {
  const tiers = defaultSettingValue<number[]>("commission.affiliate_tiers_bps");
  return tiers[2] ?? tiers.find((tier) => tier > 0) ?? 0;
}

export function iso(offsetMinutes = 0) {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

export function defaultPricePolicy(createdAt = iso(-30 * 24 * 60), updatedAt = iso(-4)): FinancePricePolicy {
  return {
    id: DEFAULT_POLICY_ID,
    name: "Giá chuẩn Đảo Chè · 20/40/60",
    status: "active",
    retailBps: 10_000,
    workshopCostBps: 2_000,
    landedPartnerBps: 4_000,
    channelPoolBps: 6_000,
    defaultAffiliateBps: defaultAffiliateTier(),
    effectiveFrom: "2026-08-01",
    createdAt,
    updatedAt,
  };
}

export function calculateAllocation(
  order: Pick<OperationOrder, "id" | "totalAmount" | "createdAt" | "updatedAt">,
  policy: FinancePricePolicy,
  affiliateBps = 0,
  affiliateCode: string | null = null,
  validAffiliateTiers = defaultSettingValue<number[]>("commission.affiliate_tiers_bps"),
  id = `allocation-${order.id}`,
  workshopCostOverride?: number,
  costSource: "actual" | "estimated" = "estimated",
): FinanceOrderAllocation {
  if (!validAffiliateTiers.includes(affiliateBps)) throw new OperationsError("Bậc Affiliate không thuộc cấu hình đang áp dụng.", 400, "invalid_affiliate_tier");
  const grossRevenue = Math.max(0, Math.round(order.totalAmount));
  const workshopCost = Number.isInteger(workshopCostOverride) && Number(workshopCostOverride) >= 0
    ? Number(workshopCostOverride)
    : Math.round(grossRevenue * policy.workshopCostBps / policy.retailBps);
  const landedPartner = Math.round(grossRevenue * policy.landedPartnerBps / policy.retailBps);
  const partnerLogistics = Math.max(0, landedPartner - workshopCost);
  const channelPool = Math.round(grossRevenue * policy.channelPoolBps / policy.retailBps);
  const affiliateCommission = Math.round(grossRevenue * affiliateBps / policy.retailBps);
  return {
    id,
    orderId: order.id,
    policyId: policy.id,
    status: "posted",
    grossRevenue,
    workshopCost,
    partnerLogistics,
    landedPartner,
    channelPool,
    affiliateCode,
    affiliateBps,
    affiliateCommission,
    channelContribution: Math.max(0, channelPool - affiliateCommission),
    costSource,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function allocationStatusForOrder(order: Pick<OperationOrder, "paymentMethod" | "paymentStatus" | "orderStatus">) {
  if (order.orderStatus === "cancelled") return "voided";
  const paymentMethod = order.paymentMethod || (order.paymentStatus === "cod" ? "cash" : "bank_transfer");
  if (paymentMethod === "bank_transfer") return order.paymentStatus === "paid" ? "posted" : "pending";
  return order.orderStatus === "delivered" ? "posted" : "pending";
}

export function ledgerForAllocation(
  allocation: FinanceOrderAllocation,
  order: Pick<OperationOrder, "id" | "orderCode" | "siteId" | "partnerId" | "orderStatus" | "createdAt">,
): FinanceLedgerEntry[] {
  const base = {
    occurredAt: order.createdAt,
    locationId: order.siteId,
    partnerId: order.partnerId,
    orderId: order.id,
    expenseId: null,
    settlementId: null,
    status: allocation.status,
    referenceCode: order.orderCode,
    createdAt: order.createdAt,
  };
  const rows: FinanceLedgerEntry[] = [
    { ...base, id: `ledger-${order.id}-revenue`, entryType: "retail_revenue", direction: "inflow", amount: allocation.grossRevenue, description: `Doanh thu bán lẻ ${order.orderCode}` },
    { ...base, id: `ledger-${order.id}-workshop`, entryType: "workshop_cost", direction: "outflow", amount: allocation.workshopCost, description: allocation.costSource === "actual" ? "Giá vốn thực theo lô FEFO" : "Giá vốn ước tính; chờ chốt lô khi giao" },
    { ...base, id: `ledger-${order.id}-logistics`, entryType: "partner_logistics", direction: "outflow", amount: allocation.partnerLogistics, description: "Xuất xưởng & ship tới điểm theo chính sách hiện hành" },
    { ...base, id: `ledger-${order.id}-pool`, entryType: "channel_pool", direction: "allocation", amount: allocation.channelPool, description: "Pool cửa hàng, phân phối & Affiliate theo chính sách hiện hành" },
  ];
  if (allocation.affiliateCommission > 0) {
    rows.push({ ...base, status: order.orderStatus === "delivered" ? "earned" : "pending", id: `ledger-${order.id}-affiliate`, entryType: "affiliate_commission", direction: "outflow", amount: allocation.affiliateCommission, description: `Hoa hồng Affiliate ${allocation.affiliateBps / 100}%${allocation.affiliateCode ? ` · ${allocation.affiliateCode}` : ""}` });
  }
  rows.push({ ...base, id: `ledger-${order.id}-contribution`, entryType: "channel_contribution", direction: "allocation", amount: allocation.channelContribution, description: "Biên kênh trước chi phí vận hành" });
  return rows;
}

