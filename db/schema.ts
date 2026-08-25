import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const runtimeSchemaMigrations = sqliteTable("runtime_schema_migrations", {
  version: integer("version").primaryKey(),
  name: text("name").notNull(),
  appliedAt: text("applied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const savedGroupProfiles = sqliteTable(
  "saved_group_profiles",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    recipient: text("recipient").notNull(),
    phone: text("phone").notNull(),
    address: text("address").notNull(),
    deliveryNote: text("delivery_note").notNull().default(""),
    deliverySlot: text("delivery_slot").notNull().default("14:30"),
    cutoff: text("cutoff").notNull().default("13:45"),
    payment: text("payment").notNull().default("Mỗi người tự thanh toán"),
    shippingMode: text("shipping_mode").notNull().default("delivery"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("saved_group_profiles_user_idx").on(table.userEmail, table.updatedAt)],
);

export const groupRooms = sqliteTable(
  "group_rooms",
  {
    code: text("code").primaryKey(),
    hostToken: text("host_token").notNull(),
    office: text("office").notNull(),
    slot: text("slot").notNull().default("14:30"),
    cutoff: text("cutoff").notNull().default("13:45"),
    address: text("address").notNull().default(""),
    recipient: text("recipient").notNull().default(""),
    phone: text("phone").notNull().default(""),
    payment: text("payment").notNull().default("Chủ phòng thanh toán"),
    shippingMode: text("shipping_mode").notNull().default("delivery"),
    expiresAt: integer("expires_at").notNull(),
    status: text("status").notNull().default("open"),
    // M5: phòng chốt được thành đơn thật nên cần biết bán ở điểm nào, ai là chủ
    // phòng, và đơn sinh ra là đơn nào.
    siteId: text("site_id"),
    hostUserId: text("host_user_id"),
    hostPhoneE164: text("host_phone_e164").notNull().default(""),
    orderId: text("order_id"),
    splitMode: text("split_mode").notNull().default("host_pays"),
    hostCommissionBps: integer("host_commission_bps").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("group_rooms_expiry_idx").on(table.expiresAt, table.status)],
);

export const groupRoomItems = sqliteTable(
  "group_room_items",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code").notNull(),
    guestName: text("guest_name").notNull(),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    price: integer("price").notNull(),
    quantity: integer("quantity").notNull().default(1),
    optionCodesJson: text("option_codes_json").notNull().default("[]"),
    sweetness: text("sweetness").notNull().default(""),
    note: text("note").notNull().default(""),
    guestPhone: text("guest_phone").notNull().default(""),
    orderItemId: text("order_item_id"),
    paymentStatus: text("payment_status").notNull().default("pending"),
    paymentAttemptId: text("payment_attempt_id"),
    isHost: integer("is_host").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("group_room_items_room_idx").on(table.roomCode, table.createdAt)],
);

/**
 * Lightweight operations control-plane tables.
 *
 * These tables intentionally avoid SQLite-only extensions and foreign-key
 * cascades so the same schema can run on Cloudflare D1 and in local previews.
 * The operations API owns validation and writes an immutable event for every
 * state transition.
 */
export const operationSites = sqliteTable(
  "operation_sites",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("open"),
    address: text("address").notNull(),
    district: text("district").notNull().default(""),
    managerName: text("manager_name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    capacityPerHour: integer("capacity_per_hour").notNull().default(0),
    activeOrders: integer("active_orders").notNull().default(0),
    partnerId: text("partner_id"),
    latitudeE6: integer("latitude_e6"),
    longitudeE6: integer("longitude_e6"),
    ownerUserId: text("owner_user_id"),
    openingHoursJson: text("opening_hours_json").notNull().default("{}"),
    serviceRadiusM: integer("service_radius_m").notNull().default(5000),
    fulfillmentJson: text("fulfillment_json").notNull().default('["delivery","pickup"]'),
    acceptsOrders: integer("accepts_orders", { mode: "boolean" }).notNull().default(true),
    timezone: text("timezone").notNull().default("Asia/Ho_Chi_Minh"),
    openedAt: text("opened_at"),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("operation_sites_code_idx").on(table.code),
    uniqueIndex("operation_sites_code_unique_idx").on(table.code),
    index("operation_sites_status_idx").on(table.status, table.kind),
  ],
);

export const operationPartners = sqliteTable(
  "operation_partners",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    ownerName: text("owner_name").notNull(),
    phone: text("phone").notNull(),
    district: text("district").notNull().default(""),
    status: text("status").notNull().default("lead"),
    onboardingStage: text("onboarding_stage").notNull().default("new"),
    locationCount: integer("location_count").notNull().default(0),
    commissionBps: integer("commission_bps").notNull().default(800),
    monthlyRevenue: integer("monthly_revenue").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("operation_partners_code_idx").on(table.code),
    uniqueIndex("operation_partners_code_unique_idx").on(table.code),
    index("operation_partners_status_idx").on(table.status, table.onboardingStage),
  ],
);

