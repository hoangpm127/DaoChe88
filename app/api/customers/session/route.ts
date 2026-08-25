/**
 * Tài khoản khách: đăng ký và đăng nhập (M11).
 *
 * ==========================================================
 * VÌ SAO TÀI KHOẢN MỚI KHÔNG TỰ NHẬN ĐƠN CŨ CỦA SỐ ĐIỆN THOẠI
 * ==========================================================
 * Chưa có kênh xác minh số điện thoại (eSMS chưa duyệt brandname). Nếu đăng ký
 * xong là thấy ngay mọi đơn từng đặt bằng số đó, thì bất kỳ ai đăng ký bằng số
 * người khác cũng đọc được tên, địa chỉ giao và lịch sử mua của họ.
 *
 * Vì vậy tài khoản mới chỉ thấy đơn đặt TỪ LÚC ĐĂNG NHẬP TRỞ ĐI. Khi bật OTP,
 * xác minh số điện thoại sẽ mở khoá phần lịch sử trước đó.
 *
 * Đây là lệch có chủ đích so với Định nghĩa hoàn thành của M11 ("thấy đủ lịch
 * sử đơn"): giữ nguyên yêu cầu đó khi chưa có xác minh là mở một đường rò rỉ dữ
 * liệu cá nhân.
 */

import { AuthError, createUser, findUserByPhone, recordAuthEvent, verifyCredentials } from "../../../../lib/auth/users.ts";
import { hashIp, issueCustomerSession, revokeSession } from "../../../../lib/auth/sessions.ts";
import { checkRateLimit, clearRateLimit, recordFailure } from "../../../../lib/auth/rate-limit.ts";
import { requireAuthDatabase } from "../../../../lib/auth/database.ts";
import { assertPasswordPolicy, PasswordPolicyError } from "../../../../lib/auth/password.ts";
import {
  clearCustomerSessionCookie,
  customerSessionCookie,
  customerSessionConfigReady,
  readCustomerSessionFrom,
  signCustomerToken,
} from "../../../../lib/customer-session";
import { JsonRequestError, readJsonObject } from "../../../../lib/http-json";
import { normalizeVietnamPhone } from "../../../../lib/phone";
import { orderDataMode } from "../../../../lib/sepay";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store, private, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("vary", "Cookie");
  return Response.json(payload, { status, headers });
}

function clientIp(request: Request) {
  const chain = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
  return (chain?.at(-1) || request.headers.get("x-real-ip") || "unknown").slice(0, 128);
}

export async function GET(request: Request) {
  if (!customerSessionConfigReady()) {
    return json({ ok: false, error: "Chưa cấu hình khóa phiên.", code: "customer_session_not_configured" }, 503);
  }
  const session = await readCustomerSessionFrom(request);
  return json({ ok: true, authenticated: Boolean(session), session });
}

