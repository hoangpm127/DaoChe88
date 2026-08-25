import { Banknote, Bike, BriefcaseBusiness, Building2, CreditCard, Gift, GraduationCap, Heart, Home, LucideIcon, MapPin, MapPinned, MessageCircleMore, QrCode, ReceiptText, ShieldCheck, ShoppingBag, Sparkles, UserRound, UsersRound, CalendarDays, Coffee } from "lucide-react";

export type TabId = "home" | "nearby" | "group" | "orders" | "offers" | "affiliate" | "account";

export type PaymentMethod = "qr" | "cash";

export type GroupProfileKind = "student" | "office" | "building" | "family" | "self-ship";

export type AccountServiceId = "payments" | "security" | "support" | "privacy";

/**
 * Mô tả dịch vụ tài khoản: chỉ còn chữ mô tả CHÍNH SÁCH, không còn con số.
 *
 * Bản trước có phần `metrics` kiểu "01 Thiết bị · 100% SĐT xác minh · 0 Cảnh báo"
 * và các nhãn "Đã liên kết", "2 hồ sơ" — không có gì đằng sau, chỉ là chữ trong
 * mã nguồn. Số liệu về tài khoản phải đọc từ /api/customers/me; ở đây giữ đúng
 * phần mô tả cách hệ thống hoạt động, vốn là nội dung tĩnh có thật.
 */
export type AccountServiceDetail = {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  items: Array<{ title: string; note: string }>;
  action: string;
  success: string;
};

export const accountServiceDetails: Record<AccountServiceId, AccountServiceDetail> = {
  payments: {
    icon: CreditCard,
    eyebrow: "THANH TOÁN & HÓA ĐƠN",
    title: "Thanh toán theo cách bạn tiện nhất",
    description: "Đảo Chè nhận VietQR và tiền mặt khi nhận món. Phương thức bạn chọn được lưu trên thiết bị này, hệ thống vẫn hỏi lại trước khi hoàn tất đơn.",
    items: [
      { title: "VietQR ngân hàng", note: "Mỗi đơn có một mã riêng, hệ thống tự đối chiếu số tiền về đúng đơn." },
      { title: "Tiền mặt khi nhận món", note: "Trả trực tiếp cho nhân viên hoặc shipper; đơn được ghi nhận đã thu khi giao xong." },
      { title: "Hóa đơn", note: "Cần xuất hóa đơn cho đơn của công ty thì ghi vào ô ghi chú khi đặt, cửa hàng sẽ liên hệ lại." },
    ],
    action: "Dùng VietQR cho đơn này",
    success: "Đã chọn VietQR làm phương thức thanh toán.",
  },
  security: {
    icon: ShieldCheck,
    eyebrow: "BẢO MẬT TÀI KHOẢN",
    title: "Cách tài khoản của bạn được bảo vệ",
    description: "Đăng nhập bằng số điện thoại và mật khẩu. Sai mật khẩu nhiều lần liên tiếp thì tài khoản tạm khoá một lúc để chặn dò mật khẩu.",
    items: [
      { title: "Mật khẩu", note: "Được lưu dưới dạng băm, kể cả quản trị viên cũng không đọc được mật khẩu của bạn." },
      { title: "Quên mật khẩu", note: "Chưa có kênh gửi mã xác minh qua tin nhắn, nên hiện chưa thể tự đặt lại. Bạn liên hệ cửa hàng để được hỗ trợ." },
      { title: "Đăng xuất", note: "Đăng xuất sẽ thu hồi phiên trên máy chủ, không chỉ xoá trên máy này." },
    ],
    action: "Đã hiểu",
    success: "",
  },
  support: {
    icon: MessageCircleMore,
    eyebrow: "TRUNG TÂM HỖ TRỢ",
    title: "Cần gì, Đảo Chè hỗ trợ ngay",
    description: "Tin nhắn của bạn được ghi thành yêu cầu hỗ trợ và chuyển tới người phụ trách điểm bán.",
    items: [
      { title: "Hỏi về món", note: "Thành phần, độ ngọt, dị ứng hoặc tiến độ chuẩn bị." },
      { title: "Phản hồi đơn gần nhất", note: "Nêu rõ mã đơn để cửa hàng tra lại nhanh hơn." },
      { title: "Hoàn tiền", note: "Yêu cầu hoàn được xử lý theo từng đơn và ghi vào sổ đối soát." },
    ],
    action: "Bắt đầu chat hỗ trợ",
    success: "Đã mở yêu cầu hỗ trợ.",
  },
  privacy: {
    icon: ReceiptText,
    eyebrow: "DỮ LIỆU & QUYỀN RIÊNG TƯ",
    title: "Bạn kiểm soát dữ liệu của mình",
    description: "Hệ thống lưu hồ sơ, địa chỉ giao, lịch sử đơn và điểm thưởng của bạn để phục vụ đặt món.",
    items: [
      { title: "Dữ liệu vị trí", note: "Chỉ dùng để tính phí giao và tìm điểm bán gần nhất; vị trí shipper tự xoá sau thời hạn lưu trữ." },
      { title: "Yêu cầu xoá tài khoản", note: "Liên hệ hỗ trợ để gửi yêu cầu; dữ liệu kế toán bắt buộc giữ theo quy định vẫn được lưu ở dạng ẩn danh." },
      { title: "Điều khoản", note: "Bạn xác nhận Điều khoản và Chính sách quyền riêng tư ở bước đặt đơn." },
    ],
    action: "Mở chính sách quyền riêng tư",
    success: "",
  },
};

