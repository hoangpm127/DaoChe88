import { Bell, Building2, Camera, ChevronRight, CreditCard, Heart, LogIn, LogOut, MapPin, MessageCircleMore, ReceiptText, ShieldCheck, Store, UserRound } from "lucide-react";
import styles from "../customer.module.css";
import { AccountServiceId } from "../data/content";
import { money } from "../lib/order-utils";
import { SectionTitle } from "../controller";
import { loyaltyTierLabels, type OrderController } from "../controller";

type AccountTabProps = { model: OrderController };

/**
 * Tab Tài khoản.
 *
 * Trước đây phần đầu trang là số liệu viết cứng: "Thành viên từ 03/2025 · hạng
 * Mầm xanh", "37 đơn · 426k đã tiết kiệm · 286k hoa hồng · chuỗi 6 tuần", cùng
 * một "Gói Đam mê 5/8 lượt" không có bảng dữ liệu nào đứng sau. Ai mở app cũng
 * thấy y hệt nhau vì không có gì đọc từ máy chủ.
 *
 * Nay: chưa đăng nhập thì mời đăng nhập; đã đăng nhập thì mọi con số lấy từ
 * GET /api/customers/me, và bằng 0 khi khách chưa mua gì.
 */
export default function AccountTab({ model }: AccountTabProps) {
  const {
    accountLoading,
    customer,
    customerAccount,
    customerInitials,
    customerSession,
    favorites,
    flash,
    goTo,
    location,
    openAuthSheet,
    openProfileEditor,
    setSelectedAccountService,
    setShowFavorites,
    setShowLocation,
    setShowNotifications,
    signOutCustomer,
  } = model;

  const account = customerAccount?.customer;
  const displayName = account?.displayName || customerSession?.userName || customer.name;
  const savedAddress = customerAccount?.addresses.find((item) => item.is_default) || customerAccount?.addresses[0];

  return (
    <section className={styles.tabPage}>
      {!customerSession ? (
        <div className={styles.accountSignedOut}>
          <span className={styles.accountSignedOutIcon}><UserRound size={30} /></span>
          <h1>Chưa đăng nhập</h1>
          <p>Đăng nhập để giữ lịch sử đơn, điểm thưởng và ưu đãi của riêng bạn trên mọi thiết bị.</p>
          <div className={styles.accountSignedOutActions}>
            <button className={styles.primaryButton} type="button" onClick={() => openAuthSheet("login")}>
              <LogIn size={17} /> Đăng nhập
            </button>
            <button type="button" onClick={() => openAuthSheet("register")}>Tạo tài khoản mới</button>
          </div>
          <small>Bạn vẫn đặt món được mà không cần tài khoản.</small>
        </div>
      ) : (
        <div className={styles.accountProfileHero}>
          <div className={styles.profileHeader}>
            <span
              className={styles.profileAvatar}
              role="img"
              aria-label={`Ảnh đại diện của ${displayName}`}
              style={customer.avatar ? { backgroundImage: `url(${customer.avatar})` } : undefined}
            >
              {!customer.avatar && <b>{customerInitials}</b>}
              <i><Camera size={11} /></i>
            </span>
            <div>
              <div className={styles.profileName}>
                <h1>{displayName}</h1>
                {account?.phoneVerified && <em>ĐÃ XÁC MINH</em>}
              </div>
              <p>Hạng {loyaltyTierLabels[account?.loyaltyTier || "member"] || account?.loyaltyTier}</p>
              <small>{customer.birthday ? "Hồ sơ đã có ngày sinh" : "Chưa có ngày sinh trong hồ sơ"}</small>
            </div>
            <button type="button" onClick={openProfileEditor}>
              Sửa hồ sơ
            </button>
          </div>
          <div className={styles.profileQuickStats}>
            <button type="button" onClick={() => goTo("orders")}>
              <strong>{accountLoading && !account ? "…" : account?.orderCount ?? 0}</strong>
              <small>Đơn đã đặt</small>
            </button>
            <button type="button" onClick={() => flash("Điểm được cộng khi đơn giao thành công.")}>
              <strong>{accountLoading && !account ? "…" : account?.loyaltyPoints ?? 0}</strong>
              <small>Điểm thưởng</small>
            </button>
            <button type="button" onClick={() => goTo("offers")}>
              <strong>{customerAccount?.promotions.length ?? 0}</strong>
              <small>Ưu đãi dùng được</small>
            </button>
            <button type="button" onClick={() => goTo("affiliate")}>
              <strong>{money(account?.lifetimeValue || 0)}</strong>
              <small>Tổng đã mua</small>
            </button>
          </div>
        </div>
      )}

      <SectionTitle title="Địa chỉ giao mặc định" action="Quản lý" onAction={() => setShowLocation(true)} />
      {savedAddress || location.address ? (
        <button className={styles.savedAddressCard} type="button" onClick={() => setShowLocation(true)}>
          <span>
            <Building2 size={21} />
          </span>
          <div>
            <small>{(savedAddress?.label || location.name || "ĐỊA CHỈ").toLocaleUpperCase("vi-VN")}{location.coordinates ? ` · ${location.coordinates}` : ""}</small>
            <strong>{savedAddress?.recipient_name || location.office || "Chưa đặt tên"}</strong>
            <p>{savedAddress?.formatted_address || location.address}</p>
            {location.detail && <em>{location.detail}</em>}
          </div>
          <ChevronRight size={17} />
        </button>
      ) : (
        <button className={styles.savedAddressEmpty} type="button" onClick={() => setShowLocation(true)}>
          <MapPin size={20} />
          <div>
            <strong>Chưa có địa chỉ giao</strong>
            <small>Thêm địa chỉ để tính phí giao và tìm điểm bán gần nhất.</small>
          </div>
          <ChevronRight size={17} />
        </button>
      )}

      {customerSession && (customerAccount?.loyaltyHistory.length ?? 0) > 0 && (
        <>
          <SectionTitle title="Điểm thưởng gần đây" />
          <div className={styles.loyaltyList}>
            {customerAccount!.loyaltyHistory.slice(0, 5).map((entry) => (
              <div key={`${entry.created_at}-${entry.description}`}>
                <div>
                  <strong>{entry.description}</strong>
                  <small>{new Date(entry.created_at).toLocaleDateString("vi-VN")}</small>
                </div>
                <b className={entry.points >= 0 ? styles.loyaltyEarn : styles.loyaltySpend}>
                  {entry.points >= 0 ? "+" : ""}{entry.points}
                </b>
                <em>Còn {entry.balance_after}</em>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle title="Tài khoản & dịch vụ" />
      <div className={styles.accountMenu}>
        {[
          { id: "addresses", icon: MapPin, title: "Sổ địa chỉ", note: customerAccount?.addresses.length ? `${customerAccount.addresses.length} địa chỉ đã lưu` : "Chưa lưu địa chỉ nào" },
          { id: "payments", icon: CreditCard, title: "Thanh toán & hóa đơn", note: "VietQR và tiền mặt khi nhận món" },
          { id: "favorites", icon: Heart, title: "Món yêu thích", note: favorites.length ? `${favorites.length} món đã ghi nhớ` : "Chưa ghi nhớ món nào" },
          { id: "notifications", icon: Bell, title: "Thông báo", note: customerSession ? "Đơn hàng, phòng nhóm, hoa hồng" : "Đăng nhập để nhận thông báo" },
          { id: "stores", icon: Store, title: "Điểm phục vụ", note: location.servicePoint ? `${location.servicePoint} · cách ${location.distance}` : "Chọn địa chỉ để tìm điểm gần nhất" },
          { id: "security", icon: ShieldCheck, title: "Bảo mật tài khoản", note: "Cách mật khẩu và phiên đăng nhập được bảo vệ" },
          { id: "support", icon: MessageCircleMore, title: "Trung tâm hỗ trợ", note: "Chat với cửa hàng · phản hồi đơn" },
          { id: "privacy", icon: ReceiptText, title: "Dữ liệu & quyền riêng tư", note: "Dữ liệu được lưu và cách yêu cầu xoá" },
          { id: "role-switch", icon: LogOut, title: "Vào không gian vận hành", note: "Đăng nhập bằng tài khoản nội bộ; vai trò do quản trị phân công" },
        ].map(({ id, icon: Icon, title, note }) => (
          <button
            type="button"
            key={id}
            onClick={() => {
              if (id === "addresses") setShowLocation(true);
              else if (id === "favorites") setShowFavorites(true);
              else if (id === "notifications") setShowNotifications(true);
              else if (id === "stores") goTo("nearby");
              else if (id === "role-switch") window.location.href = "/portal";
              else setSelectedAccountService(id as AccountServiceId);
            }}
          >
            <span>
              <Icon size={19} />
            </span>
            <div>
              <strong>{title}</strong>
              <small>{note}</small>
            </div>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>

      {customerSession && (
        <button className={styles.signOutButton} type="button" onClick={() => void signOutCustomer()}>
          <LogOut size={17} /> Đăng xuất
        </button>
      )}
    </section>
  );
}