export const operationStaff = sqliteTable(
  "operation_staff",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    phone: text("phone").notNull().default(""),
    siteId: text("site_id"),
    status: text("status").notNull().default("available"),
    currentTask: text("current_task").notNull().default(""),
    ratingX10: integer("rating_x10").notNull().default(50),
    completedToday: integer("completed_today").notNull().default(0),
    userId: text("user_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("operation_staff_role_idx").on(table.role, table.status),
    index("operation_staff_site_idx").on(table.siteId, table.status),
  ],
);

export const siteClosures = sqliteTable(
  "site_closures",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    reason: text("reason").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("site_closures_site_idx").on(table.siteId, table.startsAt)],
);

export const workShifts = sqliteTable(
  "work_shifts",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    userId: text("user_id").notNull(),
    openedAt: text("opened_at").notNull(),
    closedAt: text("closed_at"),
    openingCash: integer("opening_cash").notNull().default(0),
    countedCash: integer("counted_cash"),
    expectedCash: integer("expected_cash"),
    variance: integer("variance"),
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("open"),
  },
  (table) => [
    index("work_shifts_site_idx").on(table.siteId, table.openedAt),
    uniqueIndex("work_shifts_one_open_per_site_idx").on(table.siteId).where(sql`status = 'open'`),
  ],
);

export const cashMovements = sqliteTable(
  "cash_movements",
  {
    id: text("id").primaryKey(),
    shiftId: text("shift_id"),
    siteId: text("site_id").notNull(),
    movementType: text("movement_type").notNull(),
    amount: integer("amount").notNull(),
    orderId: text("order_id"),
    reason: text("reason").notNull().default(""),
    actorUserId: text("actor_user_id").notNull(),
    remittedAt: text("remitted_at"),
    remittedShiftId: text("remitted_shift_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("cash_movements_shift_idx").on(table.shiftId, table.createdAt),
    index("cash_movements_actor_idx").on(table.actorUserId, table.remittedAt, table.createdAt),
    uniqueIndex("cash_movements_order_sale_unique_idx").on(table.orderId).where(sql`${table.movementType} = 'sale' AND ${table.orderId} IS NOT NULL`),
    check("cash_movements_type_valid", sql`${table.movementType} IN ('sale','refund','drop','float_in','payout','correction')`),
    check("cash_movements_amount_valid", sql`${table.amount} != 0`),
  ],
);

export const operationOrders = sqliteTable(
  "operation_orders",
  {
    id: text("id").primaryKey(),
    orderCode: text("order_code").notNull(),
    channel: text("channel").notNull().default("webapp"),
    customerId: text("customer_id"),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull().default(""),
    customerEmail: text("customer_email").notNull().default(""),
    deliveryAddress: text("delivery_address").notNull(),
    deliveryLatitudeE6: integer("delivery_latitude_e6"),
    deliveryLongitudeE6: integer("delivery_longitude_e6"),
    deliveryQuoteId: text("delivery_quote_id"),
    deliveryDistanceMeters: integer("delivery_distance_meters"),
    deliveryProviderPreference: text("delivery_provider_preference").notNull().default("internal"),
    deliveryOtpCode: text("delivery_otp_code").notNull().default(""),
    fulfillmentType: text("fulfillment_type").notNull().default("delivery"),
    siteId: text("site_id").notNull(),
    partnerId: text("partner_id"),
    currency: text("currency").notNull().default("VND"),
    subtotalAmount: integer("subtotal_amount").notNull().default(0),
    deliveryFeeAmount: integer("delivery_fee_amount").notNull().default(0),
    discountAmount: integer("discount_amount").notNull().default(0),
    totalAmount: integer("total_amount").notNull(),
    itemCount: integer("item_count").notNull().default(1),
    paymentMethod: text("payment_method").notNull().default("bank_transfer"),
    paymentProvider: text("payment_provider"),
    paymentStatus: text("payment_status").notNull().default("pending"),
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(true),
    sourceEnvironment: text("source_environment").notNull().default("test"),
    orderStatus: text("order_status").notNull().default("new"),
    kitchenStatus: text("kitchen_status").notNull().default("queued"),
    deliveryStatus: text("delivery_status").notNull().default("unassigned"),
    assignedShipperId: text("assigned_shipper_id"),
    trackingTokenHash: text("tracking_token_hash"),
    clientReference: text("client_reference"),
    dataSchemaVersion: integer("data_schema_version").notNull().default(16),
    promisedAt: text("promised_at").notNull(),
    scheduledFor: text("scheduled_for"),
    tableLabel: text("table_label").notNull().default(""),
    groupRoomCode: text("group_room_code"),
    shiftId: text("shift_id"),
    cancelledAt: text("cancelled_at"),
    completedAt: text("completed_at"),
    cancellationReason: text("cancellation_reason").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("operation_orders_code_idx").on(table.orderCode),
    uniqueIndex("operation_orders_code_unique_idx").on(table.orderCode),
    index("operation_orders_status_idx").on(table.orderStatus, table.updatedAt),
    index("operation_orders_kitchen_idx").on(table.kitchenStatus, table.promisedAt),
    index("operation_orders_delivery_idx").on(table.deliveryStatus, table.assignedShipperId),
    index("operation_orders_site_idx").on(table.siteId, table.createdAt),
    index("operation_orders_site_status_created_idx").on(table.siteId, table.orderStatus, table.createdAt, table.id),
    index("operation_orders_active_promised_idx")
      .on(table.siteId, table.promisedAt, table.id)
      .where(sql`${table.orderStatus} NOT IN ('delivered', 'cancelled')`),
    index("operation_orders_customer_idx").on(table.customerId, table.createdAt),
    index("operation_orders_environment_idx").on(table.sourceEnvironment, table.isTest, table.createdAt),
    uniqueIndex("operation_orders_client_ref_unique_idx")
      .on(table.sourceEnvironment, table.clientReference)
      .where(sql`${table.clientReference} IS NOT NULL`),
    uniqueIndex("operation_orders_delivery_quote_unique_idx")
      .on(table.deliveryQuoteId)
      .where(sql`${table.deliveryQuoteId} IS NOT NULL`),
  ],
);

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    phoneE164: text("phone_e164").notNull().default(""),
    emailNormalized: text("email_normalized").notNull().default(""),
    identityStatus: text("identity_status").notNull().default("guest"),
    status: text("status").notNull().default("active"),
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(true),
    sourceEnvironment: text("source_environment").notNull().default("test"),
    marketingOptIn: integer("marketing_opt_in", { mode: "boolean" }).notNull().default(false),
    marketingConsentAt: text("marketing_consent_at"),
    termsAcceptedAt: text("terms_accepted_at"),
    privacyAcceptedAt: text("privacy_accepted_at"),
    firstOrderAt: text("first_order_at").notNull(),
    lastOrderAt: text("last_order_at").notNull(),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("customers_phone_env_unique_idx").on(table.sourceEnvironment, table.phoneE164).where(sql`${table.phoneE164} <> '' AND ${table.status} = 'active'`),
    uniqueIndex("customers_email_env_unique_idx").on(table.sourceEnvironment, table.emailNormalized).where(sql`${table.emailNormalized} <> '' AND ${table.status} = 'active'`),
    index("customers_status_idx").on(table.sourceEnvironment, table.status, table.updatedAt),
    check("customers_contact_required", sql`${table.phoneE164} <> '' OR ${table.emailNormalized} <> ''`),
    check("customers_environment_valid", sql`${table.sourceEnvironment} IN ('test', 'live') AND ${table.isTest} = CASE WHEN ${table.sourceEnvironment} = 'test' THEN 1 ELSE 0 END`),
    check("customers_marketing_valid", sql`${table.marketingOptIn} IN (0, 1)`),
  ],
);

