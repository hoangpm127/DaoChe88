/**
 * Sổ đăng ký thông số nghiệp vụ M14.
 *
 * Mỗi thông số chỉ được khai báo tại đây. Các module sau chỉ được nối nghiệp vụ
 * vào khóa đã đăng ký hoặc thêm một khai báo mới ở cuối mảng; giao diện quản
 * trị đọc chính sổ này nên không có danh sách field hardcode thứ hai.
 */

import { OperationsError } from "./operations-error.ts";

export type SettingGroup = "order" | "payment" | "delivery" | "commission" | "inventory" | "finance" | "security" | "loyalty";
export type SettingValueType = "integer" | "money" | "percent_bps" | "duration_seconds" | "string" | "enum" | "boolean" | "list";
export type SettingScopeType = "global" | "site";
export type SettingValue = string | number | boolean | Array<string | number>;

export type SettingDefinition = {
  key: string;
  group: SettingGroup;
  label: string;
  description: string;
  type: SettingValueType;
  defaultValue: SettingValue;
  min?: number;
  max?: number;
  itemMin?: number;
  itemMax?: number;
  options?: string[];
  editableRoles: string[];
  siteEditableRoles?: string[];
  allowSiteOverride: boolean;
  safetyNote?: string;
};

const owner = ["owner", "super-admin"];
const storeOwner = ["store-owner", "manager", "distribution"];

