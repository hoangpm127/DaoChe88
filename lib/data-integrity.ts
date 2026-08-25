import type { RuntimeDatabase, RuntimePreparedStatement } from "../db/runtime-database.ts";
import { schemaIsManagedByMigrations } from "../db/runtime-database.ts";

export const PRODUCTION_DATA_SCHEMA_VERSION = 18;
export const POSTGRES_MIGRATION_VERSION = 116;

// Định nghĩa duy nhất nằm ở lib/phone.ts; re-export để code cũ không phải sửa.
export { normalizeVietnamPhone } from "./phone.ts";
import { normalizeVietnamPhone } from "./phone.ts";

type CustomerRecordInput = {
  displayName: string;
  phone: string;
  email: string;
  sourceEnvironment: "test" | "live";
  occurredAt: string;
};

type ExistingCustomer = { id: string; phone_e164: string; email_normalized: string; source_environment: string };
type CustomerLookup = { byPhone: Map<string, ExistingCustomer>; byEmail: Map<string, ExistingCustomer> };

export type FulfillmentSnapshotInput = {
  orderId: string;
  customerId: string | null;
  fulfillmentType: "delivery" | "pickup" | "dine-in";
  recipientName: string;
  recipientPhone: string;
  formattedAddress: string;
  addressLine1: string;
  ward: string;
  district: string;
  city: string;
  countryCode: string;
  latitudeE6: number | null;
  longitudeE6: number | null;
  pickupSiteName: string;
  pickupSiteAddress: string;
  pickupSitePhone: string;
  deliveryInstructions: string;
  occurredAt: string;
};

type LegacyOrderRow = {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_id: string | null;
  delivery_address: string;
  delivery_latitude_e6: number | null;
  delivery_longitude_e6: number | null;
  fulfillment_type: string;
  source_environment: string;
  is_test: number;
  note: string;
  order_status: string;
  created_at: string;
  updated_at: string;
  site_name: string;
  site_address: string;
  site_phone: string;
};

export type CoreDataIntegrity = {
  ok: boolean;
  violations: {
    orderAmounts: number;
    orderItems: number;
    orphanOrderItems: number;
    paymentAttempts: number;
    orphanPayments: number;
    customerLinks: number;
    fulfillmentSnapshots: number;
    stock: number;
    financeLinks: number;
    lotBalances: number;
    internalAccountBalances: number;
    actualCogsLinks: number;
  };
  totalViolations: number;
};

const initializedDatabases = new WeakSet<object>();



export function normalizeCustomerEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

