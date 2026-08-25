import type { RuntimeDatabase } from "../db/runtime-database.ts";
import type { PortalSession } from "./portal-session.ts";
import { OperationsError } from "./operations-error.ts";

export async function recordPiiAccess(
  database: RuntimeDatabase,
  request: Request,
  session: PortalSession,
  input: { accessType: "list" | "detail" | "export"; entityType: string; entityId?: string; filters?: Record<string, unknown>; rowCount: number },
) {
  const requestId = request.headers.get("x-request-id")?.trim().slice(0, 100) || crypto.randomUUID();
  await database.prepare(`INSERT INTO pii_access_log
    (id, request_id, actor_user_id, actor_role, access_type, entity_type, entity_id, filter_json, row_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      requestId,
      session.userId,
      session.role,
      input.accessType,
      input.entityType,
      input.entityId || "",
      JSON.stringify(input.filters || {}),
      Math.max(0, Math.floor(input.rowCount)),
      new Date().toISOString(),
    )
    .run();
}

export async function anonymizeCustomer(database: RuntimeDatabase, customerId: string, actor: PortalSession, requestId = "") {
  const customerResult = await database.prepare("SELECT id, user_id FROM customers WHERE id = ? LIMIT 1").bind(customerId).first<Record<string, unknown>>();
  const customer = customerResult as Record<string, unknown> | null;
  if (!customer) throw new OperationsError("Không tìm thấy hồ sơ khách hàng.", 404, "customer_not_found");
  const userId = typeof customer.user_id === "string" ? customer.user_id : "";
  const now = new Date().toISOString();
  const anonymousEmail = `anon-${customerId.replace(/[^a-zA-Z0-9]/g, "").slice(-32)}@redacted.invalid`;
  const statements = [
    database.prepare(`UPDATE customers SET display_name = 'Khách đã ẩn danh', phone_e164 = '', email_normalized = ?,
      identity_status = 'anonymized', status = 'deleted', marketing_opt_in = 0, marketing_consent_at = NULL,
      deleted_at = ?, updated_at = ? WHERE id = ?`).bind(anonymousEmail, now, now, customerId),
    database.prepare(`UPDATE operation_orders SET customer_name = 'Khách đã ẩn danh', customer_phone = '', customer_email = '',
      delivery_address = '', delivery_latitude_e6 = NULL, delivery_longitude_e6 = NULL,
      delivery_otp_code = '', note = '', updated_at = ? WHERE customer_id = ?`).bind(now, customerId),
    database.prepare(`UPDATE order_fulfillment_details SET recipient_name = 'Khách đã ẩn danh', recipient_phone = '',
      formatted_address = '', address_line1 = '', ward = '', district = '', city = '', latitude_e6 = NULL,
      longitude_e6 = NULL, delivery_instructions = '', updated_at = ? WHERE customer_id = ?`).bind(now, customerId),
    database.prepare("DELETE FROM customer_addresses WHERE customer_id = ?").bind(customerId),
    database.prepare("UPDATE product_reviews SET comment = '', photo_url = '', reply = '', replied_by = NULL WHERE customer_id = ?").bind(customerId),
    database.prepare("UPDATE privacy_consents SET revoked_at = COALESCE(revoked_at, ?) WHERE customer_id = ?").bind(now, customerId),
    database.prepare(`INSERT INTO operation_event_log
      (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
      VALUES (?, 'customer', ?, 'customer.anonymize', ?, ?, 'active', 'anonymized', ?, ?)`)
      .bind(crypto.randomUUID(), customerId, actor.role, actor.fullName, JSON.stringify({ actorUserId: actor.userId, requestId }), now),
  ];
  if (userId) {
    const anonymousUserEmail = `anon-${userId.replace(/[^a-zA-Z0-9]/g, "").slice(-32)}@redacted.invalid`;
    statements.push(
      database.prepare(`UPDATE users SET phone_e164 = '', email = ?, full_name = 'Tài khoản đã ẩn danh', status = 'left',
        password_hash = '', password_salt = '', password_iterations = 0, phone_verified = 0, updated_at = ? WHERE id = ?`)
        .bind(anonymousUserEmail, now, userId),
      database.prepare("UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?").bind(now, userId),
    );
  }
  await database.batch(statements);
  return { customerId, userId: userId || null, anonymizedAt: now };
}