export const groupProfileTypes: Array<{
  id: GroupProfileKind;
  icon: LucideIcon;
  title: string;
  shortTitle: string;
  note: string;
  defaultName: string;
  defaultPayment: string;
  shippingMode: "delivery" | "pickup";
}> = [
  {
    id: "student",
    icon: GraduationCap,
    title: "Đặt nhóm Sinh viên",
    shortTitle: "Sinh viên",
    note: "Chia bill rõ ràng · ưu tiên món giá mềm",
    defaultName: "Nhóm sinh viên",
    defaultPayment: "Chủ phòng thanh toán chung",
    shippingMode: "delivery",
  },
  {
    id: "office",
    icon: BriefcaseBusiness,
    title: "Đặt nhóm Văn phòng",
    shortTitle: "Văn phòng",
    note: "Tem theo tên · giao lễ tân đúng giờ",
    defaultName: "Team văn phòng",
    defaultPayment: "Chủ phòng thanh toán chung",
    shippingMode: "delivery",
  },
  {
    id: "building",
    icon: Building2,
    title: "Đặt hộ Tòa nhà",
    shortTitle: "Tòa nhà",
    note: "Gom nhiều tầng · một điểm bàn giao",
    defaultName: "Cư dân cùng tòa",
    defaultPayment: "Host thanh toán chung",
    shippingMode: "delivery",
  },
  {
    id: "family",
    icon: Home,
    title: "Đặt cho Gia đình",
    shortTitle: "Gia đình",
    note: "Lưu địa chỉ nhà · đặt lại thật nhanh",
    defaultName: "Gia đình mình",
    defaultPayment: "Host thanh toán chung",
    shippingMode: "delivery",
  },
  {
    id: "self-ship",
    icon: Bike,
    title: "Đặt trước Tự Ship",
    shortTitle: "Tự ship",
    note: "Bếp làm trước · bạn chủ động nhận món",
    defaultName: "Đơn tự đến lấy",
    defaultPayment: "Host thanh toán chung",
    shippingMode: "pickup",
  },
];

export const navItems: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Trang chủ", icon: Home },
  { id: "nearby", label: "Gần bạn", icon: MapPinned },
  { id: "group", label: "I love Đảo Chè", icon: Heart },
  { id: "offers", label: "Ưu đãi", icon: Gift },
  { id: "account", label: "Tài khoản", icon: UserRound },
];

export const storeServiceIcons: Record<string, LucideIcon> = {
  "Giao nhanh": Bike,
  "Đơn nhóm": UsersRound,
  "Gói tháng": CalendarDays,
  "Nhận tại quầy": ShoppingBag,
  "Đơn văn phòng": BriefcaseBusiness,
  Coffee,
  "Đảo Chè": Sparkles,
  "Chè signature": Sparkles,
  "Đối tác xác minh": ShieldCheck,
  "Đặt tại điểm": MapPin,
};

export const actionHubVerses = [
  ["Quê hương là chùm khế ngọt", "Cho con trèo hái mỗi ngày…"],
  ["Một cây làm chẳng nên non", "Ba cây chụm lại nên hòn núi cao"],
  ["Bầu ơi thương lấy bí cùng", "Tuy rằng khác giống nhưng chung một giàn"],
  ["Đi một ngày đàng", "Học một sàng khôn"],
  ["Anh em như thể tay chân", "Rách lành đùm bọc, dở hay đỡ đần"],
] as const;

/**
 * Chỉ liệt kê phương thức máy chủ thật sự nhận.
 *
 * "Ví điện tử" đã bị bỏ: lib/order-logic.ts từ chối paymentMethod="wallet" bằng
 * lỗi 409 "chưa được kích hoạt". Để nó trong danh sách nghĩa là khách điền xong
 * toàn bộ thông tin rồi mới bị chặn ở bước cuối. Khi nào ví được bật thì thêm lại.
 */
export const paymentOptions: Array<{
  id: PaymentMethod;
  name: string;
  note: string;
  icon: LucideIcon;
}> = [
  {
    id: "qr",
    name: "Quét QR",
    note: "VietQR · xác nhận tức thì",
    icon: QrCode,
  },
  {
    id: "cash",
    name: "Tiền mặt",
    note: "Thanh toán khi nhận món",
    icon: Banknote,
  },
];

export const validTabs: TabId[] = ["home", "nearby", "group", "orders", "offers", "affiliate", "account"];