async function stableCustomerId(sourceEnvironment: string, identity: string) {
  const bytes = new TextEncoder().encode(`daoche:${sourceEnvironment}:${identity}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `customer-${hash.slice(0, 32)}`;
}


export async function prepareCustomerRecord(database: RuntimeDatabase, input: CustomerRecordInput, lookup?: CustomerLookup) {
  const phoneE164 = normalizeVietnamPhone(input.phone);
  const emailNormalized = normalizeCustomerEmail(input.email);
  if (!phoneE164 && !emailNormalized) return { customerId: null, statements: [] as RuntimePreparedStatement[] };

  const identity = phoneE164 ? `phone:${phoneE164}` : `email:${emailNormalized}`;
  const deterministicId = await stableCustomerId(input.sourceEnvironment, identity);
  const existing = lookup
    ? (phoneE164 ? lookup.byPhone.get(`${input.sourceEnvironment}:${phoneE164}`) : undefined)
      || (emailNormalized ? lookup.byEmail.get(`${input.sourceEnvironment}:${emailNormalized}`) : undefined)
    : (await database.prepare(`SELECT id, phone_e164, email_normalized, source_environment FROM customers
        WHERE source_environment = ? AND status = 'active'
          AND ((? <> '' AND phone_e164 = ?) OR (? <> '' AND email_normalized = ?))
        ORDER BY CASE WHEN phone_e164 = ? AND ? <> '' THEN 0 ELSE 1 END, created_at ASC
        LIMIT 1`)
      .bind(input.sourceEnvironment, phoneE164, phoneE164, emailNormalized, emailNormalized, phoneE164, phoneE164)
      .all<ExistingCustomer>()).results?.[0];
  const customerId = existing?.id || deterministicId;
  if (lookup && !existing) {
    const indexed = { id: customerId, phone_e164: phoneE164, email_normalized: emailNormalized, source_environment: input.sourceEnvironment };
    if (phoneE164) lookup.byPhone.set(`${input.sourceEnvironment}:${phoneE164}`, indexed);
    if (emailNormalized) lookup.byEmail.set(`${input.sourceEnvironment}:${emailNormalized}`, indexed);
  }
  const statement = existing
    ? database.prepare(`UPDATE customers SET
        display_name = ?,
        phone_e164 = CASE WHEN phone_e164 = '' AND NOT EXISTS (
          SELECT 1 FROM customers other WHERE other.id != customers.id AND other.source_environment = customers.source_environment AND other.status = 'active' AND other.phone_e164 = ? AND ? <> ''
        ) THEN ? ELSE phone_e164 END,
        email_normalized = CASE WHEN email_normalized = '' AND NOT EXISTS (
          SELECT 1 FROM customers other WHERE other.id != customers.id AND other.source_environment = customers.source_environment AND other.status = 'active' AND other.email_normalized = ? AND ? <> ''
        ) THEN ? ELSE email_normalized END,
        last_order_at = ?, updated_at = ?
      WHERE id = ? AND source_environment = ?`)
      .bind(input.displayName, phoneE164, phoneE164, phoneE164, emailNormalized, emailNormalized, emailNormalized, input.occurredAt, input.occurredAt, customerId, input.sourceEnvironment)
    : database.prepare(`INSERT INTO customers
        (id, display_name, phone_e164, email_normalized, identity_status, status, is_test, source_environment, marketing_opt_in, first_order_at, last_order_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'guest', 'active', ?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        phone_e164 = CASE WHEN customers.phone_e164 = '' THEN excluded.phone_e164 ELSE customers.phone_e164 END,
        email_normalized = CASE WHEN customers.email_normalized = '' THEN excluded.email_normalized ELSE customers.email_normalized END,
        last_order_at = excluded.last_order_at,
        updated_at = excluded.updated_at`)
      .bind(customerId, input.displayName, phoneE164, emailNormalized, input.sourceEnvironment === "test" ? 1 : 0, input.sourceEnvironment, input.occurredAt, input.occurredAt, input.occurredAt, input.occurredAt);

  return { customerId, statements: [statement] };
}

export function fulfillmentSnapshotStatement(database: RuntimeDatabase, input: FulfillmentSnapshotInput) {
  return database.prepare(`INSERT INTO order_fulfillment_details
    (order_id, customer_id, fulfillment_type, recipient_name, recipient_phone, formatted_address, address_line1, ward, district, city, country_code, latitude_e6, longitude_e6, pickup_site_name, pickup_site_address, pickup_site_phone, delivery_instructions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.orderId,
      input.customerId,
      input.fulfillmentType,
      input.recipientName,
      normalizeVietnamPhone(input.recipientPhone),
      input.formattedAddress,
      input.addressLine1,
      input.ward,
      input.district,
      input.city,
      input.countryCode,
      input.latitudeE6,
      input.longitudeE6,
      input.pickupSiteName,
      input.pickupSiteAddress,
      normalizeVietnamPhone(input.pickupSitePhone),
      input.deliveryInstructions,
      input.occurredAt,
      input.occurredAt,
    );
}

/**
 * Vá dữ liệu cho đơn đã có: tạo hồ sơ khách và bản ghi chi tiết giao nhận.
 *
 * Thuần thao tác DỮ LIỆU, không có một câu DDL nào — nên chạy được trên cả hai
 * phương ngữ. Trước đây nó chỉ được gọi bên trong ensureProductionDataSchema,
 * mà hàm đó return sớm trên PostgreSQL; hệ quả là đơn nạp từ dữ liệu mồi thiếu
 * order_fulfillment_details và healthcheck báo not_ready.
 */
export async function backfillExistingOrders(database: RuntimeDatabase) {
  const [result, existingCustomers] = await Promise.all([
    database.prepare(`SELECT
      o.id, o.customer_name, o.customer_phone, o.customer_email, o.customer_id,
      o.delivery_address, o.delivery_latitude_e6, o.delivery_longitude_e6,
      o.fulfillment_type, o.source_environment, o.is_test, o.note, o.order_status,
      o.created_at, o.updated_at,
      COALESCE(s.name, '') AS site_name,
      COALESCE(s.address, '') AS site_address,
      COALESCE(s.phone, '') AS site_phone
    FROM operation_orders o
    LEFT JOIN operation_sites s ON s.id = o.site_id
    ORDER BY o.created_at ASC`).all<LegacyOrderRow>(),
    database.prepare(`SELECT id, phone_e164, email_normalized, source_environment
      FROM customers WHERE status = 'active' ORDER BY created_at ASC`).all<ExistingCustomer>(),
  ]);

  const lookup: CustomerLookup = { byPhone: new Map(), byEmail: new Map() };
  for (const customer of existingCustomers.results || []) {
    if (customer.phone_e164) lookup.byPhone.set(`${customer.source_environment}:${customer.phone_e164}`, customer);
    if (customer.email_normalized) lookup.byEmail.set(`${customer.source_environment}:${customer.email_normalized}`, customer);
  }

  const statements: RuntimePreparedStatement[] = [];
  for (const order of result.results || []) {
    const sourceEnvironment = order.source_environment === "live" ? "live" : "test";
    const customer = await prepareCustomerRecord(database, {
      displayName: order.customer_name,
      phone: order.customer_phone || "",
      email: order.customer_email || "",
      sourceEnvironment,
      occurredAt: order.updated_at || order.created_at,
    }, lookup);
    statements.push(...customer.statements);
    if (customer.customerId && !order.customer_id) {
      statements.push(database.prepare("UPDATE operation_orders SET customer_id = ? WHERE id = ? AND customer_id IS NULL").bind(customer.customerId, order.id));
    }
    statements.push(database.prepare(`INSERT OR IGNORE INTO order_fulfillment_details
      (order_id, customer_id, fulfillment_type, recipient_name, recipient_phone, formatted_address, address_line1, ward, district, city, country_code, latitude_e6, longitude_e6, pickup_site_name, pickup_site_address, pickup_site_phone, delivery_instructions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '', 'VN', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        order.id,
        customer.customerId || order.customer_id,
        order.fulfillment_type === "pickup" || order.fulfillment_type === "dine-in" ? order.fulfillment_type : "delivery",
        order.customer_name,
        normalizeVietnamPhone(order.customer_phone || ""),
        order.delivery_address,
        order.delivery_address,
        order.delivery_latitude_e6,
        order.delivery_longitude_e6,
        order.site_name,
        order.site_address,
        normalizeVietnamPhone(order.site_phone || ""),
        order.note || "",
        order.created_at,
        order.updated_at,
      ));
  }
  if (statements.length) await database.batch(statements);
}


export async function ensureProductionDataSchema(_database: RuntimeDatabase) {
  // VỎ RỖNG CÓ CHỦ ĐÍCH — 11 bảng và các câu vá dữ liệu ở đây đều nằm sau chốt
  // `schemaIsManagedByMigrations`, nên CHƯA TỪNG CHẠY trên production.
  //
  // Phần vá dữ liệu thật sự cần thiết đã được tách ra thành hàm xuất riêng
  // `backfillExistingOrders`, gọi được trên cả hai phương ngữ.
  return _database;
}

async function violationCount(database: RuntimeDatabase, query: string) {
  return Number(await database.prepare(query).first("count")) || 0;
}

export async function checkCoreDataIntegrity(database: RuntimeDatabase): Promise<CoreDataIntegrity> {
  await ensureProductionDataSchema(database);
  const [orderAmounts, orderItems, orphanOrderItems, paymentAttempts, orphanPayments, customerLinks, fulfillmentSnapshots, stock, financeLinks, lotBalances, internalAccountBalances, actualCogsLinks] = await Promise.all([
    violationCount(database, `SELECT COUNT(*) AS count FROM operation_orders
      WHERE subtotal_amount < 0 OR delivery_fee_amount < 0 OR discount_amount < 0
        OR total_amount != subtotal_amount + delivery_fee_amount - discount_amount
        OR item_count <= 0 OR source_environment NOT IN ('test', 'live')
        OR is_test != CASE WHEN source_environment = 'test' THEN 1 ELSE 0 END`),
    violationCount(database, `SELECT COUNT(*) AS count FROM operation_order_items
      WHERE quantity <= 0 OR base_unit_price < 0 OR options_unit_price < 0
        OR unit_price != base_unit_price + options_unit_price OR line_total != unit_price * quantity`),
    violationCount(database, "SELECT COUNT(*) AS count FROM operation_order_items i LEFT JOIN operation_orders o ON o.id = i.order_id WHERE o.id IS NULL"),
    violationCount(database, "SELECT COUNT(*) AS count FROM payment_attempts WHERE expected_amount <= 0 OR received_amount < 0 OR currency != 'VND'"),
    violationCount(database, "SELECT COUNT(*) AS count FROM payment_attempts p LEFT JOIN operation_orders o ON o.id = p.order_id WHERE o.id IS NULL"),
    violationCount(database, `SELECT COUNT(*) AS count FROM operation_orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.customer_id IS NOT NULL AND (c.id IS NULL OR c.source_environment != o.source_environment OR c.is_test != o.is_test)`),
    violationCount(database, `SELECT COUNT(*) AS count FROM operation_orders o LEFT JOIN order_fulfillment_details f ON f.order_id = o.id
      WHERE f.order_id IS NULL OR f.fulfillment_type != o.fulfillment_type`),
    violationCount(database, "SELECT COUNT(*) AS count FROM catalog_site_stock WHERE track_stock = 1 AND (on_hand < 0 OR reserved < 0 OR reserved > on_hand)"),
    violationCount(database, "SELECT COUNT(*) AS count FROM finance_order_allocations a LEFT JOIN operation_orders o ON o.id = a.order_id WHERE o.id IS NULL"),
    violationCount(database, `SELECT
      (SELECT COUNT(*) FROM site_stock_lots WHERE quantity < 0)
      + (SELECT COUNT(*) FROM material_stock_lots WHERE quantity < 0) AS count`),
    violationCount(database, `SELECT COUNT(*) AS count FROM internal_accounts a
      WHERE a.balance != COALESCE((SELECT SUM(e.amount) FROM internal_account_entries e WHERE e.site_id = a.site_id), 0)`),
    violationCount(database, `SELECT COUNT(*) AS count FROM finance_order_allocations a
      WHERE a.cost_source = 'actual' AND a.workshop_cost != COALESCE((SELECT SUM(c.total_cost) FROM order_item_lot_consumptions c WHERE c.order_id = a.order_id), 0)`),
  ]);
  const violations = { orderAmounts, orderItems, orphanOrderItems, paymentAttempts, orphanPayments, customerLinks, fulfillmentSnapshots, stock, financeLinks, lotBalances, internalAccountBalances, actualCogsLinks };
  const totalViolations = Object.values(violations).reduce((sum, value) => sum + value, 0);
  return { ok: totalViolations === 0, violations, totalViolations };
}