export const SETTINGS_REGISTRY: readonly SettingDefinition[] = [
  { key: "order.max_lines", group: "order", label: "Số dòng món tối đa", description: "Giới hạn số dòng món khác nhau trong một đơn.", type: "integer", defaultValue: 50, min: 1, max: 200, editableRoles: owner, allowSiteOverride: false },
  { key: "order.max_total_quantity", group: "order", label: "Tổng số phần tối đa", description: "Tổng số lượng tất cả món được nhận trong một đơn.", type: "integer", defaultValue: 500, min: 1, max: 2_000, editableRoles: owner, allowSiteOverride: false },
  { key: "order.max_quantity_per_line", group: "order", label: "Số phần tối đa mỗi dòng", description: "Chặn nhập nhầm số lượng quá lớn cho một món.", type: "integer", defaultValue: 99, min: 1, max: 500, editableRoles: owner, allowSiteOverride: false },
  { key: "order.item_note_max_chars", group: "order", label: "Độ dài ghi chú món", description: "Số ký tự tối đa cho ghi chú trên từng dòng món.", type: "integer", defaultValue: 240, min: 0, max: 1_000, editableRoles: owner, allowSiteOverride: false },
  { key: "order.note_max_chars", group: "order", label: "Độ dài ghi chú đơn", description: "Số ký tự tối đa cho ghi chú chung của đơn hàng.", type: "integer", defaultValue: 500, min: 0, max: 2_000, editableRoles: owner, allowSiteOverride: false },
  { key: "order.promised_past_tolerance_seconds", group: "order", label: "Dung sai giờ nhận món", description: "Cho phép thời gian khách gửi lên chậm hơn hiện tại trong giới hạn này.", type: "duration_seconds", defaultValue: 300, min: 0, max: 3_600, editableRoles: owner, allowSiteOverride: false },
  { key: "order.promised_max_advance_seconds", group: "order", label: "Đặt trước tối đa", description: "Khoảng thời gian xa nhất khách được chọn ngày nhận món.", type: "duration_seconds", defaultValue: 604_800, min: 3_600, max: 2_592_000, editableRoles: owner, allowSiteOverride: false },
  { key: "payment.sepay_window_seconds", group: "payment", label: "Thời hạn mã VietQR", description: "Khoảng thời gian mã thanh toán được giữ trước khi hết hạn.", type: "duration_seconds", defaultValue: 900, min: 300, max: 86_400, editableRoles: owner, allowSiteOverride: false },
  { key: "delivery.default_fee_vnd", group: "delivery", label: "Phí giao mặc định", description: "Phí giao nội bộ mặc định trước khi M9 áp bảng quy tắc khoảng cách.", type: "money", defaultValue: 15_000, min: 0, max: 200_000, editableRoles: owner, siteEditableRoles: [...owner, ...storeOwner], allowSiteOverride: true },
  { key: "delivery.free_shipping_threshold_vnd", group: "delivery", label: "Ngưỡng miễn phí giao", description: "Đơn đạt giá trị này được miễn phí giao mặc định.", type: "money", defaultValue: 300_000, min: 0, max: 10_000_000, editableRoles: owner, siteEditableRoles: [...owner, ...storeOwner], allowSiteOverride: true },
  { key: "delivery.shipper_location_retention_seconds", group: "delivery", label: "Thời hạn lưu vị trí shipper", description: "Vị trí shipper phải được xóa khi hết thời hạn bảo vệ dữ liệu cá nhân.", type: "duration_seconds", defaultValue: 604_800, min: 3_600, max: 604_800, editableRoles: owner, allowSiteOverride: false, safetyNote: "Không được vượt 7 ngày để tuân thủ nguyên tắc giới hạn thời gian lưu dữ liệu vị trí cá nhân theo Nghị định 13/2023." },
  { key: "delivery.pod_required_over_vnd", group: "delivery", label: "Ngưỡng bắt buộc POD", description: "Đơn từ giá trị này phải có OTP hoặc ảnh trước khi xác nhận giao xong; đơn COD luôn bắt buộc.", type: "money", defaultValue: 200_000, min: 0, max: 5_000_000, editableRoles: owner, allowSiteOverride: true },
  { key: "delivery.pod_photo_retention_seconds", group: "delivery", label: "Thời hạn giữ ảnh POD", description: "Ảnh bằng chứng giao hàng hết hạn sẽ tự động bị xóa khỏi Railway Volume.", type: "duration_seconds", defaultValue: 7_776_000, min: 86_400, max: 7_776_000, editableRoles: owner, allowSiteOverride: false, safetyNote: "Không được vượt 90 ngày để volume không tăng vô hạn và giới hạn dữ liệu cá nhân được lưu." },
  { key: "delivery.lalamove_fee_increase_tolerance_bps", group: "delivery", label: "Dung sai tăng phí Lalamove", description: "Nếu báo giá lúc gọi xe tăng quá tỷ lệ này so với báo giá checkout thì chuyển sang shipper nội bộ.", type: "percent_bps", defaultValue: 2_000, min: 0, max: 10_000, editableRoles: owner, allowSiteOverride: false },
  { key: "delivery.route_max_items", group: "delivery", label: "Số phần tối đa mỗi tuyến", description: "Tổng số phần tối đa trong một gợi ý gom tuyến shipper.", type: "integer", defaultValue: 30, min: 1, max: 100, editableRoles: owner, allowSiteOverride: true },
  { key: "commission.affiliate_tiers_bps", group: "commission", label: "Các bậc hoa hồng Affiliate", description: "Danh sách tỷ lệ basis point; 900 tương ứng 9%.", type: "list", defaultValue: [0, 600, 800, 1_000], itemMin: 0, itemMax: 2_000, editableRoles: owner, allowSiteOverride: false, safetyNote: "Mỗi bậc không vượt 20% để bảo vệ biên lợi nhuận." },
  { key: "commission.affiliate_attribution_window_seconds", group: "commission", label: "Cửa sổ quy kết Affiliate", description: "Thời gian một lượt giới thiệu còn hiệu lực.", type: "duration_seconds", defaultValue: 604_800, min: 3_600, max: 2_592_000, editableRoles: owner, allowSiteOverride: false },
  { key: "commission.affiliate_dispute_window_seconds", group: "commission", label: "Thời hạn khiếu nại Affiliate", description: "Thời gian cho phép gửi khiếu nại sau ghi nhận hoa hồng.", type: "duration_seconds", defaultValue: 86_400, min: 3_600, max: 604_800, editableRoles: owner, allowSiteOverride: false },
  { key: "commission.group_host_bps", group: "commission", label: "Hoa hồng chủ phòng nhóm", description: "Tỷ lệ basis point áp dụng cho đơn nhóm đủ điều kiện.", type: "percent_bps", defaultValue: 0, min: 0, max: 2_000, editableRoles: owner, allowSiteOverride: false },
  { key: "order.group_min_people", group: "order", label: "Số người tối thiểu của đơn nhóm", description: "Số thành viên tối thiểu để áp dụng quyền lợi đơn nhóm.", type: "integer", defaultValue: 3, min: 2, max: 100, editableRoles: owner, allowSiteOverride: false },
  { key: "finance.expense_categories", group: "finance", label: "Danh mục chi phí", description: "Các nhóm được phép dùng khi cửa hàng ghi nhận chi phí.", type: "list", defaultValue: ["ingredients", "packaging", "utilities", "rent", "salary", "marketing", "maintenance", "delivery", "refund", "other", "Nguyên liệu", "Bao bì", "Hao hụt", "Lương", "Thuê mặt bằng", "Điện nước", "Vệ sinh", "Sửa chữa", "Giao hỗ trợ", "Marketing", "Phí thanh toán", "Thuế", "CAPEX", "Vật tư vận hành", "Khác"], editableRoles: [...owner, "accountant", "finance"], allowSiteOverride: false },
  { key: "finance.shift_variance_explanation_vnd", group: "finance", label: "Ngưỡng giải trình chênh lệch quỹ", description: "Chênh lệch từ mức này sẽ bắt buộc ghi rõ lý do khi M8 đối soát.", type: "money", defaultValue: 20_000, min: 0, max: 500_000, editableRoles: owner, siteEditableRoles: [...owner, ...storeOwner], allowSiteOverride: true, safetyNote: "Ngưỡng không được vượt 500.000đ để tránh che khuất sai lệch tiền mặt lớn." },
  { key: "finance.default_internal_credit_limit_vnd", group: "finance", label: "Hạn mức công nợ nội bộ mặc định", description: "Giá trị mặc định để M10 khởi tạo hạn mức theo điểm.", type: "money", defaultValue: 0, min: 0, max: 1_000_000_000, editableRoles: owner, allowSiteOverride: true },
  { key: "security.portal_session_ttl_seconds", group: "security", label: "Thời hạn phiên Portal", description: "Thời gian phiên đăng nhập vận hành còn hiệu lực.", type: "duration_seconds", defaultValue: 28_800, min: 900, max: 86_400, editableRoles: owner, allowSiteOverride: false, safetyNote: "Phiên không được dài hơn 24 giờ để giảm rủi ro khi thiết bị bị bỏ quên." },
  { key: "loyalty.points_expiry_seconds", group: "loyalty", label: "Thời hạn điểm thưởng", description: "Thời gian điểm thưởng còn hiệu lực sau khi phát sinh.", type: "duration_seconds", defaultValue: 31_536_000, min: 2_592_000, max: 63_072_000, editableRoles: owner, allowSiteOverride: false },
  { key: "loyalty.points_per_1000_vnd", group: "loyalty", label: "Điểm thưởng trên mỗi 1.000đ", description: "Số điểm cộng cho khách trên mỗi 1.000đ giá trị hàng (không tính phí giao).", type: "integer", defaultValue: 1, min: 0, max: 100, editableRoles: owner, allowSiteOverride: false, safetyNote: "Tỷ lệ quá cao sẽ biến điểm thưởng thành khoản nợ lớn hơn biên lợi nhuận." },
  { key: "loyalty.max_discount_bps_per_order", group: "loyalty", label: "Trần giảm giá mỗi đơn", description: "Tổng giảm giá từ khuyến mãi không được vượt tỷ lệ này của tiền hàng.", type: "percent_bps", defaultValue: 5_000, min: 0, max: 10_000, editableRoles: owner, allowSiteOverride: false, safetyNote: "Không cho phép giảm quá 100% tiền hàng." },
  { key: "payment.bank_statement_max_rows", group: "payment", label: "Số dòng sao kê tối đa mỗi lần", description: "Giới hạn kích thước một lần nhập sao kê để bảo vệ tài nguyên hệ thống.", type: "integer", defaultValue: 10_000, min: 100, max: 50_000, editableRoles: owner, allowSiteOverride: false },
] as const;