export const orderFulfillmentDetails = sqliteTable(
  "order_fulfillment_details",
  {
    orderId: text("order_id").references(() => operationOrders.id, { onDelete: "restrict" }).primaryKey(),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    fulfillmentType: text("fulfillment_type").notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull().default(""),
    formattedAddress: text("formatted_address").notNull(),
    addressLine1: text("address_line1").notNull(),
    ward: text("ward").notNull().default(""),
    district: text("district").notNull().default(""),
    city: text("city").notNull().default(""),
    countryCode: text("country_code").notNull().default("VN"),
    latitudeE6: integer("latitude_e6"),
    longitudeE6: integer("longitude_e6"),
    pickupSiteName: text("pickup_site_name").notNull().default(""),
    pickupSiteAddress: text("pickup_site_address").notNull().default(""),
    pickupSitePhone: text("pickup_site_phone").notNull().default(""),
    deliveryInstructions: text("delivery_instructions").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("order_fulfillment_customer_idx").on(table.customerId, table.createdAt),
    check("order_fulfillment_type_valid", sql`${table.fulfillmentType} IN ('delivery', 'pickup', 'dine-in')`),
    check("order_fulfillment_coordinates_valid", sql`(${table.latitudeE6} IS NULL AND ${table.longitudeE6} IS NULL) OR (${table.latitudeE6} BETWEEN -90000000 AND 90000000 AND ${table.longitudeE6} BETWEEN -180000000 AND 180000000)`),
  ],
);

