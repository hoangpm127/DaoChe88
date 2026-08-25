import { ArrowLeft, Bell, ChevronDown, ChevronRight, DollarSign, Heart, MapPin, MessageCircleMore, ReceiptText, Search, ShoppingBag, SlidersHorizontal, X } from "lucide-react";
import styles from "./customer.module.css";
import { navItems } from "./data/content";
import { money } from "./lib/order-utils";
import { Brand } from "./controller";
import type { OrderController } from "./controller";
import HomeTab from "./tabs/HomeTab";
import NearbyTab from "./tabs/NearbyTab";
import GroupTab from "./tabs/GroupTab";
import OrdersTab from "./tabs/OrdersTab";
import OffersTab from "./tabs/OffersTab";
import AffiliateTab from "./tabs/AffiliateTab";
import AccountTab from "./tabs/AccountTab";
import CatalogView from "./tabs/CatalogView";
import StoreFilters from "./tabs/StoreFilters";

type OrderShellProps = { model: OrderController };

export default function OrderShell({ model }: OrderShellProps) {
  const { activeTab, cartCount, cartPreview, cartTotal, customerAccount, favorites, goBack, goTo, groupRoom, hasBackNavigation, location, openCart, query, setQuery, setShowCartDecision, setShowChat, setShowFavorites, setShowFilters, setShowLocation, setShowNearbyActions, setShowNotifications, showAllProducts, showNearbyActions } = model;
  // Số chưa đọc đến từ bảng notifications của tài khoản đang đăng nhập. Chưa
  // đăng nhập thì không có thông báo nào, và huy hiệu không hiện.
  const unreadCount = (customerAccount?.notifications || []).filter((item) => !item.read_at).length;
  const tabs = { home: HomeTab, nearby: NearbyTab, group: GroupTab, orders: OrdersTab, offers: OffersTab, affiliate: AffiliateTab, account: AccountTab };
  const ActiveTab = tabs[activeTab];
  return <div className={styles.customerShell}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.brandCluster}>
              {hasBackNavigation && (
                <button className={styles.backButton} type="button" aria-label="Quay lại thao tác trước" onClick={goBack}>
                  <ArrowLeft size={20} />
                </button>
              )}
              <Brand />
            </div>
            <div className={styles.headerActions}>
              <button className={`${styles.topbarIconButton} ${styles.chatHeaderButton}`} type="button" aria-label="Mở Chat tư vấn Tào Phớ 88" onClick={() => setShowChat(true)}>
                <MessageCircleMore size={20} />
                <span className={styles.aiPulse}>AI</span>
              </button>
              <button className={styles.topbarIconButton} type="button" aria-label="Mở sổ địa chỉ giao hàng" onClick={() => setShowLocation(true)}>
                <MapPin size={20} />
              </button>
              <button className={`${styles.topbarIconButton} ${styles.incomeHeaderButton}`} type="button" aria-label="Mở trung tâm Affiliate và báo cáo thu nhập" onClick={() => goTo("affiliate")}>
                <DollarSign size={21} />
              </button>
              <button className={`${styles.topbarIconButton} ${favorites.length ? styles.topbarFavoriteActive : ""}`} type="button" aria-label={`Món đã ghi nhớ: ${favorites.length}`} onClick={() => setShowFavorites(true)}>
                <Heart size={20} fill={favorites.length ? "currentColor" : "none"} />
                {favorites.length > 0 && <i>{favorites.length}</i>}
              </button>
              <button className={styles.topbarIconButton} type="button" aria-label={cartCount ? `Giỏ hàng có ${cartCount} món` : "Mở đơn hàng"} onClick={() => (cartCount ? openCart() : goTo("orders"))}>
                <ShoppingBag size={20} />
                {cartCount > 0 && <i>{cartCount}</i>}
              </button>
              <button className={styles.topbarIconButton} type="button" aria-label={unreadCount ? `${unreadCount} thông báo chưa đọc` : "Thông báo"} onClick={() => setShowNotifications(true)}>
                <Bell size={20} />
                {unreadCount > 0 && <i>{unreadCount}</i>}
              </button>
            </div>
          </div>
          {activeTab === "home" && (
            <div className={styles.searchUtilityRow}>
              <label className={styles.searchBox}>
                <Search size={19} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Món bạn muốn?" aria-label="Món bạn muốn" />
                {query && (
                  <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setQuery("")}>
                    <X size={16} />
                  </button>
                )}
              </label>
              <button className={styles.quickAddressButton} type="button" onClick={() => setShowLocation(true)}>
                <MapPin size={17} fill="currentColor" />
                <span>
                  <small>Giao tới...</small>
                  <strong>{location.name.split("·")[0].trim()}</strong>
                </span>
                <ChevronDown size={14} />
              </button>
              <button className={styles.filterButton} type="button" aria-label="Lọc món" onClick={() => setShowFilters(true)}>
                <SlidersHorizontal size={20} />
              </button>
            </div>
          )}
          {cartCount > 0 && (
            <div className={styles.miniBillBar} role="status" aria-live="polite">
              <span className={styles.miniBillIcon} aria-hidden="true">
                <ReceiptText size={17} />
              </span>
              <span className={styles.miniBillCopy}>
                <strong>{cartCount} món đã chọn</strong>
                <small>{cartPreview}</small>
              </span>
              <span className={styles.miniBillTotal}>
                <small>Tạm tính</small>
                <strong>{money(cartTotal)}</strong>
              </span>
              <button type="button" onClick={() => setShowCartDecision(true)}>
                Tiếp tục <ChevronRight size={15} />
              </button>
            </div>
          )}
          {activeTab === "nearby" && <StoreFilters model={model} />}
        </header>

        <main className={styles.main} key={`${activeTab}-${showAllProducts ? "catalog" : "page"}`}>
          {showAllProducts ? <CatalogView model={model} /> : <ActiveTab model={model} />}
        </main>

        <nav className={styles.bottomNav} aria-label="Điều hướng khách hàng">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isLoveAction = item.id === "group";
            const isActive = isLoveAction ? showNearbyActions || activeTab === "group" : activeTab === item.id;
            return (
              <button
                type="button"
                className={`${isActive ? styles.navActive : ""} ${isLoveAction ? styles.navLoveAction : ""}`}
                key={item.id}
                aria-label={isLoveAction ? "Mở trung tâm I love Tào Phớ" : item.label}
                onClick={() => (isLoveAction ? setShowNearbyActions(true) : goTo(item.id))}
              >
                <span>
                  <Icon size={isLoveAction ? 25 : 22} fill={isLoveAction ? "currentColor" : "none"} />
                  {isLoveAction && <b className={styles.navLove88} aria-hidden="true">88</b>}
                  {isLoveAction && groupRoom && <i />}
                </span>
                <small>{item.label}</small>
              </button>
            );
          })}
        </nav>
      </div>;
}