const registryByKey = new Map(SETTINGS_REGISTRY.map((definition) => [definition.key, definition]));

export function settingDefinition(key: string) {
  return registryByKey.get(key) || null;
}

export function defaultSettingValue<T extends SettingValue = SettingValue>(key: string): T {
  const definition = settingDefinition(key);
  if (!definition) throw new OperationsError(`Thông số ${key} chưa được đăng ký.`, 400, "unknown_setting");
  return structuredClone(definition.defaultValue) as T;
}

function rangeError(definition: SettingDefinition) {
  const range = [definition.min !== undefined ? `từ ${definition.min}` : "", definition.max !== undefined ? `đến ${definition.max}` : ""].filter(Boolean).join(" ");
  return `${definition.label} chỉ được đặt ${range || "trong phạm vi an toàn"}.${definition.safetyNote ? ` ${definition.safetyNote}` : ""}`;
}

export function validateSettingValue(definition: SettingDefinition, value: unknown): SettingValue {
  if (["integer", "money", "percent_bps", "duration_seconds"].includes(definition.type)) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new OperationsError(`${definition.label} phải là số nguyên.`, 400, "invalid_setting_value");
    if ((definition.min !== undefined && number < definition.min) || (definition.max !== undefined && number > definition.max)) {
      throw new OperationsError(rangeError(definition), 400, "setting_out_of_range");
    }
    return number;
  }
  if (definition.type === "boolean") {
    if (typeof value !== "boolean") throw new OperationsError(`${definition.label} phải là bật hoặc tắt.`, 400, "invalid_setting_value");
    return value;
  }
  if (definition.type === "string" || definition.type === "enum") {
    if (typeof value !== "string" || !value.trim()) throw new OperationsError(`${definition.label} không được để trống.`, 400, "invalid_setting_value");
    const normalized = value.trim();
    if (definition.options && !definition.options.includes(normalized)) throw new OperationsError(`${definition.label} không nhận giá trị này.`, 400, "invalid_setting_value");
    return normalized;
  }
  if (definition.type === "list") {
    if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new OperationsError(`${definition.label} phải là danh sách từ 1 đến 100 giá trị.`, 400, "invalid_setting_value");
    if (definition.key === "commission.affiliate_tiers_bps") {
      const values = value.map(Number);
      if (values.some((item) => !Number.isSafeInteger(item) || item < (definition.itemMin ?? 0) || item > (definition.itemMax ?? Number.MAX_SAFE_INTEGER))) {
        throw new OperationsError(`${definition.label} chỉ nhận số nguyên từ ${definition.itemMin} đến ${definition.itemMax}. ${definition.safetyNote}`, 400, "setting_out_of_range");
      }
      if (!values.includes(0)) throw new OperationsError("Danh sách bậc Affiliate phải có bậc 0%.", 400, "invalid_setting_value");
      return [...new Set(values)].sort((left, right) => left - right);
    }
    const values = value.map((item) => typeof item === "string" ? item.trim() : "");
    if (values.some((item) => !item || item.length > 80)) throw new OperationsError(`${definition.label} có mục rỗng hoặc dài quá 80 ký tự.`, 400, "invalid_setting_value");
    return [...new Set(values)];
  }
  throw new OperationsError(`Kiểu của thông số ${definition.key} chưa được hỗ trợ.`, 500, "unsupported_setting_type");
}