export const operationOrderItems = sqliteTable(
  "operation_order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    baseUnitPrice: integer("base_unit_price").notNull().default(0),
    optionsUnitPrice: integer("options_unit_price").notNull().default(0),
    unitPrice: integer("unit_price").notNull(),
    lineTotal: integer("line_total").notNull().default(0),
    customizationJson: text("customization_json").notNull().default("{}"),
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("pending"),
    startedAt: text("started_at"),
    doneAt: text("done_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("operation_order_items_order_idx").on(table.orderId)],
);

export const catalogProducts = sqliteTable(
  "catalog_products",
  {
    sku: text("sku").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    basePrice: integer("base_price").notNull(),
    currency: text("currency").notNull().default("VND"),
    aliasesJson: text("aliases_json").notNull().default("[]"),
    description: text("description").notNull().default(""),
    note: text("note").notNull().default(""),
    ingredients: text("ingredients").notNull().default(""),
    allergens: text("allergens").notNull().default(""),
    origin: text("origin").notNull().default(""),
    nutritionJson: text("nutrition_json").notNull().default("{}"),
    tagsJson: text("tags_json").notNull().default("[]"),
    imageUrl: text("image_url").notNull().default(""),
    serving: text("serving").notNull().default(""),
    prepMinutes: integer("prep_minutes").notNull().default(0),
    rewardPoints: integer("reward_points").notNull().default(0),
    sweetnessJson: text("sweetness_json").notNull().default("[]"),
    status: text("status").notNull().default("active"),
    testOnly: integer("test_only", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("catalog_products_status_idx").on(table.status, table.category, table.sortOrder)],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json").notNull(),
    statusCode: integer("status_code").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key] }), index("idempotency_keys_created_idx").on(table.createdAt)],
);

export const orderAmendments = sqliteTable(
  "order_amendments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    amendmentType: text("amendment_type").notNull(),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    amountDelta: integer("amount_delta").notNull().default(0),
    reason: text("reason").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("order_amendments_order_idx").on(table.orderId, table.createdAt)],
);

export const orderPaymentAdjustments = sqliteTable(
  "order_payment_adjustments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    amendmentId: text("amendment_id").notNull(),
    direction: text("direction").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("order_payment_adjustments_amendment_unique_idx").on(table.amendmentId)],
);

export const catalogPriceOverrides = sqliteTable(
  "catalog_price_overrides",
  {
    id: text("id").primaryKey(),
    productSku: text("product_sku").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeValue: text("scope_value").notNull(),
    price: integer("price").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("price_override_lookup_idx").on(table.productSku, table.scopeType, table.scopeValue, table.effectiveFrom),
    check("catalog_price_scope_valid", sql`${table.scopeType} IN ('site', 'site_kind', 'channel')`),
    check("catalog_price_nonnegative", sql`${table.price} >= 0`),
  ],
);

export const catalogPriceHistory = sqliteTable(
  "catalog_price_history",
  {
    id: text("id").primaryKey(),
    productSku: text("product_sku").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeValue: text("scope_value").notNull(),
    oldPrice: integer("old_price"),
    newPrice: integer("new_price").notNull(),
    reason: text("reason").notNull().default(""),
    changedBy: text("changed_by").notNull(),
    changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("catalog_price_history_product_idx").on(table.productSku, table.changedAt)],
);

export const catalogTransferPrices = sqliteTable(
  "catalog_transfer_prices",
  {
    id: text("id").primaryKey(),
    productSku: text("product_sku").notNull(),
    siteKind: text("site_kind").notNull(),
    transferPrice: integer("transfer_price").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("catalog_transfer_price_lookup_idx").on(table.productSku, table.siteKind, table.effectiveFrom),
    check("catalog_transfer_price_nonnegative", sql`${table.transferPrice} >= 0`),
  ],
);

export const catalogProductOptions = sqliteTable(
  "catalog_product_options",
  {
    code: text("code").primaryKey(),
    productSku: text("product_sku").notNull(),
    kind: text("kind").notNull().default("topping"),
    name: text("name").notNull(),
    priceDelta: integer("price_delta").notNull().default(0),
    status: text("status").notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("catalog_product_options_product_idx").on(table.productSku, table.status, table.sortOrder)],
);

export const catalogSiteStock = sqliteTable(
  "catalog_site_stock",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    productSku: text("product_sku").notNull(),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    trackStock: integer("track_stock", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("available"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("catalog_site_stock_site_sku_unique_idx").on(table.siteId, table.productSku),
    index("catalog_site_stock_status_idx").on(table.siteId, table.status, table.productSku),
    check("catalog_site_stock_valid", sql`${table.trackStock} = 0 OR (${table.onHand} >= 0 AND ${table.reserved} >= 0 AND ${table.reserved} <= ${table.onHand})`),
  ],
);

export const catalogStockReservations = sqliteTable(
  "catalog_stock_reservations",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    siteId: text("site_id").notNull(),
    productSku: text("product_sku").notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("catalog_stock_reservations_order_sku_unique_idx").on(table.orderId, table.productSku),
    index("catalog_stock_reservations_status_idx").on(table.siteId, table.status, table.productSku),
  ],
);

export const catalogStockMovements = sqliteTable(
  "catalog_stock_movements",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id"),
    siteId: text("site_id").notNull(),
    productSku: text("product_sku").notNull(),
    movementType: text("movement_type").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("catalog_stock_movements_product_idx").on(table.siteId, table.productSku, table.createdAt),
    index("catalog_stock_movements_order_idx").on(table.orderId, table.createdAt),
  ],
);

