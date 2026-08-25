/**
 * Lệnh đối tác, nhân sự và Affiliate.
 *
 * LƯU Ý cho M6 (affiliate) và M2 (nhân sự): đây là nơi thêm lệnh mới.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Các khối lệnh được DI CHUYỂN
 * nguyên văn, không sửa logic. Mọi cơ chế khóa lạc quan (UPDATE ... WHERE
 * updated_at = ? rồi kiểm meta.changes) giữ nguyên.
 */

import type { RuntimeDatabase as D1Database } from "../db/runtime-database.ts";
import { handleNetworkCommands } from "./network-commands.ts";
import { autoDispatchLalamoveIfNeeded, coordinatesToE6 } from "./delivery-store.ts";
import { loadCatalog, loadSiteAvailability } from "./catalog-store.ts";
import {
  fulfillmentSnapshotStatement,
  normalizeCustomerEmail,
  normalizeVietnamPhone,
  prepareCustomerRecord,
  PRODUCTION_DATA_SCHEMA_VERSION,
} from "./data-integrity.ts";
import { createSePayPaymentAttempt, orderDataMode, publicSePayPayment } from "./sepay.ts";
import { createUser, findUserByPhone } from "./auth/users.ts";
import { boundedText, readInteger, readIsoDate, readString } from "./command-input.ts";
import {
  actorOf,
  affiliateCodeOf,
  affiliateForDatabase,
  assertActor,
  assertOrderTransition,
  canSubmitExpense,
  expenseData,
  operationEvent,
  validatePricePolicy,
} from "./command-guards.ts";
import {
  createOrderIdentity,
  createTrackingToken,
  deliveryFeeFor,
  deliveryForOrder,
  hashTrackingToken,
  kitchenForOrder,
  nextOrderState,
  orderItemsFrom,
  paymentMethodFrom,
} from "./order-logic.ts";
import {
  allocationStatusForOrder,
  calculateAllocation,
  defaultPricePolicy,
  iso,
  ledgerForAllocation,
} from "./finance-allocation.ts";
import { eventStatement, ledgerStatement, queryRows } from "./operations-sql.ts";
import { actorPolicy, assertEntityScope, orderIsInPortalScope, siteIsInPortalScope, inventoryIsInPortalScope, memberIsInPortalScope, partnerIsInPortalScope, alertIsInPortalScope } from "./operations-snapshot.ts";
import { resolveSetting } from "./settings-store.ts";
import { isPortalRole } from "./portal-access.ts";
import {
  duplicateClientReferenceError,
  memberStatuses,
  OperationsError,
  orderStatuses,
  partnerStages,
  partnerStatuses,
  settlementStatuses,
  type Actor,
  type Alert,
  type FinanceExpense,
  type FinanceLedgerEntry,
  type FinanceOrderAllocation,
  type FinancePricePolicy,
  type FinanceSettlement,
  type InventoryItem,
  type JsonRecord,
  type Location,
  type Member,
  type OperationOrder,
  type OperationsCommand,
  type Partner,
  type PaymentRefund,
} from "./operations-types.ts";

/** Ngữ cảnh dùng chung cho mọi handler — đúng các biến mà executeD1 vốn tạo sẵn. */
export type CommandContext = {
  command: OperationsCommand;
  actor: Actor;
  data: JsonRecord;
  now: string;
};

