/**
 * Quy tắc nghiệp vụ của đơn hàng: máy trạng thái, dựng dòng món, mã đơn và
 * token theo dõi.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Hàm thuần, không chạm database.
 *
 * LƯU Ý cho module M4 (idempotency, sửa đơn, ăn tại chỗ) và M9 (phí giao hàng
 * theo khoảng cách): đây là nơi cần sửa, không phải tầng lệnh.
 */

import { findCatalogProduct, type CatalogProduct } from "./catalog-store.ts";
import { orderDataMode } from "./sepay.ts";
import { boundedText, readInteger, readString } from "./command-input.ts";
import {
  OperationsError,
  productCatalog,
  type JsonRecord,
  type OrderItem,
} from "./operations-types.ts";
import { defaultSettingValue } from "./settings-registry.ts";

export type OrderLimits = {
  maxLines: number;
  maxTotalQuantity: number;
  maxQuantityPerLine: number;
  itemNoteMaxChars: number;
};

const defaultOrderLimits: OrderLimits = {
  maxLines: defaultSettingValue<number>("order.max_lines"),
  maxTotalQuantity: defaultSettingValue<number>("order.max_total_quantity"),
  maxQuantityPerLine: defaultSettingValue<number>("order.max_quantity_per_line"),
  itemNoteMaxChars: defaultSettingValue<number>("order.item_note_max_chars"),
};

export function nextOrderState(current: string, fulfillmentType = "delivery") {
  const flow = fulfillmentType === "pickup" || fulfillmentType === "dine-in"
    ? ["new", "accepted", "preparing", "ready", "delivered"]
    : ["new", "accepted", "preparing", "ready", "assigned", "picked_up", "delivering", "delivered"];
  const index = flow.indexOf(current);
  return index < 0 || index >= flow.length - 1 ? current : flow[index + 1];
}

export function kitchenForOrder(status: string, current: string) {
  if (status === "accepted") return "queued";
  if (status === "preparing") return "preparing";
  if (status === "ready") return "ready";
  if (["assigned", "picked_up", "delivering"].includes(status)) return "handed-over";
  if (status === "delivered") return "completed";
  if (status === "cancelled") return "cancelled";
  return current;
}

export function deliveryForOrder(status: string, current: string, fulfillmentType: string) {
  if (fulfillmentType === "pickup" || fulfillmentType === "dine-in") return "not-required";
  if (status === "assigned") return "assigned";
  if (status === "picked_up") return "picked-up";
  if (status === "delivering") return "in-transit";
  if (status === "delivered") return "delivered";
  if (status === "cancelled") return "cancelled";
  if (status === "delivery_failed") return "failed";
  return current;
}