export const operationInventory = sqliteTable(
  "operation_inventory",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    reorderLevel: integer("reorder_level").notNull().default(0),
    status: text("status").notNull().default("healthy"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("operation_inventory_site_idx").on(table.siteId, table.status),
    index("operation_inventory_sku_idx").on(table.sku, table.siteId),
    uniqueIndex("operation_inventory_site_sku_unique_idx").on(table.siteId, table.sku),
  ],
);

export const operationAlerts = sqliteTable(
  "operation_alerts",
  {
    id: text("id").primaryKey(),
    severity: text("severity").notNull().default("info"),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("open"),
    assignedRole: text("assigned_role").notNull().default("super-admin"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: text("resolved_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("operation_alerts_status_idx").on(table.status, table.severity),
    index("operation_alerts_role_idx").on(table.assignedRole, table.status),
  ],
);

export const operationEventLog = sqliteTable(
  "operation_event_log",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    actorRole: text("actor_role").notNull(),
    actorName: text("actor_name").notNull().default("Demo operator"),
    fromState: text("from_state"),
    toState: text("to_state"),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("operation_event_entity_idx").on(table.entityType, table.entityId, table.createdAt),
    index("operation_event_created_idx").on(table.createdAt),
  ],
);

export const rateLimitBuckets = sqliteTable(
  "rate_limit_buckets",
  {
    bucketKey: text("bucket_key").primaryKey(),
    requests: integer("requests").notNull(),
    windowStartedAt: text("window_started_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("rate_limit_buckets_expiry_idx").on(table.expiresAt)],
);

export const streamConnections = sqliteTable(
  "stream_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    siteId: text("site_id").notNull().default(""),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("stream_connections_user_expiry_idx").on(table.userId, table.expiresAt)],
);

export const applicationRequestLog = sqliteTable(
  "application_request_log",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    route: text("route").notNull(),
    method: text("method").notNull(),
    statusCode: integer("status_code").notNull(),
    durationMs: integer("duration_ms").notNull(),
    userId: text("user_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("application_request_log_created_idx").on(table.createdAt),
    index("application_request_log_route_status_idx").on(table.route, table.statusCode, table.createdAt),
  ],
);

export const piiAccessLog = sqliteTable(
  "pii_access_log",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorRole: text("actor_role").notNull(),
    accessType: text("access_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull().default(""),
    filterJson: text("filter_json").notNull().default("{}"),
    rowCount: integer("row_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("pii_access_log_actor_created_idx").on(table.actorUserId, table.createdAt),
    index("pii_access_log_entity_created_idx").on(table.entityType, table.entityId, table.createdAt),
  ],
);

export const monitorIncidents = sqliteTable(
  "monitor_incidents",
  {
    incidentKey: text("incident_key").primaryKey(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    status: text("status").notNull().default("open"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    notifiedAt: text("notified_at"),
    resolvedAt: text("resolved_at"),
  },
  (table) => [index("monitor_incidents_status_seen_idx").on(table.status, table.lastSeenAt)],
);

export const privacyConsents = sqliteTable(
  "privacy_consents",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id"),
    userId: text("user_id"),
    consentType: text("consent_type").notNull(),
    policyVersion: text("policy_version").notNull(),
    grantedAt: text("granted_at").notNull(),
    revokedAt: text("revoked_at"),
    source: text("source").notNull().default("web"),
  },
  (table) => [
    index("privacy_consents_customer_idx").on(table.customerId, table.consentType, table.grantedAt),
    index("privacy_consents_user_idx").on(table.userId, table.consentType, table.grantedAt),
  ],
);

/**
 * Finance control-plane. Money is always stored as integer VND and ratios as
 * basis points (10_000 = 100%) so reports never depend on floating point
 * arithmetic. The active policy describes the commercial waterfall while an
 * allocation row freezes the exact calculation used by each order.
 */
export const financePricePolicies = sqliteTable(
  "finance_price_policies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    retailBps: integer("retail_bps").notNull().default(10000),
    workshopCostBps: integer("workshop_cost_bps").notNull().default(2000),
    landedPartnerBps: integer("landed_partner_bps").notNull().default(4000),
    channelPoolBps: integer("channel_pool_bps").notNull().default(6000),
    defaultAffiliateBps: integer("default_affiliate_bps").notNull().default(800),
    effectiveFrom: text("effective_from").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("finance_price_policies_status_idx").on(table.status, table.effectiveFrom)],
);

export const financeOrderAllocations = sqliteTable(
  "finance_order_allocations",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    policyId: text("policy_id").notNull(),
    status: text("status").notNull().default("posted"),
    grossRevenue: integer("gross_revenue").notNull(),
    workshopCost: integer("workshop_cost").notNull(),
    partnerLogistics: integer("partner_logistics").notNull(),
    landedPartner: integer("landed_partner").notNull(),
    channelPool: integer("channel_pool").notNull(),
    affiliateCode: text("affiliate_code"),
    affiliateBps: integer("affiliate_bps").notNull().default(0),
    affiliateCommission: integer("affiliate_commission").notNull().default(0),
    channelContribution: integer("channel_contribution").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("finance_order_allocations_order_idx").on(table.orderId),
    uniqueIndex("finance_order_allocations_order_unique_idx").on(table.orderId),
    index("finance_order_allocations_status_idx").on(table.status, table.createdAt),
  ],
);

export const financeLedgerEntries = sqliteTable(
  "finance_ledger_entries",
  {
    id: text("id").primaryKey(),
    occurredAt: text("occurred_at").notNull(),
    entryType: text("entry_type").notNull(),
    direction: text("direction").notNull(),
    amount: integer("amount").notNull(),
    locationId: text("location_id"),
    partnerId: text("partner_id"),
    orderId: text("order_id"),
    expenseId: text("expense_id"),
    settlementId: text("settlement_id"),
    status: text("status").notNull().default("posted"),
    description: text("description").notNull(),
    referenceCode: text("reference_code").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("finance_ledger_order_idx").on(table.orderId, table.entryType),
    index("finance_ledger_location_idx").on(table.locationId, table.occurredAt),
    index("finance_ledger_location_occurred_type_idx").on(table.locationId, table.occurredAt, table.entryType, table.id),
    index("finance_ledger_occurred_idx").on(table.occurredAt, table.status),
  ],
);

export const financeExpenses = sqliteTable(
  "finance_expenses",
  {
    id: text("id").primaryKey(),
    expenseCode: text("expense_code").notNull(),
    siteId: text("site_id").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amount: integer("amount").notNull(),
    expenseDate: text("expense_date").notNull(),
    vendor: text("vendor").notNull().default(""),
    receiptUrl: text("receipt_url").notNull().default(""),
    status: text("status").notNull().default("pending"),
    submittedBy: text("submitted_by").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("finance_expenses_site_idx").on(table.siteId, table.expenseDate),
    index("finance_expenses_status_idx").on(table.status, table.createdAt),
    uniqueIndex("finance_expenses_code_unique_idx").on(table.expenseCode),
  ],
);

export const financeSettlements = sqliteTable(
  "finance_settlements",
  {
    id: text("id").primaryKey(),
    settlementCode: text("settlement_code").notNull(),
    counterpartyType: text("counterparty_type").notNull(),
    counterpartyId: text("counterparty_id").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    grossAmount: integer("gross_amount").notNull(),
    deductions: integer("deductions").notNull().default(0),
    netAmount: integer("net_amount").notNull(),
    status: text("status").notNull().default("draft"),
    paidAt: text("paid_at"),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("finance_settlements_counterparty_idx").on(table.counterpartyType, table.counterpartyId, table.periodEnd),
    index("finance_settlements_status_idx").on(table.status, table.updatedAt),
    uniqueIndex("finance_settlements_code_unique_idx").on(table.settlementCode),
  ],
);

export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    provider: text("provider").notNull().default("sepay"),
    paymentCode: text("payment_code").notNull(),
    bankCode: text("bank_code").notNull(),
    bankAccount: text("bank_account").notNull(),
    expectedAmount: integer("expected_amount").notNull(),
    receivedAmount: integer("received_amount").notNull().default(0),
    currency: text("currency").notNull().default("VND"),
    status: text("status").notNull().default("pending"),
    expiresAt: text("expires_at").notNull(),
    paidAt: text("paid_at"),
    providerTransactionId: text("provider_transaction_id"),
    qrUrl: text("qr_url").notNull(),
    siteId: text("site_id"),
    payerLabel: text("payer_label").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("payment_attempts_code_unique_idx").on(table.paymentCode),
    index("payment_attempts_order_idx").on(table.orderId, table.createdAt),
    index("payment_attempts_status_idx").on(table.status, table.expiresAt),
    index("payment_attempts_site_idx").on(table.siteId, table.createdAt),
  ],
);

export const paymentTransactions = sqliteTable(
  "payment_transactions",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("sepay"),
    providerTransactionId: text("provider_transaction_id").notNull(),
    gateway: text("gateway").notNull(),
    transactionDate: text("transaction_date").notNull(),
    accountNumber: text("account_number").notNull(),
    subAccount: text("sub_account").notNull().default(""),
    paymentCode: text("payment_code"),
    content: text("content").notNull().default(""),
    transferType: text("transfer_type").notNull(),
    description: text("description").notNull().default(""),
    transferAmount: integer("transfer_amount").notNull(),
    accumulated: integer("accumulated").notNull().default(0),
    referenceCode: text("reference_code").notNull().default(""),
    attemptId: text("attempt_id"),
    orderId: text("order_id"),
    matchStatus: text("match_status").notNull().default("received"),
    payloadJson: text("payload_json").notNull(),
    receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    processedAt: text("processed_at"),
  },
  (table) => [
    uniqueIndex("payment_transactions_provider_id_unique_idx").on(table.provider, table.providerTransactionId),
    index("payment_transactions_attempt_idx").on(table.attemptId, table.receivedAt),
    index("payment_transactions_match_idx").on(table.matchStatus, table.receivedAt),
  ],
);

