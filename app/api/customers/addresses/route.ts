/**
 * Sổ địa chỉ giao hàng của khách (M11).
 *
 * ==========================================================================
 * VÌ SAO CẦN ĐƯỜNG NÀY
 * ==========================================================================
 * Bảng customer_addresses có từ M11 và /api/customers/me đã ĐỌC được nó, nhưng
 * không có đường nào GHI. Hệ quả: sổ địa chỉ trong giao diện khách chỉ nằm
 * trong localStorage của trình duyệt.
 *
 * Ba hậu quả cụ thể của việc đó:
 *   - Khách đổi máy là mất hết địa chỉ đã lưu.
 *   - Dữ liệu cũ từ bản demo nằm lại trong trình duyệt và sống mãi, kể cả sau
 *     khi mã nguồn đã gỡ sạch.
 *   - Khoảng cách và thời gian giao phải lưu dạng chuỗi, không ai tính lại, nên
 *     sai ngay khi khách sửa địa chỉ.
 *
 * Bản ghi cũ có thể chưa có toạ độ và vẫn được đọc để fallback theo văn bản.
 * Bản ghi mới bắt buộc có ghim bản đồ để khoảng cách và điểm bán được tính thật.
 */

import { readCustomerSessionFrom } from "../../../../lib/customer-session";
import { requireAuthDatabase } from "../../../../lib/auth/database.ts";
import { JsonRequestError, readJsonObject } from "../../../../lib/http-json";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

const MAX_ADDRESSES = 20;

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

type Row = {
  id: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  formattedAddress: string;
  instructions: string;
  isDefault: number | boolean;
  latitudeE6: number | null;
  longitudeE6: number | null;
};

function present(row: Row) {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName || "",
    recipientPhone: row.recipientPhone || "",
    address: row.formattedAddress,
    instructions: row.instructions || "",
    isDefault: row.isDefault === true || row.isDefault === 1,
    latitude: row.latitudeE6 === null ? null : row.latitudeE6 / 1e6,
    longitude: row.longitudeE6 === null ? null : row.longitudeE6 / 1e6,
  };
}

/** Hồ sơ khách gắn với phiên. Không nhận customerId từ client. */
async function customerFor(request: Request) {
  const session = await readCustomerSessionFrom(request);
  if (!session) return { error: json({ ok: false, error: "Cần đăng nhập.", code: "customer_session_required" }, 401) };
  const database = await requireAuthDatabase();
  const rows = await queryRows<{ id: string }>(
    database.prepare("SELECT id FROM customers WHERE user_id = ? LIMIT 1").bind(session.userId),
  );
  if (!rows[0]) return { error: json({ ok: false, error: "Tài khoản chưa gắn hồ sơ khách.", code: "customer_profile_missing" }, 404) };
  return { database, customerId: rows[0].id };
}

async function listFor(database: Awaited<ReturnType<typeof requireAuthDatabase>>, customerId: string) {
  const rows = await queryRows<Row>(
    database.prepare(`SELECT id, label, recipient_name, recipient_phone, formatted_address,
        instructions, is_default, latitude_e6, longitude_e6
      FROM customer_addresses WHERE customer_id = ?
      ORDER BY is_default DESC, created_at DESC`).bind(customerId),
  );
  return rows.map(present);
}