export function orderItemsFrom(data: JsonRecord, orderId: string, createdAt: string, catalog: readonly CatalogProduct[] = productCatalog, limits: OrderLimits = defaultOrderLimits) {
  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new OperationsError("Đơn hàng cần ít nhất một món.", 400, "empty_order");
  }
  if (data.items.length > limits.maxLines) throw new OperationsError(`Một đơn chỉ nhận tối đa ${limits.maxLines} dòng món.`, 400, "too_many_order_items");
  const items = data.items.map((raw, index): OrderItem => {
    const item = raw && typeof raw === "object" ? raw as JsonRecord : {};
    const suppliedCode = readString(item, "productCode").toLocaleUpperCase("en-US");
    const product = findCatalogProduct(catalog, suppliedCode);
    if (!product) throw new OperationsError(`Món ${suppliedCode} không có trong thực đơn đang bán.`, 400, "invalid_product");
    if (product.testOnly && orderDataMode() !== "test") {
      throw new OperationsError("Khoản kiểm thử SePay chỉ hoạt động khi hệ thống ở chế độ test.", 403, "test_payment_disabled");
    }
    const quantity = readInteger(item, "quantity", { min: 1, max: limits.maxQuantityPerLine });
    const note = readString(item, "note", false);
    if (note.length > limits.itemNoteMaxChars) throw new OperationsError(`Ghi chú món tối đa ${limits.itemNoteMaxChars} ký tự.`, 400, "item_note_too_long");
    const rawOptionCodes = Array.isArray(item.optionCodes)
      ? item.optionCodes
      : typeof item.toppingCode === "string" && item.toppingCode.trim()
        ? [item.toppingCode]
        : [];
    if (rawOptionCodes.length > 5) throw new OperationsError("Mỗi dòng món chỉ nhận tối đa 5 tùy chọn.", 400, "too_many_item_options");
    if (rawOptionCodes.some((code) => typeof code !== "string")) throw new OperationsError("Mã tùy chọn món không hợp lệ.", 400, "invalid_product_option");
    const requestedOptions = [...new Set(rawOptionCodes.map((code) => String(code).trim().toLocaleUpperCase("en-US")).filter(Boolean))];
    const toppingName = readString(item, "topping", false);
    if (toppingName && toppingName !== "Không thêm") {
      const namedOption = product.options.find((option) => option.name.toLocaleLowerCase("vi-VN") === toppingName.toLocaleLowerCase("vi-VN"));
      if (!namedOption) throw new OperationsError(`Topping ${toppingName} không áp dụng cho ${product.name}.`, 400, "invalid_product_option");
      requestedOptions.push(namedOption.code);
    }
    const uniqueOptionCodes = [...new Set(requestedOptions)];
    const selectedOptions = uniqueOptionCodes.map((code) => {
      const selected = product.options.find((option) => option.code.toLocaleUpperCase("en-US") === code);
      if (!selected) throw new OperationsError(`Tùy chọn ${code} không áp dụng cho ${product.name}.`, 400, "invalid_product_option");
      return selected;
    });
    const sweetness = boundedText(item, "sweetness", 20, false);
    const temperature = boundedText(item, "temperature", 40, false);
    const optionsUnitPrice = selectedOptions.reduce((sum, option) => sum + option.priceDelta, 0);
    const unitPrice = product.price + optionsUnitPrice;
    return {
      id: `${orderId}-item-${index + 1}`,
      orderId,
      productCode: product.sku,
      productName: product.name,
      quantity,
      baseUnitPrice: product.price,
      optionsUnitPrice,
      unitPrice,
      lineTotal: unitPrice * quantity,
      customizationJson: JSON.stringify({
        ...(sweetness ? { sweetness } : {}),
        ...(temperature ? { temperature } : {}),
        options: selectedOptions.map((option) => ({ code: option.code, kind: option.kind, name: option.name, priceDelta: option.priceDelta })),
      }),
      note,
      createdAt,
    };
  });
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity > limits.maxTotalQuantity) throw new OperationsError(`Một đơn chỉ nhận tối đa ${limits.maxTotalQuantity} phần.`, 400, "order_quantity_too_large");
  return items;
}

export function paymentMethodFrom(data: JsonRecord) {
  const requested = readString(data, "paymentMethod", false).toLocaleLowerCase("en-US");
  if (!requested || requested === "qr" || requested === "transfer" || requested === "bank_transfer") return "bank_transfer";
  if (requested === "cash" || requested === "cod") return "cash";
  if (requested === "wallet") throw new OperationsError("Thanh toán ví điện tử chưa được kích hoạt. Vui lòng chọn VietQR hoặc tiền mặt.", 409, "payment_method_unavailable");
  throw new OperationsError("Phương thức thanh toán không hợp lệ.", 400, "invalid_payment_method");
}

export function deliveryFeeFor(
  subtotalAmount: number,
  fulfillmentType: string,
  fee = defaultSettingValue<number>("delivery.default_fee_vnd"),
  freeShippingThreshold = defaultSettingValue<number>("delivery.free_shipping_threshold_vnd"),
) {
  return fulfillmentType === "delivery" && subtotalAmount < freeShippingThreshold ? fee : 0;
}

export function createOrderIdentity(createdAt: string) {
  const id = crypto.randomUUID();
  const date = createdAt.slice(2, 10).replace(/-/g, "");
  const nonce = id.replace(/-/g, "").slice(0, 10).toLocaleUpperCase("en-US");
  return { id, orderCode: `TP88-${date}-${nonce}` };
}

export function createTrackingToken() {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function hashTrackingToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