export const paymentRefunds = sqliteTable(
  "payment_refunds",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    provider: text("provider").notNull().default("sepay"),
    refundCode: text("refund_code").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("VND"),
    reason: text("reason").notNull(),
    providerReference: text("provider_reference").notNull(),
    status: text("status").notNull().default("completed"),
    requestedBy: text("requested_by").notNull(),
    completedAt: text("completed_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    refundType: text("refund_type").notNull().default("full"),
  },
  (table) => [
    index("payment_refunds_order_idx").on(table.orderId, table.createdAt),
    uniqueIndex("payment_refunds_code_unique_idx").on(table.refundCode),
    uniqueIndex("payment_refunds_reference_unique_idx").on(table.provider, table.providerReference),
  ],
);

export const bankReconciliations = sqliteTable(
  "bank_reconciliations",
  {
    id: text("id").primaryKey(),
    statementDate: text("statement_date").notNull(),
    accountNumber: text("account_number").notNull(),
    openingBalance: integer("opening_balance").notNull(),
    closingBalance: integer("closing_balance").notNull(),
    matchedCount: integer("matched_count").notNull().default(0),
    unmatchedCount: integer("unmatched_count").notNull().default(0),
    unmatchedAmount: integer("unmatched_amount").notNull().default(0),
    status: text("status").notNull().default("open"),
    reconciledBy: text("reconciled_by"),
    reconciledAt: text("reconciled_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("bank_reconciliations_date_idx").on(table.statementDate, table.accountNumber, table.createdAt)],
);

export const bankStatementLines = sqliteTable(
  "bank_statement_lines",
  {
    id: text("id").primaryKey(),
    reconciliationId: text("reconciliation_id").notNull(),
    providerTransactionId: text("provider_transaction_id").notNull().default(""),
    transactionDate: text("transaction_date").notNull(),
    amount: integer("amount").notNull(),
    content: text("content").notNull().default(""),
    paymentCode: text("payment_code").notNull().default(""),
    matchStatus: text("match_status").notNull(),
    paymentTransactionId: text("payment_transaction_id"),
    sourceType: text("source_type").notNull().default("statement"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("bank_statement_lines_reconciliation_idx").on(table.reconciliationId, table.matchStatus, table.transactionDate)],
);

export const inboundRequests = sqliteTable(
  "inbound_requests",
  {
    id: text("id").primaryKey(),
    requestType: text("request_type").notNull(),
    status: text("status").notNull().default("new"),
    name: text("name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    subject: text("subject").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    sourceEnvironment: text("source_environment").notNull().default("test"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("inbound_requests_status_idx").on(table.status, table.requestType, table.createdAt),
    index("inbound_requests_phone_idx").on(table.phone, table.createdAt),
  ],
);

export const affiliateMembers = sqliteTable(
  "affiliate_members",
  {
    id: text("id").primaryKey(),
    sourceRequestId: text("source_request_id"),
    accessTokenHash: text("access_token_hash"),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    status: text("status").notNull().default("pending"),
    commissionBps: integer("commission_bps").notNull().default(800),
    payoutBankCode: text("payout_bank_code").notNull().default(""),
    payoutAccountNumber: text("payout_account_number").notNull().default(""),
    payoutAccountName: text("payout_account_name").notNull().default(""),
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(true),
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("affiliate_members_source_request_unique_idx").on(table.sourceRequestId),
    index("affiliate_members_status_idx").on(table.status, table.updatedAt),
    index("affiliate_members_phone_idx").on(table.phone, table.updatedAt),
  ],
);

export const affiliateCodes = sqliteTable(
  "affiliate_codes",
  {
    code: text("code").primaryKey(),
    affiliateId: text("affiliate_id").notNull(),
    status: text("status").notNull().default("active"),
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("affiliate_codes_member_idx").on(table.affiliateId, table.status)],
);

export const deliveryQuotes = sqliteTable(
  "delivery_quotes",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    provider: text("provider").notNull().default("lalamove"),
    providerQuotationId: text("provider_quotation_id").notNull(),
    status: text("status").notNull().default("active"),
    serviceType: text("service_type").notNull(),
    quotedFeeAmount: integer("quoted_fee_amount").notNull(),
    currency: text("currency").notNull().default("VND"),
    distanceMeters: integer("distance_meters"),
    expiresAt: text("expires_at").notNull(),
    requestJson: text("request_json").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("delivery_quotes_provider_id_unique_idx").on(table.provider, table.providerQuotationId),
    index("delivery_quotes_order_idx").on(table.orderId, table.createdAt),
    index("delivery_quotes_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const deliveryFeeRules = sqliteTable(
  "delivery_fee_rules",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id"),
    ruleType: text("rule_type").notNull(),
    minValue: integer("min_value").notNull(),
    maxValue: integer("max_value"),
    fee: integer("fee").notNull(),
    freeOverAmount: integer("free_over_amount"),
    priority: integer("priority").notNull().default(0),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("delivery_fee_rules_active_idx").on(table.siteId, table.ruleType, table.priority, table.effectiveFrom, table.effectiveTo),
    check("delivery_fee_rules_type_valid", sql`${table.ruleType} IN ('distance','order_value','time_window')`),
    check("delivery_fee_rules_range_valid", sql`${table.minValue} >= 0 AND (${table.maxValue} IS NULL OR ${table.maxValue} >= ${table.minValue})`),
    check("delivery_fee_rules_fee_valid", sql`${table.fee} >= 0 AND (${table.freeOverAmount} IS NULL OR ${table.freeOverAmount} >= 0)`),
  ],
);

export const deliveryProofs = sqliteTable(
  "delivery_proofs",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    proofType: text("proof_type").notNull(),
    purpose: text("purpose").notNull().default("delivered"),
    photoUrl: text("photo_url").notNull().default(""),
    otpVerified: integer("otp_verified", { mode: "boolean" }).notNull().default(false),
    recipientName: text("recipient_name").notNull().default(""),
    latitudeE6: integer("latitude_e6"),
    longitudeE6: integer("longitude_e6"),
    capturedBy: text("captured_by").notNull(),
    capturedAt: text("captured_at").notNull(),
  },
  (table) => [
    index("delivery_proofs_order_idx").on(table.orderId, table.capturedAt),
    index("delivery_proofs_retention_idx").on(table.proofType, table.capturedAt),
    check("delivery_proofs_type_valid", sql`${table.proofType} IN ('photo','otp','signature')`),
    check("delivery_proofs_purpose_valid", sql`${table.purpose} IN ('delivered','delivery_failed')`),
  ],
);

export const shipperLocations = sqliteTable(
  "shipper_locations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    orderId: text("order_id"),
    latitudeE6: integer("latitude_e6").notNull(),
    longitudeE6: integer("longitude_e6").notNull(),
    accuracyM: integer("accuracy_m"),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    index("shipper_locations_idx").on(table.userId, table.recordedAt),
    index("shipper_locations_order_idx").on(table.orderId, table.recordedAt),
  ],
);

export const deliveryJobs = sqliteTable(
  "delivery_jobs",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    provider: text("provider").notNull().default("lalamove"),
    environment: text("environment").notNull().default("sandbox"),
    providerOrderId: text("provider_order_id"),
    providerQuotationId: text("provider_quotation_id"),
    status: text("status").notNull().default("booking"),
    quotedFeeAmount: integer("quoted_fee_amount").notNull().default(0),
    actualFeeAmount: integer("actual_fee_amount"),
    currency: text("currency").notNull().default("VND"),
    distanceMeters: integer("distance_meters"),
    driverId: text("driver_id"),
    driverName: text("driver_name"),
    driverPhone: text("driver_phone"),
    plateNumber: text("plate_number"),
    trackingUrl: text("tracking_url"),
    pickupEta: text("pickup_eta"),
    deliveryEta: text("delivery_eta"),
    bookedAt: text("booked_at"),
    assignedAt: text("assigned_at"),
    pickedUpAt: text("picked_up_at"),
    completedAt: text("completed_at"),
    lastProviderUpdatedAt: text("last_provider_updated_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("delivery_jobs_order_unique_idx").on(table.orderId),
    uniqueIndex("delivery_jobs_provider_order_unique_idx").on(table.provider, table.providerOrderId),
    index("delivery_jobs_status_idx").on(table.status, table.updatedAt),
  ],
);

export const deliveryEvents = sqliteTable(
  "delivery_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id"),
    provider: text("provider").notNull().default("lalamove"),
    providerOrderId: text("provider_order_id"),
    eventType: text("event_type").notNull(),
    providerStatus: text("provider_status"),
    providerUpdatedAt: text("provider_updated_at"),
    payloadJson: text("payload_json").notNull(),
    receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    processedAt: text("processed_at"),
    processingResult: text("processing_result").notNull().default("received"),
  },
  (table) => [
    index("delivery_events_job_idx").on(table.jobId, table.receivedAt),
    index("delivery_events_provider_order_idx").on(table.provider, table.providerOrderId, table.receivedAt),
  ],
);

export const systemSettings = sqliteTable(
  "system_settings",
  {
    key: text("key").notNull(),
    scopeType: text("scope_type").notNull().default("global"),
    scopeValue: text("scope_value").notNull().default("*"),
    valueJson: text("value_json").notNull(),
    updatedBy: text("updated_by").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.scopeType, table.scopeValue], name: "system_settings_pk" }),
    check("system_settings_scope_valid", sql`${table.scopeType} IN ('global', 'site')`),
  ],
);

export const systemSettingHistory = sqliteTable(
  "system_setting_history",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeValue: text("scope_value").notNull(),
    oldValueJson: text("old_value_json"),
    newValueJson: text("new_value_json").notNull(),
    reason: text("reason").notNull().default(""),
    changedBy: text("changed_by").notNull(),
    changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("system_setting_history_key_idx").on(table.key, table.changedAt)],
);