export async function GET(request: Request) {
  try {
    const context = await customerFor(request);
    if ("error" in context) return context.error;
    return json({ ok: true, addresses: await listFor(context.database, context.customerId) });
  } catch (error) {
    console.error("Không thể tải sổ địa chỉ.", error);
    return json({ ok: false, error: "Không tải được sổ địa chỉ.", code: "addresses_failed" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const context = await customerFor(request);
    if ("error" in context) return context.error;
    const { database, customerId } = context;

    const payload = await readJsonObject<Record<string, unknown>>(request, 8 * 1024);
    const label = String(payload.label || "").trim().slice(0, 60);
    const address = String(payload.address || "").trim().slice(0, 300);
    const instructions = String(payload.instructions || "").trim().slice(0, 300);
    if (!label) return json({ ok: false, error: "Cần đặt tên cho địa điểm.", code: "label_required" }, 400);
    if (address.length < 8) return json({ ok: false, error: "Địa chỉ quá ngắn, cần đủ số nhà và đường.", code: "address_too_short" }, 400);

    // Địa chỉ mới luôn phải mang một ghim thật. Dữ liệu cũ chưa có toạ độ vẫn
    // đọc được và dùng fallback văn bản, nhưng không tạo thêm bản ghi mơ hồ.
    const rawLat = payload.latitude;
    const rawLng = payload.longitude;
    if (rawLat === undefined || rawLat === null || rawLng === undefined || rawLng === null) {
      return json({ ok: false, error: "Hãy ghim vị trí giao hàng trên bản đồ Hà Nội.", code: "address_coordinates_required" }, 400);
    }
    const latitude = Number(rawLat);
    const longitude = Number(rawLng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < 20.5 || latitude > 21.5 || longitude < 105.2 || longitude > 106.2) {
      return json({ ok: false, error: "Toạ độ phải nằm trong phạm vi Hà Nội.", code: "invalid_coordinates" }, 400);
    }
    const latitudeE6 = Math.round(latitude * 1e6);
    const longitudeE6 = Math.round(longitude * 1e6);

    const existing = await queryRows<{ count: number }>(
      database.prepare("SELECT COUNT(*) AS count FROM customer_addresses WHERE customer_id = ?").bind(customerId),
    );
    if (Number(existing[0]?.count || 0) >= MAX_ADDRESSES) {
      return json({ ok: false, error: `Mỗi tài khoản lưu tối đa ${MAX_ADDRESSES} địa chỉ.`, code: "address_limit_reached" }, 409);
    }

    const now = new Date().toISOString();
    const id = `addr-${crypto.randomUUID()}`;
    const makeDefault = payload.isDefault === true || Number(existing[0]?.count || 0) === 0;

    const statements = [
      database.prepare(`INSERT INTO customer_addresses
        (id, customer_id, label, recipient_name, recipient_phone, formatted_address,
         ward, district, city, instructions, is_default, latitude_e6, longitude_e6, created_at, updated_at)
        VALUES (?, ?, ?, '', '', ?, '', '', '', ?, ?, ?, ?, ?, ?)`)
        .bind(id, customerId, label, address, instructions, makeDefault ? 1 : 0, latitudeE6, longitudeE6, now, now),
    ];
    // Chỉ một địa chỉ được làm mặc định: hạ cờ của các địa chỉ khác trong cùng
    // giao dịch, nếu không khách sẽ thấy hai địa chỉ cùng đánh dấu mặc định.
    if (makeDefault) {
      statements.push(
        database.prepare("UPDATE customer_addresses SET is_default = 0, updated_at = ? WHERE customer_id = ? AND id <> ?")
          .bind(now, customerId, id),
      );
    }
    await database.batch(statements);

    return json({ ok: true, addresses: await listFor(database, customerId) }, 201);
  } catch (error) {
    if (error instanceof JsonRequestError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể lưu địa chỉ.", error);
    return json({ ok: false, error: "Không lưu được địa chỉ.", code: "address_save_failed" }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await customerFor(request);
    if ("error" in context) return context.error;
    const { database, customerId } = context;

    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id) return json({ ok: false, error: "Thiếu mã địa chỉ.", code: "address_id_required" }, 400);

    // Ràng buộc customer_id trong câu WHERE, không chỉ id: thiếu nó thì đổi một
    // chuỗi trên URL là xoá được địa chỉ của người khác.
    const result = await database
      .prepare("DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?")
      .bind(id, customerId)
      .run();
    if (!result.meta.changes) return json({ ok: false, error: "Không tìm thấy địa chỉ.", code: "address_not_found" }, 404);

    return json({ ok: true, addresses: await listFor(database, customerId) });
  } catch (error) {
    console.error("Không thể xoá địa chỉ.", error);
    return json({ ok: false, error: "Không xoá được địa chỉ.", code: "address_delete_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, POST, DELETE, OPTIONS", "cache-control": "no-store" } });
}
