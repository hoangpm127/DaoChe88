/**
 * Chi trả hoa hồng theo lô (M6).
 *
 * Gom các khoản `earned` trong một kỳ thành một lô, xuất file chuyển khoản hàng
 * loạt cho ngân hàng, rồi đánh dấu đã trả kèm mã giao dịch.
 *
 * BA CHỐT CHỐNG TRẢ HAI LẦN, xếp từ ngoài vào trong:
 *   1. Chỉ gom khoản đang ở trạng thái `earned` (đã giao xong, hết hạn khiếu nại).
 *   2. Bỏ qua khoản đã nằm trong một lô khác.
 *   3. Chỉ mục duy nhất payout_items.referral_id — chốt thật ở tầng database,
 *      hai request song song vẫn chỉ ghi được một dòng.
 * Chốt 1 và 2 chỉ để báo lỗi cho dễ hiểu; chốt 3 mới là thứ ngăn mất tiền.
 */

import type { RuntimeDatabase } from "./db-types.ts";
import { queryRows } from "./operations-sql.ts";
import { OperationsError } from "./operations-error.ts";

/** Ngưỡng khấu trừ thuế TNCN cho hoa hồng chi trả một lần, theo quy định hiện hành. */
export const TAX_WITHHOLDING_THRESHOLD_VND = 2_000_000;
export const TAX_WITHHOLDING_RATE_BPS = 1_000; // 10%

export type PayoutCounterparty = "affiliate" | "group_host" | "partner" | "store";

/**
 * Thuế TNCN khấu trừ tại nguồn.
 *
 * Chi trả từ 2 triệu đồng trở lên cho cá nhân không ký hợp đồng lao động phải
 * khấu trừ 10%. Đây là nghĩa vụ của bên chi trả, không phải tùy chọn — nên tính
 * ở đây thay vì để kế toán nhớ trừ tay từng dòng.
 */
export function taxWithheldFor(grossAmount: number): number {
  if (grossAmount < TAX_WITHHOLDING_THRESHOLD_VND) return 0;
  return Math.floor((grossAmount * TAX_WITHHOLDING_RATE_BPS) / 10_000);
}

type PendingRow = {
  referralId: string;
  referrerId: string;
  commissionAmount: number;
  displayName: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
};

/**
 * Tạo lô chi trả cho một kỳ.
 *
 * Gom theo TỪNG NGƯỜI NHẬN, không phải từng đơn: ngân hàng chuyển một lần cho
 * một tài khoản, và ngưỡng khấu trừ thuế cũng tính trên tổng một lần chi trả.
 */
