/**
 * Mô hình vai trò chuẩn của hệ thống (M1, quyết định Q8).
 *
 * Nghiệp vụ thật chỉ có 7 vai trò. Bản demo trước đây khai báo 11 vai trò portal
 * (và tài liệu nói 17), phần lớn là biến thể của cùng một quyền hạn. Giữ 11 vai
 * trò nghĩa là 11 tập quyền phải rà mỗi lần đổi nghiệp vụ — nguồn lỗi phân quyền.
 *
 * Vai trò cũ KHÔNG bị xóa ngay: chúng trở thành bí danh ánh xạ về vai trò chuẩn,
 * nhờ vậy giao diện và dữ liệu hiện có vẫn chạy trong lúc chuyển đổi.
 */

/** Bảy vai trò chuẩn. Đây là giá trị được lưu trong user_role_assignments.role. */
export const canonicalRoleIds = [
  "owner",
  "kitchen",
  "store-owner",
  "store-staff",
  "shipper",
  "accountant",
  "affiliate",
  "customer",
] as const;

export type CanonicalRole = (typeof canonicalRoleIds)[number];

export function isCanonicalRole(value: unknown): value is CanonicalRole {
  return typeof value === "string" && (canonicalRoleIds as readonly string[]).includes(value);
}

/**
 * Ánh xạ vai trò portal cũ sang vai trò chuẩn.
 *
 * Cơ sở của từng dòng:
 *   super-admin, region-manager  -> owner        (toàn quyền toàn hệ thống)
 *   manager, distribution,
 *   dispatch, founder            -> store-owner  (chịu trách nhiệm một hoặc vài điểm)
 *   store                        -> store-staff  (nhận đơn, làm món tại quầy)
 *   finance, control             -> accountant   (lập và duyệt, không vận hành)
 */
const LEGACY_TO_CANONICAL: Readonly<Record<string, CanonicalRole>> = {
  "super-admin": "owner",
  "region-manager": "owner",
  kitchen: "kitchen",
  manager: "store-owner",
  distribution: "store-owner",
  dispatch: "store-owner",
  founder: "store-owner",
  store: "store-staff",
  shipper: "shipper",
  finance: "accountant",
  control: "accountant",
};

/** Đưa một mã vai trò bất kỳ (cũ hoặc chuẩn) về vai trò chuẩn. */
export function toCanonicalRole(value: string): CanonicalRole | null {
  if (isCanonicalRole(value)) return value;
  return LEGACY_TO_CANONICAL[value] ?? null;
}

export type RoleDescriptor = {
  id: CanonicalRole;
  name: string;
  /** Vai trò này có nhìn thấy toàn hệ thống, hay chỉ các điểm được gán? */
  scope: "global" | "assigned-sites" | "own-work";
  /** Vai trò này có đăng nhập vào portal vận hành không? */
  portal: boolean;
  description: string;
};

export const roleDescriptors: Readonly<Record<CanonicalRole, RoleDescriptor>> = {
  owner: {
    id: "owner",
    name: "Admin tổng",
    scope: "global",
    portal: true,
    description: "Chủ hệ thống: toàn quyền trên mọi điểm bán, bếp tổng và dữ liệu tài chính.",
  },
  kitchen: {
    id: "kitchen",
    name: "Quản lý bếp tổng",
    scope: "assigned-sites",
    portal: true,
    description: "Sản xuất, tồn thành phẩm và điều chuyển hàng xuống các cửa hàng.",
  },
  "store-owner": {
    id: "store-owner",
    name: "Chủ cửa hàng",
    scope: "assigned-sites",
    portal: true,
    description: "Chịu trách nhiệm doanh thu, chi phí và nhân sự của các điểm được gán.",
  },
  "store-staff": {
    id: "store-staff",
    name: "Nhân viên bán hàng",
    scope: "assigned-sites",
    portal: true,
    description: "Nhận đơn, làm món, thu tiền và bàn giao tại quầy.",
  },
  shipper: {
    id: "shipper",
    name: "Shipper",
    scope: "own-work",
    portal: true,
    description: "Chỉ thấy các đơn được gán cho mình.",
  },
  accountant: {
    id: "accountant",
    name: "Kế toán",
    scope: "global",
    portal: true,
    description: "Đối soát, duyệt chi và báo cáo. Không trực tiếp vận hành điểm bán.",
  },
  customer: {
    id: "customer",
    name: "Khách hàng",
    scope: "own-work",
    portal: false,
    description: "Khách có tài khoản: xem đơn của chính mình, điểm thưởng và ưu đãi.",
  },
  affiliate: {
    id: "affiliate",
    name: "Cộng tác viên",
    scope: "own-work",
    portal: false,
    description: "Xem hoa hồng của chính mình ở phía khách hàng, không vào portal vận hành.",
  },
};

/** Phạm vi dữ liệu đã giải cho một phiên — đọc từ user_role_assignments, KHÔNG hardcode. */
export type PortalScope = {
  userId: string;
  role: PortalCapableRole;
  /** true khi vai trò nhìn toàn hệ thống; khi đó siteIds không được dùng để lọc. */
  isGlobal: boolean;
  siteIds: readonly string[];
};

/**
 * Vai trò dùng được ở portal vận hành — tức mọi vai trò chuẩn TRỪ affiliate.
 * Tách thành kiểu riêng để trình biên dịch chặn việc truyền affiliate vào các
 * hàm phân quyền của portal, thay vì phải nhớ kiểm tra bằng tay.
 */
export type PortalCapableRole = Exclude<CanonicalRole, "affiliate" | "customer">;

/**
 * Vai trò dùng được ở portal vận hành.
 * Là type guard nên sau khi kiểm, trình biên dịch tự thu hẹp về PortalCapableRole.
 */
export function isPortalCapableRole(role: CanonicalRole): role is PortalCapableRole {
  return roleDescriptors[role].portal;
}

export function listCanonicalRoles(): RoleDescriptor[] {
  return canonicalRoleIds.map((id) => roleDescriptors[id]);
}