/** Trả kết quả nếu lệnh thuộc miền này, ngược lại trả null để router thử handler kế tiếp. */
export async function handlePartnerCommands(d1: D1Database, context: CommandContext) {
  const { command, actor, data, now } = context;

  const networkResult = await handleNetworkCommands(d1, context);
  if (networkResult) return networkResult;

  if (command === "affiliate.approve") {
    const reference = readString(data, "affiliateId", false) || readString(data, "requestId", false);
    if (!reference) throw new OperationsError("Thiếu hồ sơ Affiliate cần duyệt.", 400, "missing_affiliate_reference");
    const members = await queryRows<{
      id: string;
      sourceRequestId: string | null;
      displayName: string;
      phone: string;
      status: string;
      isTest: number;
    }>(d1.prepare("SELECT id, source_request_id, display_name, phone, status, is_test FROM affiliate_members WHERE id = ? OR source_request_id = ? LIMIT 1").bind(reference, reference));
    const member = members[0];
    if (!member) throw new OperationsError("Không tìm thấy hồ sơ Affiliate.", 404, "affiliate_not_found");
    if (["rejected", "paused"].includes(member.status)) throw new OperationsError("Hồ sơ Affiliate đang bị khóa và cần mở lại trước khi duyệt.", 409, "affiliate_not_approvable");
    const requestedCode = readString(data, "code", false);
    const generatedCode = `TP88-${member.phone.replace(/\D/g, "").slice(-4) || "AFF"}-${member.id.replace(/[^a-z0-9]/gi, "").slice(-4)}`;
    const code = affiliateCodeOf({ affiliateCode: requestedCode || generatedCode })!;
    const affiliateTiers = await resolveSetting<number[]>(d1, "commission.affiliate_tiers_bps");
    const configuredDefault = affiliateTiers[2] ?? affiliateTiers.find((tier) => tier > 0) ?? 0;
    const commissionBps = data.commissionBps === undefined ? configuredDefault : readInteger(data, "commissionBps", { min: 0, max: 2_000 });
    if (!affiliateTiers.includes(commissionBps) || commissionBps === 0) throw new OperationsError("Bậc Affiliate không thuộc cấu hình đang áp dụng.", 400, "invalid_affiliate_tier");
    const codeRows = await queryRows<{ affiliateId: string; status: string }>(d1.prepare("SELECT affiliate_id, status FROM affiliate_codes WHERE code = ? LIMIT 1").bind(code));
    if (codeRows[0] && codeRows[0].affiliateId !== member.id) throw new OperationsError("Mã Affiliate này đã thuộc về hồ sơ khác.", 409, "affiliate_code_conflict");
    if (member.status === "active" && codeRows[0]?.status === "active") return { command, affiliateId: member.id, code, status: "active", duplicate: true };
    const payoutBankCode = boundedText(data, "payoutBankCode", 30, false);
    const payoutAccountNumber = boundedText(data, "payoutAccountNumber", 40, false).replace(/\s/g, "");
    const payoutAccountName = boundedText(data, "payoutAccountName", 100, false).toLocaleUpperCase("vi-VN");
    const event = operationEvent("affiliate", member.id, command, actor, member.status, "active", { code, commissionBps, requestId: member.sourceRequestId });
    await d1.batch([
      d1.prepare(`UPDATE affiliate_members SET status = 'active', commission_bps = ?, payout_bank_code = ?, payout_account_number = ?, payout_account_name = ?, approved_at = COALESCE(approved_at, ?), updated_at = ? WHERE id = ?`).bind(commissionBps, payoutBankCode, payoutAccountNumber, payoutAccountName, now, now, member.id),
      // `affiliate_codes.affiliate_id` phải ghi rõ tên bảng: trong mệnh đề WHERE của
      // ON CONFLICT DO UPDATE, PostgreSQL thấy cả hàng đang có lẫn hàng `excluded`
      // nên tên cột trần là nhập nhằng ("column reference is ambiguous"). SQLite
      // chấp nhận nên lỗi này nằm im cho tới khi test chạy trên PostgreSQL.
      d1.prepare(`INSERT INTO affiliate_codes (code, affiliate_id, status, is_test, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET status = 'active', updated_at = excluded.updated_at WHERE affiliate_codes.affiliate_id = excluded.affiliate_id`).bind(code, member.id, Boolean(member.isTest), now, now),
      ...(member.sourceRequestId ? [
        d1.prepare("UPDATE inbound_requests SET status = 'approved', updated_at = ? WHERE id = ?").bind(now, member.sourceRequestId),
        d1.prepare("UPDATE operation_alerts SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE entity_type = 'inbound-request' AND entity_id = ?").bind(now, now, member.sourceRequestId),
      ] : []),
      eventStatement(d1, event),
    ]);
    // Cấp tài khoản đăng nhập cho cộng tác viên nếu chưa có.
    //
    // KHÔNG có OTP ở đợt này (brandname eSMS chưa duyệt) nên dùng SĐT + mật khẩu
    // tạm giống nhân viên; họ buộc đổi ở lần đăng nhập đầu. Thiếu số điện thoại
    // thì không tạo tài khoản — người không định danh được thì sau này cũng
    // không biết chuyển tiền hoa hồng cho ai.
    let temporaryPassword: string | null = null;
    if (member.phone) {
      const existing = await findUserByPhone(d1, member.phone);
      if (existing) {
        await d1.prepare("UPDATE affiliate_members SET user_id = ?, updated_at = ? WHERE id = ?")
          .bind(existing.id, now, member.id).run();
      } else {
        const created = await createUser(d1, {
          fullName: member.displayName,
          phone: member.phone,
          roles: [{ role: "affiliate", siteId: null }],
          createdBy: actor.name,
        });
        temporaryPassword = created.temporaryPassword;
        await d1.prepare("UPDATE affiliate_members SET user_id = ?, updated_at = ? WHERE id = ?")
          .bind(created.userId, now, member.id).run();
      }
    }

    return { command, affiliateId: member.id, code, commissionBps, status: "active", ...(temporaryPassword ? { temporaryPassword } : {}) };
  }

  if (command === "affiliate.pause") {
    const reference = readString(data, "affiliateId", false) || readString(data, "code", false).toLocaleUpperCase("en-US");
    if (!reference) throw new OperationsError("Thiếu Affiliate cần tạm dừng.", 400, "missing_affiliate_reference");
    const members = await queryRows<{ id: string; status: string }>(d1.prepare(`SELECT m.id, m.status FROM affiliate_members m LEFT JOIN affiliate_codes c ON c.affiliate_id = m.id WHERE m.id = ? OR c.code = ? LIMIT 1`).bind(reference, reference));
    const member = members[0];
    if (!member) throw new OperationsError("Không tìm thấy Affiliate.", 404, "affiliate_not_found");
    if (member.status === "paused") return { command, affiliateId: member.id, status: "paused", duplicate: true };
    const event = operationEvent("affiliate", member.id, command, actor, member.status, "paused", { reason: boundedText(data, "reason", 300, false) });
    await d1.batch([
      d1.prepare("UPDATE affiliate_members SET status = 'paused', updated_at = ? WHERE id = ?").bind(now, member.id),
      d1.prepare("UPDATE affiliate_codes SET status = 'paused', updated_at = ? WHERE affiliate_id = ?").bind(now, member.id),
      eventStatement(d1, event),
    ]);
    return { command, affiliateId: member.id, status: "paused" };
  }


  if (command === "partner.advance") {
    const partnerId = readString(data, "partnerId");
    const rows = await queryRows<Partner>(d1.prepare("SELECT * FROM operation_partners WHERE id = ? LIMIT 1").bind(partnerId));
    const partner = rows[0];
    if (!partner) throw new OperationsError("Không tìm thấy đối tác.", 404, "partner_not_found");
    assertEntityScope(actor, partnerIsInPortalScope(actorPolicy(actor), partner), "hồ sơ đối tác");
    const currentIndex = partnerStages.indexOf(partner.onboardingStage as (typeof partnerStages)[number]);
    const nextStage = readString(data, "nextStage", false) || partnerStages[Math.min(Math.max(currentIndex + 1, 0), partnerStages.length - 1)];
    if (!partnerStages.includes(nextStage as (typeof partnerStages)[number])) throw new OperationsError("Bước tiếp nhận đối tác không hợp lệ.");
    const suggestedStatus = nextStage === "live" ? "active" : partner.status === "lead" ? "onboarding" : partner.status;
    const nextStatus = readString(data, "nextStatus", false) || suggestedStatus;
    if (!partnerStatuses.has(nextStatus)) throw new OperationsError("Trạng thái đối tác không hợp lệ.");
    const event = operationEvent("partner", partnerId, command, actor, `${partner.status}/${partner.onboardingStage}`, `${nextStatus}/${nextStage}`);
    await d1.batch([
      d1.prepare("UPDATE operation_partners SET status = ?, onboarding_stage = ?, updated_at = ? WHERE id = ?").bind(nextStatus, nextStage, now, partnerId),
      eventStatement(d1, event),
    ]);
    return { command, partnerId, status: nextStatus, onboardingStage: nextStage };
  }

  if (command === "member.toggle") {
    const memberId = readString(data, "memberId");
    const rows = await queryRows<Member>(d1.prepare("SELECT * FROM operation_staff WHERE id = ? LIMIT 1").bind(memberId));
    const member = rows[0];
    if (!member) throw new OperationsError("Không tìm thấy thành viên.", 404, "member_not_found");
    assertEntityScope(actor, memberIsInPortalScope(actorPolicy(actor), member), "nhân sự");
    const requestedStatus = readString(data, "nextStatus", false) || readString(data, "state", false);
    const nextStatus = requestedStatus === "online" ? "available" : requestedStatus || (member.status === "offline" ? "available" : "offline");
    if (!memberStatuses.has(nextStatus)) throw new OperationsError("Trạng thái thành viên không hợp lệ.");
    const event = operationEvent("member", memberId, command, actor, member.status, nextStatus);
    await d1.batch([
      d1.prepare("UPDATE operation_staff SET status = ?, current_task = ?, updated_at = ? WHERE id = ?").bind(nextStatus, nextStatus === "offline" ? "Ngoài ca" : readString(data, "currentTask", false) || member.currentTask, now, memberId),
      eventStatement(d1, event),
    ]);
    return { command, memberId, status: nextStatus };
  }


  return null;
}
