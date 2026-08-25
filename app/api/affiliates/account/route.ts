/**
 * Tài khoản cộng tác viên: hoa hồng của CHÍNH mình (M6).
 *
 * ==========================================================================
 * VÌ SAO ĐƯỜNG NÀY THAY CHO /api/affiliates/status
 * ==========================================================================
 * Đường cũ đọc hồ sơ theo `?request=…&token=…` trên URL, và token nằm trong
 * localStorage. Hệ quả:
 *   - Ai có link là xem được toàn bộ hoa hồng, không cần mật khẩu.
 *   - Không thu hồi được: link đã lộ thì lộ vĩnh viễn.
 *   - Đổi máy hoặc xoá dữ liệu trình duyệt là mất tài khoản.
 *
 * Đường này đọc theo PHIÊN ĐĂNG NHẬP. Không nhận affiliateId từ client: hồ sơ
 * luôn suy ra từ phiên, vì nhận id từ client nghĩa là đổi một con số trên URL
 * là xem được hoa hồng người khác.
 *
 * Trả về đúng hình dạng mà giao diện đang dùng, để việc chuyển đổi không phải
 * sửa lại component.
 */

import { readAffiliateSessionFrom } from "../../../../lib/affiliate-session";
import { ensureOperationsSchema } from "../../../../lib/operations-store";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, private, max-age=0",
      "content-type": "application/json; charset=utf-8",
      vary: "Cookie",
    },
  });
}

export async function GET(request: Request) {
  try {
    const session = await readAffiliateSessionFrom(request);
    if (!session) return json({ ok: false, error: "Cần đăng nhập cộng tác viên.", code: "affiliate_session_required" }, 401);

    const database = await ensureOperationsSchema();
    const members = await queryRows<{
      id: string;
      displayName: string;
      status: string;
      commissionBps: number;
      approvedAt: string | null;
      code: string | null;
    }>(
      database.prepare(`SELECT m.id, m.display_name, m.status, m.commission_bps, m.approved_at, c.code
        FROM affiliate_members m
        LEFT JOIN affiliate_codes c ON c.affiliate_id = m.id AND c.status = 'active'
        WHERE m.user_id = ? LIMIT 1`).bind(session.userId),
    );
    const member = members[0];
    if (!member) return json({ ok: false, error: "Tài khoản chưa gắn hồ sơ cộng tác viên.", code: "affiliate_profile_missing" }, 404);

    const code = member.code || "";
    const summaryRows = code
      ? await queryRows<Record<string, number>>(database.prepare(`SELECT
          COUNT(DISTINCT a.order_id) AS order_count,
          COALESCE(SUM(a.gross_revenue), 0) AS sales_amount,
          COALESCE(SUM(a.affiliate_commission), 0) AS commission_amount,
          COALESCE(SUM(CASE WHEN l.status IN ('earned', 'approved') THEN l.amount ELSE 0 END), 0) AS available_amount,
          COALESCE(SUM(CASE WHEN l.status = 'pending' THEN l.amount ELSE 0 END), 0) AS pending_amount,
          COALESCE(SUM(CASE WHEN l.status = 'paid' THEN l.amount ELSE 0 END), 0) AS paid_amount
        FROM finance_order_allocations a
        LEFT JOIN finance_ledger_entries l ON l.order_id = a.order_id AND l.entry_type = 'affiliate_commission'
        WHERE a.affiliate_code = ?`).bind(code))
      : [];
    const summary = summaryRows[0];

    // Lịch sử từng đơn: cộng tác viên phải đối chiếu được số tổng với từng đơn,
    // nếu không thì con số tổng chỉ là niềm tin.
    const recent = code
      ? await queryRows<Record<string, unknown>>(database.prepare(`SELECT o.order_code, o.order_status,
          a.gross_revenue, a.affiliate_commission,
          COALESCE(l.status, 'pending') AS commission_status, o.created_at
        FROM finance_order_allocations a
        JOIN operation_orders o ON o.id = a.order_id
        LEFT JOIN finance_ledger_entries l ON l.order_id = a.order_id AND l.entry_type = 'affiliate_commission'
        WHERE a.affiliate_code = ? ORDER BY o.created_at DESC LIMIT 20`).bind(code))
      : [];

    return json({
      ok: true,
      affiliate: {
        displayName: member.displayName,
        status: member.status,
        commissionBps: Number(member.commissionBps || 0),
        approvedAt: member.approvedAt || null,
        code: code || null,
        summary: {
          orderCount: Number(summary?.orderCount || 0),
          salesAmount: Number(summary?.salesAmount || 0),
          commissionAmount: Number(summary?.commissionAmount || 0),
          availableAmount: Number(summary?.availableAmount || 0),
          pendingAmount: Number(summary?.pendingAmount || 0),
          paidAmount: Number(summary?.paidAmount || 0),
        },
        recent: recent.map((row) => ({
          orderCode: row.orderCode,
          orderStatus: row.orderStatus,
          salesAmount: Number(row.grossRevenue || 0),
          commissionAmount: Number(row.affiliateCommission || 0),
          commissionStatus: row.commissionStatus,
          createdAt: row.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error("Không thể tải tài khoản cộng tác viên.", error);
    return json({ ok: false, error: "Không tải được dữ liệu.", code: "affiliate_account_failed" }, 500);
  }
}