export async function POST(request: Request) {
  if (!customerSessionConfigReady()) {
    return json({ ok: false, error: "Chưa cấu hình khóa phiên.", code: "customer_session_not_configured" }, 503);
  }
  try {
    const payload = await readJsonObject<{ phone?: unknown; password?: unknown; fullName?: unknown; action?: unknown }>(request, 4 * 1024);
    const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const action = payload.action === "register" ? "register" : "login";
    const database = await requireAuthDatabase();

    const ipHash = await hashIp(clientIp(request));
    const keys = [`customer-login:ip:${ipHash}`, ...(phone ? [`customer-login:phone:${phone}`] : [])];
    for (const key of keys) {
      const limit = await checkRateLimit(database, key);
      if (limit.blocked) {
        return json({ ok: false, error: "Đã thử quá nhiều lần. Vui lòng thử lại sau.", code: "login_rate_limited" }, 429, {
          "retry-after": String(limit.retryAfterSeconds),
        });
      }
    }

    if (!phone || !password) {
      return json({ ok: false, error: "Vui lòng nhập số điện thoại và mật khẩu.", code: "missing_credentials" }, 400);
    }

    let userId: string;
    if (action === "register") {
      // Khách tự chọn mật khẩu (không có mật khẩu tạm như nhân viên) nên vẫn
      // phải qua chính sách độ mạnh.
      assertPasswordPolicy(password);
      const existing = await findUserByPhone(database, phone);
      if (existing) {
        return json({ ok: false, error: "Số điện thoại này đã có tài khoản. Vui lòng đăng nhập.", code: "phone_already_registered" }, 409);
      }
      const created = await createUser(database, {
        fullName: typeof payload.fullName === "string" && payload.fullName.trim() ? payload.fullName.trim() : "Khách hàng",
        phone,
        password,
        roles: [{ role: "customer", siteId: null }],
        createdBy: "self-registration",
        mustChangePassword: false,
      });
      userId = created.userId;
      await recordAuthEvent(database, "customer.registered", { userId, ipHash });

      // Gắn tài khoản vào hồ sơ khách hiện có theo số điện thoại, NHƯNG không
      // mở khoá đơn cũ: xem chú thích đầu tệp.
      const linkedAt = new Date().toISOString();
      const phoneE164 = normalizeVietnamPhone(phone);
      const linked = await database
        .prepare("UPDATE customers SET user_id = ?, user_linked_at = ?, updated_at = ? WHERE phone_e164 = ? AND user_id IS NULL")
        .bind(userId, linkedAt, linkedAt, phoneE164)
        .run();

      // Chưa từng đặt đơn thì chưa có hồ sơ nào để gắn — tạo mới.
      //
      // Không có hồ sơ thì khách đăng ký xong KHÔNG lưu được địa chỉ giao hàng:
      // customer_addresses tham chiếu customers(id). Trước đây sổ địa chỉ nằm
      // trong localStorage nên không ai thấy thiếu sót này.
      //
      // Hồ sơ tạo ở đây KHÔNG mở khoá đơn cũ: nó là hồ sơ mới, chưa gắn với đơn
      // nào, nên phần lịch sử vẫn theo đúng quyết định ở đầu tệp.
      if (!linked.meta.changes) {
        await database
          .prepare(`INSERT INTO customers
            (id, display_name, phone_e164, email_normalized, identity_status, status, is_test,
             source_environment, marketing_opt_in, user_id, user_linked_at, created_at, updated_at)
            VALUES (?, ?, ?, '', 'registered', 'active', ?, ?, 0, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING`)
          .bind(
            `customer-${crypto.randomUUID()}`,
            typeof payload.fullName === "string" && payload.fullName.trim() ? payload.fullName.trim() : "Khách hàng",
            phoneE164,
            orderDataMode() === "test" ? 1 : 0,
            orderDataMode() === "test" ? "test" : "live",
            userId,
            linkedAt,
            linkedAt,
            linkedAt,
          )
          .run();
      }
    } else {
      try {
        const user = await verifyCredentials(database, { phone, password });
        userId = user.id;
      } catch (cause) {
        if (!(cause instanceof AuthError)) throw cause;
        for (const key of keys) await recordFailure(database, key);
        await recordAuthEvent(database, "customer.login.failed", { detail: { code: cause.code }, ipHash });
        return json({ ok: false, error: cause.message, code: cause.code }, cause.status);
      }
    }

    const issued = await issueCustomerSession(database, {
      userId,
      deviceLabel: (request.headers.get("user-agent") || "").slice(0, 120),
      ipHash,
    });
    for (const key of keys) await clearRateLimit(database, key);
    await recordAuthEvent(database, "customer.login.success", { userId, ipHash });

    const customers = await queryRows<{ id: string; loyaltyPoints: number; loyaltyTier: string }>(
      database.prepare("SELECT id, loyalty_points, loyalty_tier FROM customers WHERE user_id = ? LIMIT 1").bind(userId),
    );

    return json(
      {
        ok: true,
        authenticated: true,
        session: {
          userName: issued.session.fullName,
          expiresAt: issued.session.expiresAt,
          customerId: customers[0]?.id || null,
          loyaltyPoints: Number(customers[0]?.loyaltyPoints || 0),
          loyaltyTier: customers[0]?.loyaltyTier || "member",
        },
      },
      action === "register" ? 201 : 200,
      { "set-cookie": customerSessionCookie(request, await signCustomerToken(issued.token)) },
    );
  } catch (cause) {
    if (cause instanceof PasswordPolicyError) return json({ ok: false, error: cause.message, code: cause.code }, 400);
    if (cause instanceof JsonRequestError) return json({ ok: false, error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof AuthError) return json({ ok: false, error: cause.message, code: cause.code }, cause.status);
    console.error("Không thể tạo phiên khách.", cause);
    return json({ ok: false, error: "Không thể đăng nhập.", code: "customer_session_failed" }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await readCustomerSessionFrom(request);
    if (session?.sessionId) {
      const database = await requireAuthDatabase();
      await revokeSession(database, session.sessionId);
    }
  } catch {
    // Đăng xuất luôn thành công phía trình duyệt; cookie bị xóa bên dưới.
  }
  return json({ ok: true, authenticated: false }, 200, { "set-cookie": clearCustomerSessionCookie(request) });
}