export async function createPayoutBatch(
  database: RuntimeDatabase,
  input: {
    counterpartyType: PayoutCounterparty;
    periodStart: string;
    periodEnd: string;
    createdBy: string;
    now: string;
  },
): Promise<{ batchId: string; batchCode: string; entryCount: number; totalAmount: number; taxWithheld: number }> {
  const rows = await queryRows<PendingRow>(
    database
      .prepare(
        `SELECT r.id AS referral_id, r.referrer_id, r.commission_amount,
                m.display_name, m.payout_bank_code AS bank_code,
                m.payout_account_number AS account_number, m.payout_account_name AS account_name
         FROM order_referrals r
         LEFT JOIN affiliate_members m ON m.id = r.referrer_id
         WHERE r.referrer_type = ? AND r.status = 'earned'
           AND r.earned_at >= ? AND r.earned_at <= ?
           AND NOT EXISTS (SELECT 1 FROM payout_items p WHERE p.referral_id = r.id)
         ORDER BY r.referrer_id, r.earned_at`,
      )
      .bind(input.counterpartyType, input.periodStart, input.periodEnd),
  );

  if (!rows.length) {
    throw new OperationsError("Kỳ này không có hoa hồng nào đủ điều kiện chi trả.", 409, "payout_nothing_to_pay");
  }

  const batchId = `payout-${crypto.randomUUID()}`;
  const batchCode = `CT-${input.periodStart.slice(0, 10).replace(/-/g, "")}-${batchId.slice(-6).toLocaleUpperCase("en-US")}`;

  const byRecipient = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const list = byRecipient.get(row.referrerId) || [];
    list.push(row);
    byRecipient.set(row.referrerId, list);
  }

  let totalAmount = 0;
  let totalTax = 0;
  const statements = [
    database
      .prepare(
        `INSERT INTO payout_batches (id, batch_code, counterparty_type, period_start, period_end,
           total_amount, tax_withheld, entry_count, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'draft', ?, ?, ?)`,
      )
      .bind(batchId, batchCode, input.counterpartyType, input.periodStart, input.periodEnd, input.createdBy, input.now, input.now),
  ];

  for (const [recipientId, entries] of byRecipient) {
    const gross = entries.reduce((sum, entry) => sum + Number(entry.commissionAmount), 0);
    const tax = taxWithheldFor(gross);
    const net = gross - tax;
    totalAmount += net;
    totalTax += tax;

    const first = entries[0];
    // Một dòng chi trả cho mỗi khoản hoa hồng, để truy ngược được về đơn; số
    // tiền thực chuyển đặt ở dòng đầu của người đó.
    for (const [index, entry] of entries.entries()) {
      statements.push(
        database
          .prepare(
            `INSERT INTO payout_items (id, batch_id, referral_id, recipient_id, recipient_name,
               gross_amount, tax_withheld, amount, bank_code, account_number, account_name, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          )
          .bind(
            `payout-item-${crypto.randomUUID()}`,
            batchId,
            entry.referralId,
            recipientId,
            first.displayName || "",
            Number(entry.commissionAmount),
            index === 0 ? tax : 0,
            index === 0 ? net : Number(entry.commissionAmount),
            first.bankCode || "",
            first.accountNumber || "",
            first.accountName || "",
            input.now,
          ),
      );
    }
  }

  statements.push(
    database
      .prepare("UPDATE payout_batches SET total_amount = ?, tax_withheld = ?, entry_count = ?, updated_at = ? WHERE id = ?")
      .bind(totalAmount, totalTax, rows.length, input.now, batchId),
  );

  await database.batch(statements);
  return { batchId, batchCode, entryCount: rows.length, totalAmount, taxWithheld: totalTax };
}

/** Escape một ô CSV. Tên người có thể chứa dấu phẩy. */
function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Xuất file chuyển khoản hàng loạt.
 *
 * Dùng BOM UTF-8 vì kế toán mở bằng Excel; thiếu BOM là tên tiếng Việt vỡ hết
 * và người ta sẽ sửa tay từng dòng trước khi tải lên ngân hàng.
 */
export async function exportPayoutBatchCsv(database: RuntimeDatabase, batchId: string): Promise<string> {
  const items = await queryRows<{
    recipientName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    amount: number;
    taxWithheld: number;
    grossAmount: number;
  }>(
    database
      .prepare(
        `SELECT recipient_id, recipient_name, bank_code, account_number, account_name,
                SUM(amount) AS amount, SUM(tax_withheld) AS tax_withheld, SUM(gross_amount) AS gross_amount
         FROM payout_items WHERE batch_id = ?
         GROUP BY recipient_id, recipient_name, bank_code, account_number, account_name
         ORDER BY recipient_name`,
      )
      .bind(batchId),
  );

  const headers = ["so_tai_khoan", "ten_tai_khoan", "ma_ngan_hang", "so_tien", "noi_dung", "hoa_hong_goc", "thue_khau_tru"];
  const lines = [headers.join(",")];
  for (const item of items) {
    lines.push([
      csvCell(item.accountNumber),
      csvCell(item.accountName || item.recipientName),
      csvCell(item.bankCode),
      csvCell(item.amount),
      csvCell(`Hoa hong Tao Pho 88`),
      csvCell(item.grossAmount),
      csvCell(item.taxWithheld),
    ].join(","));
  }
  return `﻿${lines.join("\n")}\n`;
}

/**
 * Đánh dấu lô đã chuyển tiền.
 *
 * Chuyển hoa hồng sang `paid` — từ đây không được void nữa kể cả khi đơn bị hủy,
 * vì tiền đã rời tài khoản; trường hợp đó phải thu hồi bằng bút toán riêng.
 */
export async function markPayoutBatchPaid(
  database: RuntimeDatabase,
  input: { batchId: string; providerReference: string; now: string },
): Promise<{ items: number }> {
  const batches = await queryRows<{ id: string; status: string }>(
    database.prepare("SELECT id, status FROM payout_batches WHERE id = ? LIMIT 1").bind(input.batchId),
  );
  const batch = batches[0];
  if (!batch) throw new OperationsError("Không tìm thấy lô chi trả.", 404, "payout_batch_not_found");
  if (batch.status === "paid") throw new OperationsError("Lô này đã được đánh dấu đã trả.", 409, "payout_batch_already_paid");

  const referralIds = await queryRows<{ referralId: string }>(
    database.prepare("SELECT referral_id FROM payout_items WHERE batch_id = ? AND referral_id IS NOT NULL").bind(input.batchId),
  );

  await database.batch([
    database
      .prepare("UPDATE payout_batches SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ? AND status <> 'paid'")
      .bind(input.now, input.now, input.batchId),
    database
      .prepare("UPDATE payout_items SET status = 'paid', provider_reference = ? WHERE batch_id = ?")
      .bind(input.providerReference.slice(0, 120), input.batchId),
    ...referralIds.map((row) =>
      database
        .prepare("UPDATE order_referrals SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'earned'")
        .bind(input.now, row.referralId),
    ),
  ]);

  return { items: referralIds.length };
}
