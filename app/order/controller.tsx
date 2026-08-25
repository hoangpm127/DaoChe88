"use client";

import { Check, ChevronRight, LucideIcon, ShieldCheck, Sparkles } from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./customer.module.css";
import { type CatalogApiProduct, Product, ProductFilter, productFromCatalog } from "./data/products";
import { apiSiteToStorePoint, emptyDeliveryLocation, isOfficialStore, type DeliveryLocation, type PublicSiteApi, type StorePoint } from "./data/stores";
import { AccountServiceId, GroupProfileKind, PaymentMethod, TabId, accountServiceDetails, groupProfileTypes, validTabs } from "./data/content";
import { nearestStoreForCoordinates, pickDailyActionHubVerse, promisedAtFromSlot } from "./lib/order-utils";

export type StoreFilter = "all" | "official" | "partner";

export type Fulfillment = "delivery" | "pickup" | "dine-in";

export type CheckoutStep = "cart" | "details" | "payment";

export type ChatMode = "ai" | "human";

export type ChatContext = "menu" | "group" | "partner" | null;

export type StorePreorderMode = "dine-in" | "pickup";

export type ChatMessage = {
  id: string;
  sender: "assistant" | "user";
  text: string;
};

export type ProductChoice = {
  sweetness: string;
  temperature: string;
  topping: string;
};

export type GroupRoom = {
  code: string;
  office: string;
  slot: string;
  cutoff: string;
  participants: number;
  total: number;
  invited?: boolean;
  profileId?: string;
  kind?: GroupProfileKind;
  address?: string;
  recipient?: string;
  phone?: string;
  payment?: string;
  shippingMode?: "delivery" | "pickup";
  expiresAt: number;
  status: "open" | "locked";
  role: "host" | "guest";
  hostToken?: string;
  roster?: string[];
  items: GroupRoomItem[];
};

export type GroupRoomItem = {
  id: string;
  roomCode: string;
  guestName: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  createdAt: string;
};

export type GroupRoomResponse = {
  room?: Omit<GroupRoom, "role" | "hostToken" | "invited">;
  isHost?: boolean;
  hostToken?: string;
  error?: string;
};

export type SavedGroupProfile = {
  id: string;
  kind: GroupProfileKind;
  name: string;
  recipient: string;
  phone: string;
  address: string;
  deliveryNote: string;
  deliverySlot: string;
  cutoff: string;
  payment: string;
  shippingMode: "delivery" | "pickup";
  updatedAt?: string;
};

export type GroupProfileDraft = Omit<SavedGroupProfile, "id" | "updatedAt">;

export type CustomerDetails = {
  name: string;
  phone: string;
  address: string;
  note: string;
  slot: string;
  email?: string;
  birthday?: string;
  gender?: string;
  avatar?: string;
};

/**
 * Hồ sơ khách bắt đầu RỖNG.
 *
 * Trước đây chỗ này điền sẵn "Hà Nguyễn / 0912 888 088". Ô tên và số điện thoại
 * ở bước thanh toán đọc thẳng từ đây, còn khâu kiểm tra chỉ hỏi "có nhập chưa" —
 * nên một cái tên bịa và một số điện thoại có thể thuộc về người thật đi lọt
 * vào đơn thật trong cơ sở dữ liệu production. Bếp làm món đó, shipper gọi số đó.
 *
 * Để rỗng thì khâu kiểm tra sẵn có ở continueCheckout buộc khách phải tự nhập.
 */
export const emptyCustomerDetails: CustomerDetails = {
  name: "",
  phone: "",
  address: "",
  note: "",
  slot: "Sớm nhất có thể",
  email: "",
  gender: "",
};

/**
 * Máy nào đã mở bản cũ thì danh tính bịa vẫn nằm trong localStorage; xoá mặc
 * định trong mã nguồn không dọn được những máy đó. Nhận diện đúng bộ giá trị cũ
 * rồi bỏ đi, và chỉ bỏ khi khớp cả tên lẫn số — người thật trùng tên vẫn giữ
 * được hồ sơ họ tự nhập.
 */
const SEEDED_FAKE_IDENTITY = { name: "Hà Nguyễn", phone: "0912 888 088" } as const;

function stripSeededFakeIdentity(stored: Partial<CustomerDetails>): Partial<CustomerDetails> {
  const digits = (value: string | undefined) => (value || "").replace(/\D/g, "");
  if (stored.name?.trim() !== SEEDED_FAKE_IDENTITY.name) return stored;
  if (digits(stored.phone) !== digits(SEEDED_FAKE_IDENTITY.phone)) return stored;
  const { name: _name, phone: _phone, email: _email, gender: _gender, ...rest } = stored;
  return rest;
}

export type CustomerOrder = {
  id: string;
  createdAt: string;
  total: number;
  fee: number;
  fulfillment: Fulfillment;
  payment: PaymentMethod;
  point: string;
  customer: CustomerDetails;
  lines: Array<{ id: string; name: string; quantity: number; price: number; choice?: ProductChoice }>;
  status: "confirmed" | "preparing" | "delivering" | "completed" | "cancelled";
  paymentStatus: "pending" | "partially_paid" | "paid" | "overpaid" | "expired" | "cancelled" | "refunded";
  trackingToken?: string;
  deliveryOtp?: string | null;
  shipperLocation?: { latitudeE6: number; longitudeE6: number; accuracyM: number | null; recordedAt: string } | null;
  paymentDetails?: {
    provider: "sepay";
    paymentCode: string;
    bankCode: string;
    bankAccount: string;
    amount: number;
    receivedAmount: number;
    currency: "VND";
    status: "pending" | "partially_paid" | "paid" | "overpaid" | "expired";
    expiresAt: string;
    paidAt: string | null;
    qrUrl: string;
  };
};

export type DeliveryCheckoutQuote = {
  id: string;
  siteId: string;
  distanceMeters: number;
  subtotalAmount: number;
  fee: number;
  totalAmount: number;
  expiresAt: string;
  providerPreference: "internal" | "lalamove";
  internal: { fee: number; ruleId: string | null; freeShippingApplied: boolean };
  lalamove: { fee: number; quotationId: string; expiresAt: string } | null;
};

export type AffiliateRevenueSource = {
  id: string;
  icon: LucideIcon;
  title: string;
  location: string;
  orders: number;
  cups: number;
  sales: number;
  commission: number;
  share: number;
  daily: Array<{ date: string; orders: number; sales: number; commission: number }>;
  bills: Array<{ id: string; time: string; customer: string; coordinates: string; sales: number; commission: number }>;
};

/**
 * Phiên đăng nhập cộng tác viên.
 *
 * Thay cho AffiliateCredentials cũ (requestId + token trong localStorage). Token
 * đó nằm trên URL và trong bộ nhớ trình duyệt: ai có link là xem được hoa hồng,
 * không thu hồi được, và đổi máy là mất tài khoản.
 */
/** Địa chỉ như máy chủ trả về. `servicePointId` mang id để xoá được đúng bản ghi. */
export type ServerAddress = {
  id: string;
  label: string;
  address: string;
  instructions: string;
  isDefault: boolean;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Chuyển địa chỉ từ máy chủ sang dạng giao diện dùng.
 *
 * Khoảng cách và thời gian giao KHÔNG lấy từ đây. Trước kia chúng là chuỗi lưu
 * sẵn nên không ai tính lại và sai ngay khi khách đổi địa chỉ; nay chúng được
 * tính từ toạ độ thật ở bước báo giá.
 */
export function serverAddressToLocation(row: ServerAddress): DeliveryLocation {
  const [, office] = row.label.includes(" · ") ? row.label.split(" · ", 2) : ["", row.label];
  return {
    name: row.label,
    office: office || row.label,
    address: row.address,
    coordinates: row.latitude === null || row.longitude === null ? "" : `${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)}`,
    detail: row.instructions,
    servicePoint: "",
    servicePointId: row.id,
    distance: "Chưa xác định",
    eta: "Chưa có ước tính",
  };
}

export type AffiliateSession = { userName: string; expiresAt: string; affiliateStatus: string | null };

export type AffiliateAccount = {
  displayName: string;
  status: "pending" | "active" | "paused" | "rejected";
  commissionBps: number;
  approvedAt: string | null;
  code: string | null;
  summary: {
    orderCount: number;
    salesAmount: number;
    commissionAmount: number;
    availableAmount: number;
    pendingAmount: number;
    paidAmount: number;
  };
  recent: Array<{
    orderCode: string;
    orderStatus: string;
    salesAmount: number;
    commissionAmount: number;
    commissionStatus: string;
    createdAt: string;
  }>;
};

/**
 * Tài khoản khách (M11). Mọi số ở đây đến từ GET /api/customers/me — không có
 * giá trị mặc định "cho đẹp": chưa đăng nhập thì account = null, đăng nhập mà
 * chưa mua gì thì các mảng rỗng và điểm bằng 0.
 */
export type CustomerSession = { userName: string; expiresAt: string };

export type CustomerAccountOrder = {
  order_code: string;
  order_status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
  site_id: string;
};

export type CustomerAccountAddress = {
  id: string;
  label: string;
  recipient_name: string;
  recipient_phone: string;
  formatted_address: string;
  is_default: number;
};

export type CustomerAccountPromotion = {
  code: string;
  name: string;
  promo_type: string;
  value: number;
  min_order_amount: number;
  ends_at: string;
};

export type CustomerAccountNotification = {
  id: string;
  category: string;
  title: string;
  body: string;
  action_url: string;
  read_at: string | null;
  created_at: string;
};

export type CustomerAccountLoyalty = {
  points: number;
  transaction_type: string;
  balance_after: number;
  description: string;
  created_at: string;
};

export type CustomerAccount = {
  customer: {
    displayName: string;
    loyaltyPoints: number;
    loyaltyTier: string;
    lifetimeValue?: number;
    orderCount: number;
    phoneVerified?: boolean;
  };
  orders: CustomerAccountOrder[];
  addresses: CustomerAccountAddress[];
  promotions: CustomerAccountPromotion[];
  notifications: CustomerAccountNotification[];
  loyaltyHistory: CustomerAccountLoyalty[];
};

export const loyaltyTierLabels: Record<string, string> = {
  member: "Thành viên",
  silver: "Bạc",
  gold: "Vàng",
  platinum: "Bạch kim",
};

export function Brand() {
  return (
    <div className={styles.brand} aria-label="Đảo Chè">
      <span className={styles.brandAppIcon} aria-hidden="true" />
      <span>Đảo</span>
      <b>Chè</b>
    </div>
  );
}

/**
 * Ô màu thay ảnh khi món chưa có ảnh thật.
 *
 * Bản gốc cắt ô từ một tấm sprite ảnh chụp món của thương hiệu cũ. Đảo Chè là
 * thương hiệu riêng nên không dùng lại bộ ảnh đó được, mà ảnh chè thật thì chưa
 * chụp. Vậy nên chỗ này vẽ một ô gradient theo bảng màu mới,
 * chọn theo `index` để mỗi món vẫn có một ô riêng biệt và ổn định.
 *
 * Khi có ảnh thật, chỉ cần đặt `imageUrl` cho món trong Quản trị → Thực đơn; nhánh
 * `imageUrl` ở dưới sẽ tự động thắng, không phải sửa mã.
 */
const PHOTO_TILES: ReadonlyArray<readonly [string, string]> = [
  ["#f5a524", "#ffd79a"], // mật ong
  ["#8b5fbf", "#e5d4f4"], // khoai môn
  ["#4e9a5b", "#cfe9d3"], // lá dứa
  ["#e06c3f", "#ffd3bd"], // gấc
  ["#d9800b", "#ffe1b0"], // xoài chín
  ["#a86a4f", "#efd2c0"], // cốt dừa rang
  ["#c3487a", "#f7cfdf"], // thanh long
  ["#3f8fa8", "#cfe7ef"], // thạch mát
];

function tileBackground(index: Product["image"]) {
  const [deep, soft] = PHOTO_TILES[index % PHOTO_TILES.length];
  return `radial-gradient(120% 90% at 28% 22%, ${soft} 0%, ${deep} 72%)`;
}

export function ProductPhoto({ index, imageUrl = "" }: { index: Product["image"]; imageUrl?: string }) {
  if (imageUrl) {
    return <div className={styles.productPhoto} style={{ backgroundImage: `url(${JSON.stringify(imageUrl)})`, backgroundPosition: "center", backgroundSize: "cover" }} role="img" aria-label="Ảnh món từ catalog" />;
  }

  return <div className={styles.productPhoto} style={{ backgroundImage: tileBackground(index) }} aria-hidden="true" />;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className={styles.sectionTitle}>
      <h2>{title}</h2>
      {action && (
        <button type="button" onClick={onAction}>
          {action} <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

export function Stepper({ step }: { step: CheckoutStep }) {
  const current = step === "cart" ? 1 : step === "details" ? 2 : 3;
  return (
    <div className={styles.checkoutStepper} aria-label={`Bước ${current} trên 3`}>
      {["Giỏ món", "Giao nhận", "Thanh toán"].map((label, index) => (
        <div className={index + 1 <= current ? styles.stepActive : ""} key={label}>
          <span>{index + 1 < current ? <Check size={12} /> : index + 1}</span>
          <small>{label}</small>
          {index < 2 && <i />}
        </div>
      ))}
    </div>
  );
}

export function useOrderController() {
  const [dailyActionHubVerse] = useState(pickDailyActionHubVerse);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [previousTab, setPreviousTab] = useState<TabId>("home");
  const [category, setCategory] = useState<ProductFilter>("Chè");
  const [query, setQuery] = useState("");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [location, setLocation] = useState<DeliveryLocation>(emptyDeliveryLocation);
  // Bắt đầu RỖNG, không phải [emptyDeliveryLocation]: một dòng trống trong sổ
  // địa chỉ trông như một địa điểm đã lưu mà bấm vào thì không có gì.
  const [savedLocations, setSavedLocations] = useState<DeliveryLocation[]>([]);
  const [addressBookSynced, setAddressBookSynced] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [storePoints, setStorePoints] = useState<StorePoint[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storesError, setStoresError] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  /**
   * Điểm đánh giá tính từ bảng product_reviews (M11), khoá theo SKU.
   *
   * Món chưa có ai đánh giá thì KHÔNG có khoá trong map này, và giao diện không
   * hiện gì cả. Bản demo trước kia gắn sẵn "4.9 ★" cho mọi món.
   */
  const [productRatings, setProductRatings] = useState<Record<string, { average: number; total: number }>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartChoices, setCartChoices] = useState<Record<string, ProductChoice>>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedStore, setSelectedStore] = useState<StorePoint | null>(null);
  const [selectedServicePoint, setSelectedServicePoint] = useState("");
  const [productChoice, setProductChoice] = useState({
    sweetness: "50%",
    temperature: "Lạnh",
    topping: "Không thêm",
  });
  const [showCart, setShowCart] = useState(false);
  const [showCartDecision, setShowCartDecision] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("ai");
  const [chatContext, setChatContext] = useState<ChatContext>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      sender: "assistant",
      text: "Chào bạn, mình là trợ lý Đảo Chè. Mình có thể gợi ý món, lên đơn cho nhóm hoặc hỗ trợ tìm hiểu mở điểm bán.",
    },
  ]);
  const [showFilters, setShowFilters] = useState(false);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressDraft, setAddressDraft] = useState({
    label: "Nhà",
    office: "",
    address: "",
    detail: "",
  });
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>("cart");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("delivery");
  const [payment, setPayment] = useState<PaymentMethod>("qr");
  const [customer, setCustomer] = useState<CustomerDetails>({ ...emptyCustomerDetails });
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [profileDraft, setProfileDraft] = useState<CustomerDetails>({ ...emptyCustomerDetails });
  const [showLocation, setShowLocation] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showExperienceProgram, setShowExperienceProgram] = useState(false);
  const [selectedAccountService, setSelectedAccountService] = useState<AccountServiceId | null>(null);
  const [showAffiliateApplication, setShowAffiliateApplication] = useState(false);
  const [showPartnerApplication, setShowPartnerApplication] = useState(false);
  const [showNearbyActions, setShowNearbyActions] = useState(false);
  const [showStorePreorder, setShowStorePreorder] = useState(false);
  const [storePreorderMode, setStorePreorderMode] = useState<StorePreorderMode>("dine-in");
  const [storePreorderStoreId, setStorePreorderStoreId] = useState("");
  const [storePreorderTime, setStorePreorderTime] = useState("16:30");
  const [storePreorderPartySize, setStorePreorderPartySize] = useState("2 người");
  const [storePreorderTableLabel, setStorePreorderTableLabel] = useState("Bàn 1");
  const [showAffiliateShare, setShowAffiliateShare] = useState(false);
  const [selectedRevenueSource, setSelectedRevenueSource] = useState<AffiliateRevenueSource | null>(null);
  const [affiliateApplicationSent, setAffiliateApplicationSent] = useState(false);
  const [affiliateSession, setAffiliateSession] = useState<AffiliateSession | null>(null);
  const [showAffiliateAuth, setShowAffiliateAuth] = useState(false);
  const [affiliateAuthDraft, setAffiliateAuthDraft] = useState({ phone: "", password: "" });
  const [affiliateAuthError, setAffiliateAuthError] = useState("");
  const [affiliateAuthBusy, setAffiliateAuthBusy] = useState(false);
  const [affiliateAccount, setAffiliateAccount] = useState<AffiliateAccount | null>(null);
  const [customerSession, setCustomerSession] = useState<CustomerSession | null>(null);
  const [customerAccount, setCustomerAccount] = useState<CustomerAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [showAuthSheet, setShowAuthSheet] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authDraft, setAuthDraft] = useState({ phone: "", password: "", fullName: "" });
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [promotionCode, setPromotionCode] = useState("");
  const [partnerApplicationSent, setPartnerApplicationSent] = useState(false);
  const [affiliateDraft, setAffiliateDraft] = useState({
    name: "",
    phone: "",
    community: "Văn phòng / cơ quan",
    reach: "",
  });
  const [partnerDraft, setPartnerDraft] = useState({
    mode: "Có điểm bán sẵn",
    name: "",
    phone: "",
    business: "Quán cà phê / đồ uống",
    district: "Nam Từ Liêm",
    address: "",
    details: "",
  });
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<CustomerOrder | null>(null);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryCheckoutQuote | null>(null);
  const [deliveryQuoteLoading, setDeliveryQuoteLoading] = useState(false);
  const [deliveryQuoteError, setDeliveryQuoteError] = useState("");
  const [checkoutClientReference, setCheckoutClientReference] = useState<string | null>(null);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [toast, setToast] = useState("");

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const openProfileEditor = () => {
    setProfileDraft({ ...customer });
    setShowProfileEditor(true);
  };

  const handleProfilePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      flash("Bạn hãy chọn một tệp ảnh hợp lệ.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      flash("Ảnh đang lớn hơn 4 MB. Bạn hãy chọn ảnh nhẹ hơn.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const previewImage = new window.Image();
      previewImage.onload = () => {
        const maxSide = 480;
        const scale = Math.min(1, maxSide / previewImage.width, maxSide / previewImage.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(previewImage.width * scale));
        canvas.height = Math.max(1, Math.round(previewImage.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          flash("Chưa thể xử lý ảnh này. Bạn hãy thử một ảnh khác.");
          return;
        }
        context.fillStyle = "#edf6e8";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(previewImage, 0, 0, canvas.width, canvas.height);
        setProfileDraft((current) => ({ ...current, avatar: canvas.toDataURL("image/jpeg", 0.82) }));
      };
      previewImage.onerror = () => flash("Chưa thể đọc ảnh này. Bạn hãy thử một ảnh khác.");
      previewImage.src = String(reader.result || "");
    };
    reader.onerror = () => flash("Chưa thể đọc ảnh này. Bạn hãy thử lại.");
    reader.readAsDataURL(file);
  };

  const saveCustomerProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = profileDraft.name.trim();
    const phone = profileDraft.phone.trim();
    const email = profileDraft.email?.trim() || "";
    if (name.length < 2) {
      flash("Bạn hãy nhập họ tên đầy đủ.");
      return;
    }
    if (phone.replace(/\D/g, "").length < 9) {
      flash("Số điện thoại chưa đúng.");
      return;
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      flash("Email chưa đúng định dạng.");
      return;
    }
    setCustomer((current) => ({ ...current, ...profileDraft, name, phone, email }));
    setShowProfileEditor(false);
    flash("Hồ sơ và ảnh đại diện đã được lưu trên thiết bị này.");
  };
  const [hydrated, setHydrated] = useState(false);
  const [groupRoom, setGroupRoom] = useState<GroupRoom | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [groupClock, setGroupClock] = useState(() => Date.now());
  const [groupGuestName, setGroupGuestName] = useState("");
  const [groupProductId, setGroupProductId] = useState("");
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [showGroupShare, setShowGroupShare] = useState(false);
  const [groupRosterDraft, setGroupRosterDraft] = useState("");
  const [groupRosters, setGroupRosters] = useState<Record<string, string[]>>({});
  const [storeFilter, setStoreFilter] = useState<StoreFilter>("all");
  const [savedGroupProfiles, setSavedGroupProfiles] = useState<SavedGroupProfile[]>([]);
  const [groupProfilesLoading, setGroupProfilesLoading] = useState(true);
  const [groupProfileSaving, setGroupProfileSaving] = useState(false);
  const [showGroupSetup, setShowGroupSetup] = useState(false);
  const [editingGroupProfileId, setEditingGroupProfileId] = useState<string | null>(null);
  const [groupProfileDraft, setGroupProfileDraft] = useState<GroupProfileDraft>({
    kind: "office",
    name: "Team văn phòng",
    recipient: customer.name,
    phone: customer.phone,
    address: location.address,
    deliveryNote: location.detail,
    deliverySlot: "14:30",
    cutoff: "13:45",
    payment: "Chủ phòng thanh toán chung",
    shippingMode: "delivery",
  });
  const accountServiceDetail = selectedAccountService ? accountServiceDetails[selectedAccountService] : null;
  const AccountServiceIcon = accountServiceDetail?.icon ?? ShieldCheck;
  const customerInitials = useMemo(
    () => customer.name.trim().split(/\s+/).slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "TP",
    [customer.name],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get("tab") as TabId | null;
    const roomCode = url.searchParams.get("room");
    const sharedAffiliateCode = (url.searchParams.get("ref") || "").trim().toUpperCase();
    const sharedRoster = (url.searchParams.get("members") || "")
      .split("|")
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 30);
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      let parsedRoom: Partial<GroupRoom> | null = null;
      try {
        const storedCart = localStorage.getItem("daoche.cart");
        const storedCartChoices = localStorage.getItem("daoche.cartChoices");
        const storedLocation = localStorage.getItem("daoche.location");
        const storedCustomer = localStorage.getItem("daoche.customer");
        const storedCustomerAvatar = localStorage.getItem("daoche.customerAvatar");
        const storedOrder = localStorage.getItem("daoche.activeOrder");
        const storedFavorites = localStorage.getItem("daoche.favorites");
        const storedRoom = localStorage.getItem("daoche.groupRoom");
        const storedGroupRosters = localStorage.getItem("daoche.groupRosters");
        const storedSavedLocations = localStorage.getItem("daoche.savedLocations");
        if (sharedAffiliateCode) localStorage.setItem("daoche.affiliateCode", sharedAffiliateCode);
        // localStorage chỉ là chỗ tạm cho khách CHƯA đăng nhập. Đã đăng nhập thì
        // sổ địa chỉ lấy từ máy chủ (xem effect đồng bộ bên dưới) — nếu không,
        // dữ liệu cũ nằm lại trong trình duyệt sẽ sống mãi kể cả sau khi mã
        // nguồn đã gỡ sạch, đúng cái đã xảy ra với ba địa chỉ bản demo.
        const restoredLocations = storedSavedLocations ? JSON.parse(storedSavedLocations) as DeliveryLocation[] : [];
        setSavedLocations(restoredLocations.filter((item) => item.address));
        if (storedCart) setCart(JSON.parse(storedCart));
        if (storedCartChoices) setCartChoices(JSON.parse(storedCartChoices));
        if (storedLocation) setLocation(restoredLocations.find((item) => item.name === storedLocation) || emptyDeliveryLocation);
        if (storedCustomer || storedCustomerAvatar) {
          const restoredCustomer = stripSeededFakeIdentity(storedCustomer ? JSON.parse(storedCustomer) as Partial<CustomerDetails> : {});
          setCustomer((current) => ({
            ...current,
            ...restoredCustomer,
            avatar: storedCustomerAvatar || restoredCustomer.avatar,
          }));
        }
        if (storedOrder) setActiveOrder(JSON.parse(storedOrder));
        if (storedFavorites) setFavorites(JSON.parse(storedFavorites));
        if (storedGroupRosters) setGroupRosters(JSON.parse(storedGroupRosters));
        parsedRoom = storedRoom ? (JSON.parse(storedRoom) as Partial<GroupRoom>) : null;
        if (parsedRoom?.code) {
          setGroupRoom({
            code: parsedRoom.code,
            office: parsedRoom.office || "Phòng Đảo Chè",
            slot: parsedRoom.slot || "14:30",
            cutoff: parsedRoom.cutoff || "Sau 5 phút",
            participants: parsedRoom.participants || 1,
            total: parsedRoom.total || 0,
            invited: parsedRoom.invited,
            profileId: parsedRoom.profileId,
            kind: parsedRoom.kind,
            address: parsedRoom.address,
            recipient: parsedRoom.recipient,
            phone: parsedRoom.phone,
            payment: parsedRoom.payment,
            shippingMode: parsedRoom.shippingMode,
            expiresAt: parsedRoom.expiresAt || Date.now() + 5 * 60 * 1000,
            status: parsedRoom.status || "open",
            role: parsedRoom.role || (parsedRoom.invited ? "guest" : "host"),
            hostToken: parsedRoom.hostToken,
            roster: parsedRoom.roster?.length ? parsedRoom.roster : sharedRoster,
            items: parsedRoom.items || [],
          });
        }
        localStorage.removeItem("daoche.floatingAction");
        localStorage.removeItem("daoche.servicePoint");
      } catch {
        localStorage.removeItem("daoche.cart");
        localStorage.removeItem("daoche.cartChoices");
      }

      if (requestedTab && validTabs.includes(requestedTab)) setActiveTab(requestedTab);
      if (roomCode) {
        setActiveTab("group");
        const normalizedCode = roomCode.toUpperCase();
        const hostToken = parsedRoom?.code === normalizedCode ? parsedRoom.hostToken : undefined;
        fetch(`/api/group-rooms?code=${encodeURIComponent(normalizedCode)}`, {
          headers: hostToken ? { "X-DaoChe-Host-Token": hostToken } : undefined,
        })
          .then(async (response) => {
            const payload = (await response.json()) as GroupRoomResponse;
            if (!response.ok || !payload.room) throw new Error(payload.error || "Không tìm thấy phòng nhóm.");
            setGroupRoom({ ...payload.room, roster: sharedRoster, role: payload.isHost ? "host" : "guest", hostToken, invited: !payload.isHost });
            if (!payload.isHost) setGroupGuestName("");
          })
          .catch((error) => flash(error instanceof Error ? error.message : "Không thể mở phòng nhóm."));
      }
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [flash]);

  useEffect(() => {
    let cancelled = false;
    const [latitude, longitude] = location.coordinates.split(",").map((value) => Number(value.trim()));
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
    const query = hasCoordinates ? `?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}` : "";
    queueMicrotask(() => {
      if (!cancelled) {
        setStoresLoading(true);
        setStoresError("");
      }
    });
    fetch(`/api/sites${query}`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json() as { sites?: PublicSiteApi[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Không thể tải điểm bán.");
        return (payload.sites || []).map(apiSiteToStorePoint);
      })
      .then((stores) => {
        if (cancelled) return;
        setStorePoints(stores);
        const selected = stores.find((store) => store.id === location.servicePointId)
          || stores.find((store) => store.name === location.servicePoint)
          || nearestStoreForCoordinates(stores, location.coordinates);
        if (selected) {
          setSelectedServicePoint(selected.name);
          setStorePreorderStoreId((current) => current || selected.id);
          setLocation((current) => ({
            ...current,
            servicePoint: selected.name,
            servicePointId: selected.id,
            distance: selected.distance === null ? "Chưa xác định" : `${selected.distance.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km`,
            eta: selected.eta,
          }));
        }
      })
      .catch((error) => {
        if (!cancelled) setStoresError(error instanceof Error ? error.message : "Không thể tải điểm bán.");
      })
      .finally(() => {
        if (!cancelled) setStoresLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location.coordinates, location.servicePoint, location.servicePointId]);

  useEffect(() => {
    let cancelled = false;
    const site = location.servicePointId ? `siteId=${encodeURIComponent(location.servicePointId)}&` : "";
    queueMicrotask(() => {
      if (!cancelled) {
        setCatalogLoading(true);
        setCatalogError("");
      }
    });
    fetch(`/api/catalog?${site}channel=webapp`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json() as { products?: CatalogApiProduct[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Không thể tải thực đơn.");
        return (payload.products || []).map(productFromCatalog).filter((product): product is Product => product !== null);
      })
      .then((nextProducts) => {
        if (cancelled) return;
        setProducts(nextProducts);
        setGroupProductId((current) => nextProducts.some((product) => product.id === current) ? current : nextProducts[0]?.id || "");
        setSelectedProduct((current) => current ? nextProducts.find((product) => product.id === current.id) || null : null);
      })
      .catch((error) => {
        if (!cancelled) {
          setProducts([]);
          setCatalogError(error instanceof Error ? error.message : "Không thể tải thực đơn.");
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location.servicePointId]);

  /**
   * Điểm đánh giá là dữ liệu công khai (không cần đăng nhập) nên tải một lần
   * cùng lúc với thực đơn. Lỗi mạng ở đây không được chặn việc đặt món: không
   * có điểm thì chỉ là không hiện sao.
   */
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/customers/reviews", { headers: { Accept: "application/json" } });
        if (!response.ok) return;
        const payload = await response.json() as { ratings?: Array<{ productSku: string; average: number; total: number }> };
        if (cancelled) return;
        setProductRatings(Object.fromEntries(
          (payload.ratings || []).map((entry) => [entry.productSku, { average: Number(entry.average), total: Number(entry.total) }]),
        ));
      } catch {
        // Không có điểm đánh giá thì giao diện đơn giản là không hiện sao.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  const activeGroupCode = groupRoom?.code;

  useEffect(() => {
    if (!activeGroupCode) return;
    const timer = window.setInterval(() => setGroupClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeGroupCode]);

  useEffect(() => {
    if (!hydrated || !groupRoom?.code) return;
    let cancelled = false;
    const refresh = () => {
      const hostToken = groupRoom.hostToken;
      fetch(`/api/group-rooms?code=${encodeURIComponent(groupRoom.code)}`, {
        headers: hostToken ? { "X-DaoChe-Host-Token": hostToken } : undefined,
      })
        .then(async (response) => {
          const payload = (await response.json()) as GroupRoomResponse;
          if (!response.ok || !payload.room) throw new Error(payload.error || "Không thể đồng bộ phòng.");
          if (!cancelled) setGroupRoom((current) => current ? { ...payload.room!, roster: current.roster || [], role: payload.isHost ? "host" : "guest", hostToken: current.hostToken, invited: !payload.isHost } : current);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [groupRoom?.code, groupRoom?.hostToken, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("daoche.cart", JSON.stringify(cart));
    localStorage.setItem("daoche.cartChoices", JSON.stringify(cartChoices));
    localStorage.setItem("daoche.location", location.name);
    const persistedCustomer = { ...customer };
    delete persistedCustomer.avatar;
    localStorage.setItem("daoche.customer", JSON.stringify(persistedCustomer));
    localStorage.setItem("daoche.favorites", JSON.stringify(favorites));
    // Đã đăng nhập thì máy chủ giữ sổ địa chỉ; ghi thêm vào localStorage chỉ tạo
    // ra một bản sao lệch nhịp.
    if (!customerSession) localStorage.setItem("daoche.savedLocations", JSON.stringify(savedLocations));
    else localStorage.removeItem("daoche.savedLocations");
    if (activeOrder) localStorage.setItem("daoche.activeOrder", JSON.stringify(activeOrder));
    else localStorage.removeItem("daoche.activeOrder");
    if (groupRoom) localStorage.setItem("daoche.groupRoom", JSON.stringify(groupRoom));
    else localStorage.removeItem("daoche.groupRoom");
  }, [activeOrder, cart, cartChoices, customer, favorites, groupRoom, hydrated, location, savedLocations]);

  useEffect(() => {
    if (!hydrated) return;
    if (customer.avatar) localStorage.setItem("daoche.customerAvatar", customer.avatar);
    else localStorage.removeItem("daoche.customerAvatar");
  }, [customer.avatar, hydrated]);

  useEffect(() => {
    const paymentCode = activeOrder?.paymentDetails?.paymentCode;
    if (!paymentCode || ["paid", "overpaid", "expired", "cancelled", "refunded"].includes(activeOrder.paymentStatus)) return;
    let cancelled = false;
    const refreshPayment = async () => {
      try {
        const response = await fetch(`/api/payments/sepay?code=${encodeURIComponent(paymentCode)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { payment?: CustomerOrder["paymentDetails"] };
        if (cancelled || !payload.payment) return;
        const nextPayment = payload.payment;
        setActiveOrder((current) => current && current.paymentDetails?.paymentCode === paymentCode ? {
          ...current,
          paymentStatus: nextPayment.status,
          paymentDetails: nextPayment,
          status: ["paid", "overpaid"].includes(nextPayment.status) && current.status === "confirmed" ? "preparing" : current.status,
        } : current);
      } catch {
        // The next polling tick will retry transient network failures.
      }
    };
    void refreshPayment();
    const timer = window.setInterval(() => void refreshPayment(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeOrder?.paymentDetails?.paymentCode, activeOrder?.paymentStatus]);

  useEffect(() => {
    const orderCode = activeOrder?.id;
    const trackingToken = activeOrder?.trackingToken;
    if (!orderCode || !trackingToken || ["completed", "cancelled"].includes(activeOrder.status)) return;
    let cancelled = false;
    const refreshOrder = async () => {
      try {
        const response = await fetch(`/api/orders/track?order=${encodeURIComponent(orderCode)}&token=${encodeURIComponent(trackingToken)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as {
          tracking?: {
            orderCode: string;
            orderStatus: string;
            kitchenStatus: string;
            deliveryStatus: string;
            paymentStatus: CustomerOrder["paymentStatus"];
            deliveryOtp: string | null;
            shipperLocation: CustomerOrder["shipperLocation"];
          };
        };
        if (cancelled || !payload.tracking) return;
        const tracking = payload.tracking;
        const nextStatus: CustomerOrder["status"] = tracking.orderStatus === "cancelled"
          ? "cancelled"
          : tracking.orderStatus === "delivered" || tracking.deliveryStatus === "delivered"
            ? "completed"
            : ["assigned", "picked_up", "picked-up", "delivering"].includes(tracking.orderStatus) || ["assigned", "picked_up", "picked-up", "delivering"].includes(tracking.deliveryStatus)
              ? "delivering"
              : ["accepted", "preparing", "ready"].includes(tracking.orderStatus) || ["queued", "preparing", "ready", "completed", "handed-over"].includes(tracking.kitchenStatus)
                ? "preparing"
                : "confirmed";
        setActiveOrder((current) => current && current.id === orderCode ? {
          ...current,
          status: nextStatus,
          paymentStatus: tracking.paymentStatus,
          deliveryOtp: tracking.deliveryOtp,
          shipperLocation: tracking.shipperLocation,
        } : current);
      } catch {
        // Giữ trạng thái gần nhất; lần đồng bộ tiếp theo sẽ thử lại.
      }
    };
    void refreshOrder();
    const timer = window.setInterval(() => void refreshOrder(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeOrder?.id, activeOrder?.status, activeOrder?.trackingToken]);

  /**
   * Phiên khách sống trong cookie ký phía máy chủ, không phải localStorage, nên
   * phải hỏi máy chủ mới biết còn hiệu lực hay không.
   */
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/customers/session", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const payload = await response.json() as { authenticated?: boolean; session?: CustomerSession | null };
        if (!cancelled && payload.authenticated && payload.session) setCustomerSession(payload.session);
      } catch {
        // Mất mạng thì coi như chưa đăng nhập; đặt đơn khách vãng lai vẫn chạy.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  const refreshCustomerAccount = useCallback(async () => {
    setAccountLoading(true);
    try {
      const response = await fetch("/api/customers/me", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        setCustomerSession(null);
        setCustomerAccount(null);
        return;
      }
      if (!response.ok) return;
      const payload = await response.json() as CustomerAccount & { ok?: boolean };
      setCustomerAccount({
        customer: payload.customer,
        orders: payload.orders || [],
        addresses: payload.addresses || [],
        promotions: payload.promotions || [],
        notifications: payload.notifications || [],
        loyaltyHistory: payload.loyaltyHistory || [],
      });
    } catch {
      // Giữ dữ liệu lần tải trước thay vì xoá trắng màn hình.
    } finally {
      setAccountLoading(false);
    }
  }, []);

  // Chỉ tải khi có phiên. Việc xoá dữ liệu tài khoản do chính hai chỗ kết thúc
  // phiên đảm nhiệm (đăng xuất và nhánh 401 trong refreshCustomerAccount).
  //
  // Hoãn sang microtask vì refreshCustomerAccount bật cờ đang-tải ngay dòng đầu:
  // gọi thẳng trong effect là đổi state đồng bộ, kéo theo một vòng render thừa.
  // Cùng cách làm với đoạn khôi phục dữ liệu từ localStorage ở trên.
  useEffect(() => {
    if (!customerSession) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refreshCustomerAccount();
    });
    return () => {
      cancelled = true;
    };
  }, [customerSession, refreshCustomerAccount]);

  /**
   * Đăng nhập và đăng ký dùng chung một endpoint, khác nhau ở trường action.
   * Sau khi có phiên thì lấy tên thật từ máy chủ điền vào hồ sơ giao hàng — khách
   * đã đăng nhập không phải gõ lại tên mỗi lần đặt.
   */
  const submitCustomerAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authBusy) return;
    setAuthError("");
    setAuthBusy(true);
    try {
      const response = await fetch("/api/customers/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: authMode,
          phone: authDraft.phone.trim(),
          password: authDraft.password,
          ...(authMode === "register" ? { fullName: authDraft.fullName.trim() } : {}),
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; session?: CustomerSession & { loyaltyPoints?: number } };
      if (!response.ok || !payload.session) {
        setAuthError(payload.error || "Không đăng nhập được. Bạn thử lại nhé.");
        return;
      }
      setCustomerSession({ userName: payload.session.userName, expiresAt: payload.session.expiresAt });
      setCustomer((current) => ({
        ...current,
        name: current.name.trim() || payload.session!.userName,
        phone: current.phone.trim() || authDraft.phone.trim(),
      }));
      setAuthDraft({ phone: "", password: "", fullName: "" });
      setShowAuthSheet(false);
      flash(authMode === "register" ? "Đã tạo tài khoản Đảo Chè." : `Chào bạn ${payload.session.userName}.`);
    } catch {
      setAuthError("Không kết nối được máy chủ. Bạn kiểm tra mạng rồi thử lại.");
    } finally {
      setAuthBusy(false);
    }
  };

  const signOutCustomer = async () => {
    try {
      await fetch("/api/customers/session", { method: "DELETE", credentials: "same-origin" });
    } catch {
      // Cookie hết hạn phía máy chủ; phía trình duyệt vẫn coi như đã thoát.
    }
    setCustomerSession(null);
    setCustomerAccount(null);
    flash("Đã đăng xuất khỏi tài khoản.");
  };

  const openAuthSheet = (mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthError("");
    setShowAuthSheet(true);
  };

  /**
   * Đăng nhập cộng tác viên.
   *
   * KHÔNG có đăng ký tại đây: tài khoản chỉ sinh ra khi quản trị duyệt hồ sơ, và
   * mật khẩu tạm được giao cho đúng người. Cho tự đăng ký ở màn này thì ai cũng
   * tạo được tài khoản cộng tác viên mà không qua xét duyệt.
   *
   * KHÔNG có quên-mật-khẩu tự phục vụ: chưa có kênh xác minh số điện thoại
   * (eSMS chưa duyệt brandname), nên ai nhập số người khác cũng chiếm được tài
   * khoản và rút hoa hồng. Quên thì quản trị đặt lại hộ.
   */
  const submitAffiliateAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (affiliateAuthBusy) return;
    setAffiliateAuthError("");
    setAffiliateAuthBusy(true);
    try {
      const response = await fetch("/api/affiliates/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: affiliateAuthDraft.phone.trim(),
          password: affiliateAuthDraft.password,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; session?: AffiliateSession };
      if (!response.ok || !payload.session) {
        setAffiliateAuthError(payload.error || "Không đăng nhập được. Bạn thử lại nhé.");
        return;
      }
      setAffiliateSession(payload.session);
      setAffiliateAuthDraft({ phone: "", password: "" });
      setShowAffiliateAuth(false);
      flash(`Chào bạn ${payload.session.userName}.`);
    } catch {
      setAffiliateAuthError("Không kết nối được máy chủ. Bạn kiểm tra mạng rồi thử lại.");
    } finally {
      setAffiliateAuthBusy(false);
    }
  };

  const signOutAffiliate = async () => {
    try {
      await fetch("/api/affiliates/session", { method: "DELETE", credentials: "same-origin" });
    } catch {
      // Cookie hết hạn phía máy chủ; phía trình duyệt vẫn coi như đã thoát.
    }
    setAffiliateSession(null);
    setAffiliateAccount(null);
    flash("Đã đăng xuất khỏi trang cộng tác viên.");
  };

  useEffect(() => {
    if (!hydrated || !affiliateSession) return;
    let cancelled = false;
    const refreshAffiliate = async () => {
      try {
        // Hồ sơ suy ra từ cookie phiên, không từ tham số trên URL. Không gửi id
        // nào từ trình duyệt: gửi id nghĩa là đổi một con số là xem được hoa
        // hồng người khác.
        const response = await fetch("/api/affiliates/account", { cache: "no-store", credentials: "same-origin" });
        if (response.status === 401) {
          if (!cancelled) {
            setAffiliateSession(null);
            setAffiliateAccount(null);
          }
          return;
        }
        if (!response.ok) return;
        const payload = await response.json() as { affiliate?: AffiliateAccount };
        if (!cancelled && payload.affiliate) setAffiliateAccount(payload.affiliate);
      } catch {
        // Giữ báo cáo gần nhất và thử lại ở lần đồng bộ tiếp theo.
      }
    };
    void refreshAffiliate();
    const timer = window.setInterval(() => void refreshAffiliate(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [affiliateSession, hydrated]);

  // Khôi phục phiên cộng tác viên khi mở lại trang: cookie do máy chủ giữ, nên
  // chỉ cần hỏi máy chủ chứ không đọc gì từ localStorage.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/affiliates/session", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const payload = await response.json() as { authenticated?: boolean; session?: AffiliateSession };
        if (!cancelled && payload.authenticated && payload.session) setAffiliateSession(payload.session);
      } catch {
        // Không có phiên thì giao diện hiện form đăng nhập, không cần báo lỗi.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("daoche.groupRosters", JSON.stringify(groupRosters));
  }, [groupRosters, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    fetch("/api/group-profiles", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = (await response.json()) as { groups?: SavedGroupProfile[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Không thể tải nhóm đã lưu.");
        return payload.groups || [];
      })
      .then((groups) => {
        if (!cancelled) setSavedGroupProfiles(groups);
      })
      .catch(() => {
        if (!cancelled) flash("Chưa đồng bộ được nhóm đã lưu; bạn có thể thử lại sau.");
      })
      .finally(() => {
        if (!cancelled) setGroupProfilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flash, hydrated]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nearest = nearestStoreForCoordinates(storePoints, location.coordinates);
      if (nearest) {
        setSelectedServicePoint(nearest.name);
        setLocation((current) => current.servicePointId === nearest.id ? current : {
          ...current,
          servicePoint: nearest.name,
          servicePointId: nearest.id,
          distance: nearest.distance === null ? "Chưa xác định" : `${nearest.distance.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km`,
          eta: nearest.eta,
        });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.coordinates, storePoints]);

  useEffect(() => {
    const onPopState = () => {
      const tab = new URL(window.location.href).searchParams.get("tab") as TabId | null;
      setActiveTab(tab && validTabs.includes(tab) ? tab : "home");
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowCart(false);
      setShowGroupSetup(false);
      setShowLocation(false);
      setShowNotifications(false);
      setShowFilters(false);
      setShowFavorites(false);
      setShowExperienceProgram(false);
      setShowAffiliateApplication(false);
      setShowPartnerApplication(false);
      setShowNearbyActions(false);
      setShowStorePreorder(false);
      setShowAffiliateShare(false);
      setShowGroupShare(false);
      setSelectedRevenueSource(null);
      setSelectedStore(null);
      setSelectedProduct(null);
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return products.filter((product) => {
      const matchesSearch = !normalized || `${product.name} ${product.legacy} ${product.note}`.toLocaleLowerCase("vi").includes(normalized);
      const firstPrepMinute = Number(product.prep.match(/\d+/)?.[0] || 99);
      const matchesCategory = category === "Tất cả"
        ? true
        : category === "Bán chạy"
          ? Boolean(product.popular)
          : category === "Giao nhanh"
            ? firstPrepMinute <= 10
            : category === "Dưới 25k"
              ? product.price < 25000
              : category === "Nhẹ bụng"
                ? product.calories <= 200
                : category === "Thuần chay"
                  ? product.tags.some((tag) => tag.toLocaleLowerCase("vi-VN").includes("thuần chay"))
                  : category === "25k–40k"
                    ? product.price >= 25000 && product.price <= 40000
                    : category === "Combo tiết kiệm"
                      ? product.category === "Combo văn phòng"
                      : product.category === category;
      return matchesSearch && matchesCategory;
    });
  }, [category, products, query]);

  const featuredProducts = products.filter((product) => product.popular);
  const homeProducts = query ? visibleProducts : featuredProducts.length ? featuredProducts : products.slice(0, 5);
  const nearbyStores = useMemo(
    () => storePoints
      .filter((store) => {
        const official = isOfficialStore(store);
        if (storeFilter === "official") return official;
        if (storeFilter === "partner") return !official;
        return true;
      })
      .sort((first, second) => (first.distance ?? Number.POSITIVE_INFINITY) - (second.distance ?? Number.POSITIVE_INFINITY)),
    [storeFilter, storePoints],
  );
  const officialStoreCount = storePoints.filter(isOfficialStore).length;
  const partnerStoreCount = storePoints.length - officialStoreCount;

  const cartLines = useMemo(() => products.filter((product) => cart[product.id]), [cart, products]);
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const cartTotal = cartLines.reduce((sum, product) => {
    const choice = cartChoices[product.id];
    const toppingPrice = choice ? product.toppings.find((item) => item.name === choice.topping)?.price || 0 : 0;
    return sum + (product.price + toppingPrice) * (cart[product.id] || 0);
  }, 0);
  const cartPreview = cartLines.length
    ? `${cartLines[0].name}${cartLines.length > 1 ? ` +${cartLines.length - 1} món` : ""}`
    : "";
  const quoteItems = useMemo(() => cartLines.map((product) => ({
    productCode: product.id,
    quantity: cart[product.id] || 0,
    ...(cartChoices[product.id] || {}),
  })), [cart, cartChoices, cartLines]);
  const deliveryFee = fulfillment === "pickup" ? 0 : deliveryQuote?.fee ?? 0;
  const checkoutTotal = cartTotal + deliveryFee;
  const quoteRequestKey = JSON.stringify({ siteId: location.servicePointId, coordinates: location.coordinates, address: customer.address, items: quoteItems });

  useEffect(() => {
    if (!showCart || fulfillment !== "delivery" || !cartCount) {
      queueMicrotask(() => {
        setDeliveryQuote(null);
        setDeliveryQuoteError("");
        setDeliveryQuoteLoading(false);
      });
      return;
    }
    if (!location.servicePointId || !location.coordinates) {
      queueMicrotask(() => {
        setDeliveryQuote(null);
        setDeliveryQuoteError("Hãy chọn vị trí có tọa độ để hệ thống tính phí giao chính xác.");
        setDeliveryQuoteLoading(false);
      });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDeliveryQuoteLoading(true);
      setDeliveryQuoteError("");
      fetch("/api/deliveries/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: location.servicePointId, coordinates: location.coordinates, address: customer.address || location.address, items: quoteItems }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = await response.json() as { quote?: DeliveryCheckoutQuote; error?: string };
          if (!response.ok || !payload.quote) throw new Error(payload.error || "Không lấy được phí giao hàng.");
          return payload.quote;
        })
        .then((quote) => setDeliveryQuote(quote))
        .catch((error) => {
          if (controller.signal.aborted) return;
          setDeliveryQuote(null);
          setDeliveryQuoteError(error instanceof Error ? error.message : "Không lấy được phí giao hàng.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setDeliveryQuoteLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cartCount, customer.address, fulfillment, location.address, location.coordinates, location.servicePointId, quoteItems, quoteRequestKey, showCart]);
  const groupHasStarted = Boolean(groupRoom && groupRoom.cutoff !== "Chờ chia sẻ");
  const groupSecondsLeft = groupRoom ? (groupHasStarted ? Math.max(0, Math.ceil((groupRoom.expiresAt - groupClock) / 1000)) : 5 * 60) : 0;
  const groupCountdown = `${String(Math.floor(groupSecondsLeft / 60)).padStart(2, "0")}:${String(groupSecondsLeft % 60).padStart(2, "0")}`;
  const groupIsExpired = Boolean(groupRoom && (groupRoom.status !== "open" || (groupHasStarted && groupSecondsLeft <= 0)));
  const groupRoster = groupRoom?.roster || [];
  const groupOrderedNames = new Set((groupRoom?.items || []).map((item) => item.guestName.trim().toLocaleLowerCase("vi-VN")));
  const groupPendingNames = groupRoster.filter((name) => !groupOrderedNames.has(name.toLocaleLowerCase("vi-VN")));
  const groupChosenCount = groupRoster.length ? groupRoster.length - groupPendingNames.length : groupOrderedNames.size;
  const groupGuestSubmitted = Boolean(groupGuestName.trim() && groupOrderedNames.has(groupGuestName.trim().toLocaleLowerCase("vi-VN")));

  const referralUrl = affiliateAccount?.code ? `https://daoche-production.up.railway.app/order?ref=${encodeURIComponent(affiliateAccount.code)}` : "";
  const referralMessage = `Mời bạn đặt Đảo Chè qua link của ${affiliateAccount?.displayName || "tôi"}.`;

  const copyReferralLink = async () => {
    if (!referralUrl) {
      flash("Link Affiliate sẽ xuất hiện sau khi hồ sơ được duyệt.");
      return;
    }
    try {
      await navigator.clipboard.writeText(referralUrl);
      flash("Đã sao chép link Affiliate.");
    } catch {
      flash("Thiết bị chưa cho phép sao chép. Bạn có thể nhấn Chia sẻ ngay.");
    }
  };

  const shareReferralTo = async (channel: "zalo" | "facebook" | "sms" | "email" | "copy" | "other") => {
    if (!referralUrl) {
      flash("Hồ sơ cần được duyệt trước khi chia sẻ link.");
      return;
    }
    const encodedUrl = encodeURIComponent(referralUrl);
    const encodedMessage = encodeURIComponent(referralMessage);

    if (channel === "copy") {
      await copyReferralLink();
      setShowAffiliateShare(false);
      return;
    }

    if (channel === "other") {
      if (navigator.share) {
        try {
          await navigator.share({ title: "Đảo Chè", text: referralMessage, url: referralUrl });
          setShowAffiliateShare(false);
          return;
        } catch {
          return;
        }
      }
      await copyReferralLink();
      return;
    }

    const shareTargets = {
      zalo: `https://zalo.me/share?url=${encodedUrl}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      sms: `sms:?&body=${encodedMessage}%20${encodedUrl}`,
      email: `mailto:?subject=${encodeURIComponent("Mời bạn thưởng thức Đảo Chè")}&body=${encodedMessage}%0A${encodedUrl}`,
    };
    window.open(shareTargets[channel], "_blank", "noopener,noreferrer");
    setShowAffiliateShare(false);
  };

  const updateCart = (id: string, delta: number) => {
    if (delta < 0 && (cart[id] || 0) + delta <= 0) {
      setCartChoices((choices) => {
        const nextChoices = { ...choices };
        delete nextChoices[id];
        return nextChoices;
      });
    }
    setCart((current) => {
      const next = Math.max(0, (current[id] || 0) + delta);
      const copy = { ...current };
      if (!next) delete copy[id];
      else copy[id] = next;
      return copy;
    });
    if (delta > 0) flash("Đã thêm món vào giỏ.");
  };

  const toggleFavorite = (id: string) => {
    setFavorites((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const openProduct = (product: Product) => {
    setProductChoice({
      sweetness: product.sweetness.includes("50%") ? "50%" : product.sweetness[0],
      temperature: product.category === "Đồ uống" ? "Lạnh" : "Mát",
      topping: "Không thêm",
    });
    setSelectedProduct(product);
  };

  const goTo = (tab: TabId) => {
    if (tab !== activeTab) setPreviousTab(activeTab);
    setActiveTab(tab);
    setShowAllProducts(false);
    setQuery("");
    const url = new URL(window.location.href);
    if (tab === "home") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    url.searchParams.delete("room");
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openCatalog = () => {
    setShowAllProducts(true);
    setCategory("Tất cả");
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    if (showAllProducts) {
      setShowAllProducts(false);
      setCategory("Chè");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    goTo(previousTab === activeTab ? "home" : previousTab);
  };

  /**
   * Sổ địa chỉ của khách đã đăng nhập nằm ở máy chủ, không ở trình duyệt.
   *
   * Đổi máy vẫn thấy đủ địa chỉ, và dữ liệu cũ trong localStorage không còn cách
   * nào sống lại. Khách chưa đăng nhập vẫn dùng localStorage như trước — họ chưa
   * có chỗ nào trên máy chủ để lưu.
   */
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    // Hoãn sang microtask: đổi state đồng bộ ngay trong effect kéo theo một vòng
    // render thừa. Cùng cách làm với đoạn tải tài khoản khách ở trên.
    if (!customerSession) {
      queueMicrotask(() => {
        if (!cancelled) setAddressBookSynced(false);
      });
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const response = await fetch("/api/customers/addresses", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const payload = await response.json() as { addresses?: ServerAddress[] };
        if (cancelled) return;
        setSavedLocations((payload.addresses || []).map(serverAddressToLocation));
        setAddressBookSynced(true);
      } catch {
        // Không tải được thì giữ nguyên danh sách đang hiện, đừng xoá trắng.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerSession, hydrated]);

  const addSavedLocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (addressBusy) return;
    if (!addressDraft.office.trim() || addressDraft.address.trim().length < 8) return flash("Bạn nhập tên địa điểm và địa chỉ cụ thể nhé.");

    // Toạ độ chỉ gửi khi khách đã bấm định vị. Không có thì để trống — máy chủ
    // nhận null, và giao diện nói rõ là chưa có toạ độ thay vì bịa khoảng cách.
    const [latitudeText, longitudeText] = (location.coordinates || "").split(",").map((part) => part.trim());
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && Boolean(latitudeText) && Boolean(longitudeText);

    const nextLocation: DeliveryLocation = {
      name: `${addressDraft.label} · ${addressDraft.office.trim()}`,
      office: addressDraft.office.trim(),
      address: addressDraft.address.trim(),
      coordinates: hasCoordinates ? location.coordinates : "",
      detail: addressDraft.detail.trim() || "Gọi khi đến điểm giao",
      servicePoint: "",
      servicePointId: "",
      distance: "Chưa xác định",
      eta: "Chưa có ước tính",
    };

    if (customerSession) {
      setAddressBusy(true);
      try {
        const response = await fetch("/api/customers/addresses", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: nextLocation.name,
            address: nextLocation.address,
            instructions: nextLocation.detail,
            ...(hasCoordinates ? { latitude, longitude } : {}),
          }),
        });
        const payload = await response.json() as { error?: string; addresses?: ServerAddress[] };
        if (!response.ok) {
          flash(payload.error || "Không lưu được địa chỉ.");
          return;
        }
        setSavedLocations((payload.addresses || []).map(serverAddressToLocation));
        flash("Đã lưu địa chỉ vào tài khoản của bạn.");
      } catch {
        flash("Không kết nối được máy chủ. Bạn thử lại nhé.");
        return;
      } finally {
        setAddressBusy(false);
      }
    } else {
      setSavedLocations((current) => [...current, nextLocation]);
      flash("Đã lưu trên thiết bị này. Đăng nhập để giữ địa chỉ khi đổi máy.");
    }

    setLocation(nextLocation);
    setCustomer((current) => ({ ...current, address: nextLocation.address }));
    setAddressDraft({ label: "Nhà", office: "", address: "", detail: "" });
    setShowAddressForm(false);
  };

  /** Xoá một địa chỉ đã lưu. Máy chủ ràng buộc theo chủ tài khoản, không theo id trần. */
  const removeSavedLocation = async (target: DeliveryLocation) => {
    if (addressBusy) return;
    if (!customerSession || !target.servicePointId) {
      setSavedLocations((current) => current.filter((item) => item.name !== target.name));
      return;
    }
    setAddressBusy(true);
    try {
      const response = await fetch(`/api/customers/addresses?id=${encodeURIComponent(target.servicePointId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload = await response.json() as { error?: string; addresses?: ServerAddress[] };
      if (!response.ok) {
        flash(payload.error || "Không xoá được địa chỉ.");
        return;
      }
      setSavedLocations((payload.addresses || []).map(serverAddressToLocation));
      flash("Đã xoá địa chỉ.");
    } catch {
      flash("Không kết nối được máy chủ.");
    } finally {
      setAddressBusy(false);
    }
  };

  const openCart = () => {
    setCheckoutStep("cart");
    setShowCart(true);
  };

  const continueShopping = () => {
    setShowCartDecision(false);
    if (activeTab !== "home") goTo("home");
    openCatalog();
  };

  const orderNow = () => {
    setShowCartDecision(false);
    openCart();
  };

  const continueCheckout = () => {
    if (checkoutStep === "cart") {
      if (!cartCount) return;
      if (fulfillment === "delivery" && (!deliveryQuote || deliveryQuoteLoading)) return flash(deliveryQuoteError || "Đang lấy phí giao hàng, bạn chờ một chút nhé.");
      setCheckoutStep("details");
      return;
    }
    if (checkoutStep === "details") {
      if (!customer.name.trim()) return flash("Bạn nhập tên người nhận nhé.");
      if (!/^(0|\+84)[0-9]{8,10}$/.test(customer.phone.replace(/\s/g, ""))) return flash("Số điện thoại chưa đúng định dạng.");
      if (fulfillment === "delivery" && customer.address.trim().length < 8) return flash("Bạn nhập địa chỉ giao hàng rõ hơn nhé.");
      setCheckoutClientReference((current) => current || `DR-${crypto.randomUUID()}`);
      setCheckoutStep("payment");
    }
  };

  const placeOrder = async () => {
    if (placingOrder) return;
    if (!checkoutClientReference) return flash("Phiên thanh toán chưa sẵn sàng. Bạn vui lòng quay lại bước thông tin và thử lại.");
    if (!privacyConsent) return flash("Bạn cần đồng ý Điều khoản và Chính sách quyền riêng tư trước khi đặt đơn.");
    if (fulfillment === "delivery" && (!deliveryQuote || new Date(deliveryQuote.expiresAt).getTime() <= Date.now())) return flash("Báo phí giao hàng đã hết hạn. Bạn vui lòng quay lại giỏ để lấy phí mới.");
    const id = checkoutClientReference;
    const affiliateCode = (new URL(window.location.href).searchParams.get("ref") || localStorage.getItem("daoche.affiliateCode") || "").trim().toUpperCase();
    const servicePoint = storePoints.find((point) => point.id === location.servicePointId)
      || storePoints.find((point) => point.name === location.servicePoint);
    if (!servicePoint) return flash("Danh sách điểm bán chưa sẵn sàng. Bạn vui lòng thử lại.");
    if (!servicePoint.open) return flash(servicePoint.closedReason || "Điểm bán đang đóng cửa.");
    const operationSiteId = servicePoint.id;
    const itemSummary = cartLines
      .map((product) => {
        const choice = cartChoices[product.id];
        return `${cart[product.id] || 0}× ${product.name}${choice ? ` (${choice.sweetness}, ${choice.temperature}, ${choice.topping})` : ""}`;
      })
      .join(" · ");
    const createdAt = new Date().toISOString();
    const scheduledOrder = /Giữ chỗ|Làm sẵn/.test(customer.note);
    const promisedAt = scheduledOrder
      ? promisedAtFromSlot(createdAt, customer.slot)
      : new Date(new Date(createdAt).getTime() + 35 * 60_000).toISOString();
    setPlacingOrder(true);
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": id },
        body: JSON.stringify({
          command: "order.create",
          data: {
            clientReference: id,
            orderId: id,
            orderCode: id,
            customerName: customer.name.trim(),
            customerPhone: customer.phone.trim(),
            customerEmail: customer.email?.trim() || "",
            channel: "webapp",
            siteId: operationSiteId,
            fulfillmentType: fulfillment,
            tableLabel: fulfillment === "dine-in" ? storePreorderTableLabel : undefined,
            scheduledFor: scheduledOrder ? promisedAt : undefined,
            deliveryAddress: fulfillment === "delivery" ? customer.address : fulfillment === "pickup" ? `Nhận tại ${location.servicePoint}` : "",
            deliveryCoordinates: fulfillment === "delivery" ? location.coordinates : undefined,
            deliveryQuoteId: fulfillment === "delivery" ? deliveryQuote?.id : undefined,
            paymentMethod: payment,
            affiliateCode,
            // Máy chủ tự kiểm điều kiện và tự tính mức giảm; phía trình duyệt
            // chỉ chuyển mã đi, không tính tiền.
            promotionCode: promotionCode.trim().toUpperCase() || undefined,
            promisedAt,
            privacyConsentAt: new Date().toISOString(),
            privacyPolicyVersion: "2026-08-21",
            note: [customer.note.trim(), itemSummary, `Điểm phục vụ: ${servicePoint?.name || location.servicePoint}`].filter(Boolean).join(" · "),
            items: cartLines.map((product) => ({
              productCode: product.id,
              productName: product.name,
              quantity: cart[product.id] || 0,
              unitPrice: product.price,
              ...(cartChoices[product.id] || {}),
            })),
          },
        }),
      });
      const payload = await response.json() as {
        error?: string;
        result?: {
          orderId: string;
          orderCode: string;
          trackingToken: string;
          amounts?: { total: number; deliveryFee: number };
          payment?: CustomerOrder["paymentDetails"];
        };
      };
      if (!response.ok || !payload.result) throw new Error(payload.error || "Không thể ghi nhận đơn hàng.");
      const order: CustomerOrder = {
        id: payload.result.orderCode,
        createdAt,
        total: payload.result.amounts?.total ?? checkoutTotal,
        fee: payload.result.amounts?.deliveryFee ?? deliveryFee,
        fulfillment,
        payment,
        point: location.name,
        customer: {
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          note: customer.note,
          slot: customer.slot,
        },
        lines: cartLines.map((product) => ({
          id: product.id,
          name: product.name,
          quantity: cart[product.id] || 0,
          price: product.price + (product.toppings.find((item) => item.name === cartChoices[product.id]?.topping)?.price || 0),
          choice: cartChoices[product.id],
        })),
        status: payload.result.payment ? "confirmed" : "preparing",
        paymentStatus: payload.result.payment?.status || "pending",
        paymentDetails: payload.result.payment,
        trackingToken: payload.result.trackingToken,
      };
      setActiveOrder(order);
      setCart({});
      setCartChoices({});
      setCheckoutClientReference(null);
      setDeliveryQuote(null);
      setPromotionCode("");
      setShowCart(false);
      setPlacedOrderId(payload.result.orderCode);
      // Đơn vừa vào sổ: lấy lại lịch sử, điểm và ưu đãi còn lại từ máy chủ.
      if (customerSession) void refreshCustomerAccount();
    } catch (error) {
      flash(error instanceof Error ? error.message : "Không thể đặt đơn lúc này.");
    } finally {
      setPlacingOrder(false);
    }
  };

  const openGroupProfileSetup = (kind: GroupProfileKind, profile?: SavedGroupProfile) => {
    const template = groupProfileTypes.find((item) => item.id === kind) || groupProfileTypes[1];
    const pickupPoint = storePoints.find((item) => item.id === location.servicePointId)
      || storePoints.find((item) => item.name === location.servicePoint)
      || nearestStoreForCoordinates(storePoints, location.coordinates);
    if (!pickupPoint) return flash("Danh sách điểm bán chưa sẵn sàng.");
    setEditingGroupProfileId(profile?.id || null);
    setGroupRosterDraft(profile ? (groupRosters[profile.id] || []).join(", ") : "");
    setGroupProfileDraft(profile ? {
      kind: profile.kind,
      name: profile.name,
      recipient: profile.recipient,
      phone: profile.phone,
      address: profile.address,
      deliveryNote: profile.deliveryNote,
      deliverySlot: profile.deliverySlot,
      cutoff: profile.cutoff,
      payment: profile.payment === "Mỗi người tự thanh toán" ? "Chủ phòng thanh toán chung" : profile.payment,
      shippingMode: profile.shippingMode,
    } : {
      kind,
      name: template.defaultName,
      recipient: customer.name,
      phone: customer.phone,
      address: kind === "self-ship" ? `${pickupPoint.name} · ${pickupPoint.address}` : location.address,
      deliveryNote: kind === "self-ship" ? "Nhận tại quầy, báo mã đơn khi tới" : location.detail,
      deliverySlot: "14:30",
      cutoff: "13:45",
      payment: template.defaultPayment,
      shippingMode: template.shippingMode,
    });
    setShowGroupSetup(true);
  };

  const startSavedGroupProfile = async (profile: SavedGroupProfile, rosterOverride?: string[]) => {
    const type = groupProfileTypes.find((item) => item.id === profile.kind) || groupProfileTypes[1];
    const roster = rosterOverride || groupRosters[profile.id] || [];
    const nextLocation = {
      ...location,
      name: `${type.shortTitle} · ${profile.name}`,
      office: profile.name,
      address: profile.address,
      detail: profile.deliveryNote || `Người nhận: ${profile.recipient} · ${profile.phone}`,
    };
    setLocation(nextLocation);
    setCustomer((current) => ({
      ...current,
      name: profile.recipient,
      phone: profile.phone,
      address: profile.address,
      note: profile.deliveryNote,
      slot: profile.deliverySlot,
    }));
    setFulfillment(profile.shippingMode);
    try {
      const response = await fetch("/api/group-rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          office: profile.name,
          slot: profile.deliverySlot,
          cutoff: "Chờ chia sẻ",
          address: profile.address,
          recipient: profile.recipient,
          phone: profile.phone,
          payment: "Chủ phòng chốt và thanh toán",
          shippingMode: profile.shippingMode,
          siteId: location.servicePointId,
        }),
      });
      const payload = (await response.json()) as GroupRoomResponse;
      if (!response.ok || !payload.room || !payload.hostToken) throw new Error(payload.error || "Không thể tạo phòng nhóm.");
      setGroupRoom({
        ...payload.room,
        role: "host",
        hostToken: payload.hostToken,
        profileId: profile.id,
        kind: profile.kind,
        invited: false,
        roster,
      });
      setGroupClock(payload.room.expiresAt - 5 * 60 * 1000);
      setGroupGuestName(profile.recipient || customer.name);
      goTo("group");
      flash(`${profile.name} đã sẵn sàng. Đồng hồ 5 phút bắt đầu khi bạn chia sẻ link.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Không thể tạo phòng nhóm lúc này.");
    }
  };

  const saveGroupProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!groupProfileDraft.name.trim() || !groupProfileDraft.recipient.trim() || !groupProfileDraft.phone.trim() || groupProfileDraft.address.trim().length < 8) {
      flash("Bạn nhập đủ tên nhóm, người nhận, số điện thoại và địa chỉ nhé.");
      return;
    }
    setGroupProfileSaving(true);
    const roster = Array.from(new Set(
      groupRosterDraft
        .split(/[,;\n]/)
        .map((name) => name.trim())
        .filter((name) => name.length >= 2),
    )).slice(0, 30);
    try {
      const response = await fetch("/api/group-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingGroupProfileId || undefined, ...groupProfileDraft }),
      });
      const payload = (await response.json()) as { group?: SavedGroupProfile; error?: string };
      if (!response.ok || !payload.group) throw new Error(payload.error || "Không thể lưu nhóm.");
      const saved = payload.group;
      setSavedGroupProfiles((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setGroupRosters((current) => ({ ...current, [saved.id]: roster }));
      setShowGroupSetup(false);
      setEditingGroupProfileId(null);
      startSavedGroupProfile(saved, roster);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Không thể lưu nhóm lúc này.");
    } finally {
      setGroupProfileSaving(false);
    }
  };

  const joinGroupRoom = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 5) return flash("Bạn nhập mã phòng hợp lệ nhé.");
    try {
      const response = await fetch(`/api/group-rooms?code=${encodeURIComponent(code)}`);
      const payload = (await response.json()) as GroupRoomResponse;
      if (!response.ok || !payload.room) throw new Error(payload.error || "Không tìm thấy phòng.");
      setGroupRoom({ ...payload.room, role: "guest", invited: true });
      setJoinCode("");
      setGroupGuestName("");
      setGroupClock(Date.now());
      flash("Bạn đã vào phòng. Chọn món trước khi đồng hồ về 00:00 nhé!");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Không thể vào phòng nhóm.");
    }
  };

  const groupShareLink = () => {
    const origin = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
      ? "https://dao-che-os.anhocpiano.chatgpt.site"
      : window.location.origin;
    const url = new URL("/order", origin);
    url.searchParams.set("tab", "group");
    url.searchParams.set("room", groupRoom?.code.toLowerCase() || "");
    if (groupRoster.length) url.searchParams.set("members", groupRoster.join("|"));
    return url.toString();
  };

  const openGroupShare = async () => {
    if (!groupRoom) return;
    if (groupRoom.role === "host" && groupRoom.hostToken && groupRoom.cutoff === "Chờ chia sẻ") {
      try {
        const response = await fetch("/api/group-rooms", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", code: groupRoom.code, hostToken: groupRoom.hostToken }),
        });
        const payload = (await response.json()) as GroupRoomResponse;
        if (!response.ok || !payload.room) throw new Error(payload.error || "Không thể bắt đầu phòng nhóm.");
        setGroupRoom((current) => current ? { ...payload.room!, roster: current.roster || [], role: "host", hostToken: current.hostToken, invited: false } : current);
        setGroupClock(Date.now());
      } catch (error) {
        flash(error instanceof Error ? error.message : "Không thể mở chia sẻ lúc này.");
        return;
      }
    }
    setShowGroupShare(true);
  };

  const copyGroupLink = async () => {
    const link = groupShareLink();
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* Clipboard can be unavailable in preview. */
    }
    flash("Đã sao chép link phòng nhóm.");
  };

  const shareGroupTo = async (channel: "zalo" | "facebook" | "messenger" | "sms" | "copy" | "other") => {
    if (!groupRoom) return;
    const link = groupShareLink();
    const message = `Vào phòng ${groupRoom.office} chọn Đảo Chè trong 5 phút nhé. Hết giờ là chủ phòng chốt đơn luôn!`;
    const encodedLink = encodeURIComponent(link);
    const encodedMessage = encodeURIComponent(`${message}\n${link}`);
    if (channel === "copy") {
      await copyGroupLink();
      setShowGroupShare(false);
      return;
    }
    if (channel === "other" && navigator.share) {
      try {
        await navigator.share({ title: groupRoom.office, text: message, url: link });
        setShowGroupShare(false);
      } catch {
        /* The native share sheet can be dismissed. */
      }
      return;
    }
    const targets = {
      zalo: `https://zalo.me/share?url=${encodedLink}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`,
      messenger: `fb-messenger://share/?link=${encodedLink}`,
      sms: `sms:?&body=${encodedMessage}`,
      other: `mailto:?subject=${encodeURIComponent(groupRoom.office)}&body=${encodedMessage}`,
    };
    window.open(targets[channel], "_blank", "noopener,noreferrer");
    setShowGroupShare(false);
  };

  const submitGroupChoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!groupRoom) return;
    if (groupIsExpired) return flash("Phòng đã hết 5 phút nhận món. Hẹn bạn ở kèo sau nhé!");
    if (groupGuestName.trim().length < 2) return flash("Bạn nhập tên để chủ phòng biết món của ai nhé.");
    setGroupSubmitting(true);
    try {
      const response = await fetch("/api/group-rooms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-item",
          code: groupRoom.code,
          hostToken: groupRoom.hostToken,
          guestName: groupGuestName,
          productId: groupProductId,
          quantity: 1,
        }),
      });
      const payload = (await response.json()) as GroupRoomResponse;
      if (!response.ok || !payload.room) throw new Error(payload.error || "Không thể gửi món.");
      setGroupRoom((current) => current ? { ...payload.room!, role: current.role, hostToken: current.hostToken, invited: current.invited } : current);
      flash("Xong rồi! Chủ nhóm đã thấy tên và món bạn chọn.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Không thể gửi món vào phòng.");
    } finally {
      setGroupSubmitting(false);
    }
  };

  const finalizeGroupRoom = async () => {
    if (!groupRoom || groupRoom.role !== "host" || !groupRoom.hostToken) return flash("Chỉ chủ phòng mới được chốt đơn và thanh toán.");
    if (!groupRoom.items.length) return flash("Phòng chưa có món nào để chốt.");
    try {
      const response = await fetch("/api/group-rooms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalize", code: groupRoom.code, hostToken: groupRoom.hostToken }),
      });
      const payload = (await response.json()) as GroupRoomResponse;
      if (!response.ok || !payload.room) throw new Error(payload.error || "Không thể chốt phòng.");
      const nextCart = { ...cart };
      payload.room.items.forEach((item) => {
        nextCart[item.productId] = (nextCart[item.productId] || 0) + item.quantity;
      });
      setCart(nextCart);
      setGroupRoom((current) => current ? { ...payload.room!, role: "host", hostToken: current.hostToken, invited: false } : current);
      setCheckoutStep("cart");
      setShowCart(true);
      flash("Phòng đã khóa. Bạn là người duy nhất có thể xác nhận giao hàng và thanh toán.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Không thể chốt phòng nhóm.");
    }
  };

  const openAffiliateApplication = () => {
    setAffiliateDraft((current) => ({
      ...current,
      name: current.name || customer.name,
      phone: current.phone || customer.phone,
    }));
    setAffiliateApplicationSent(false);
    setShowAffiliateApplication(true);
  };

  const submitAffiliateApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!affiliateDraft.name.trim() || !affiliateDraft.phone.trim()) {
      flash("Bạn điền tên và số điện thoại để Đảo Chè liên hệ nhé.");
      return;
    }
    try {
      const response = await fetch("/api/customer-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "affiliate_application",
          name: affiliateDraft.name,
          phone: affiliateDraft.phone,
          email: customer.email,
          subject: "Đăng ký Đại sứ Đảo Chè",
          details: { community: affiliateDraft.community, reach: affiliateDraft.reach },
        }),
      });
      const payload = await response.json() as { error?: string; requestId?: string };
      if (!response.ok) throw new Error(payload.error || "Không thể gửi đăng ký Đại sứ.");
      // KHÔNG lưu token nào nữa. Khi hồ sơ được duyệt, hệ thống cấp tài khoản
      // đăng nhập (số điện thoại + mật khẩu tạm) và cộng tác viên đăng nhập như
      // mọi tài khoản khác. Ô dưới đây chỉ để hiện trạng thái "đang chờ duyệt"
      // trong phiên hiện tại, không phải nguồn dữ liệu.
      setAffiliateAccount({
        displayName: affiliateDraft.name.trim(),
        status: "pending",
        commissionBps: 800,
        approvedAt: null,
        code: null,
        summary: { orderCount: 0, salesAmount: 0, commissionAmount: 0, availableAmount: 0, pendingAmount: 0, paidAmount: 0 },
        recent: [],
      });
      setAffiliateApplicationSent(true);
      flash("Đã gửi đăng ký Đại sứ thành công.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Không thể gửi đăng ký Đại sứ.");
    }
  };

  const openPartnerApplication = (mode: "Có điểm bán sẵn" | "Sẵn sàng đầu tư" = "Có điểm bán sẵn") => {
    setPartnerDraft((current) => ({
      ...current,
      mode,
      name: current.name || customer.name,
      phone: current.phone || customer.phone,
    }));
    setPartnerApplicationSent(false);
    setShowPartnerApplication(true);
  };

  const submitPartnerApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!partnerDraft.name.trim() || !partnerDraft.phone.trim() || !partnerDraft.address.trim()) {
      flash("Bạn điền tên, số điện thoại và vị trí điểm bán dự kiến nhé.");
      return;
    }
    try {
      const response = await fetch("/api/customer-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "partner_application",
          name: partnerDraft.name,
          phone: partnerDraft.phone,
          email: customer.email,
          subject: partnerDraft.mode,
          details: {
            mode: partnerDraft.mode,
            business: partnerDraft.business,
            district: partnerDraft.district,
            address: partnerDraft.address,
            details: partnerDraft.details,
          },
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Không thể gửi hồ sơ đối tác.");
      setPartnerApplicationSent(true);
      flash(partnerDraft.mode === "Có điểm bán sẵn" ? "Đã gửi đăng ký đối tác phân phối." : "Đã gửi hồ sơ mở điểm bán mới.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Không thể gửi hồ sơ đối tác.");
    }
  };

  const openTakeawayMenu = () => {
    setShowNearbyActions(false);
    setFulfillment("delivery");
    goTo("home");
    setCategory("Tất cả");
    setShowAllProducts(true);
    flash("Thực đơn đã sẵn sàng; AI sẽ điều phối từ điểm làm món phù hợp.");
  };

  const openGroupJourney = () => {
    setShowNearbyActions(false);
    goTo("group");
  };

  const openStorePreorderJourney = () => {
    setShowNearbyActions(false);
    setStorePreorderMode("dine-in");
    const firstOpenStore = storePoints.find((store) => store.open);
    if (!firstOpenStore) return flash(storesError || "Chưa có điểm bán đang mở để đặt trước.");
    setStorePreorderStoreId(firstOpenStore.id);
    setShowStorePreorder(true);
  };

  const confirmStorePreorder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const store = storePoints.find((item) => item.id === storePreorderStoreId);
    if (!store) return flash("Điểm bán đã chọn không còn khả dụng.");
    setSelectedServicePoint(store.name);
    setLocation((current) => ({ ...current, servicePoint: store.name, servicePointId: store.id }));
    setFulfillment(storePreorderMode);
    setCustomer((current) => ({
      ...current,
      slot: storePreorderTime,
      note: storePreorderMode === "dine-in"
        ? `Giữ chỗ cho ${storePreorderPartySize} · dùng món tại quán`
        : "Làm sẵn để nhận nhanh tại quầy",
    }));
    setShowStorePreorder(false);
    goTo("home");
    setCategory("Tất cả");
    setShowAllProducts(true);
    flash(storePreorderMode === "dine-in" ? `Đã giữ giờ dùng món tại ${store.name}.` : `Đã chọn nhận món tại ${store.name}.`);
  };

  const askChatTopic = (topic: Exclude<ChatContext, null>) => {
    const copy = {
      menu: {
        question: "Tư vấn giúp mình một món dễ ăn nhé.",
        answer: "Chè bưởi Năm Roi là lựa chọn dễ bắt đầu nhất: cùi bưởi giòn sần sật, cốt dừa béo nhẹ, 28.000đ. Mình đã đặt gợi ý ngay bên dưới để bạn thêm thẳng vào giỏ.",
      },
      group: {
        question: "Mình muốn đặt món cho nhóm văn phòng.",
        answer: "Bạn có thể tạo một phòng chung để ai ăn người nấy chọn, tem in đúng tên và giao về một điểm. Mình sẽ đưa bạn tới bước tạo đơn nhóm.",
      },
      partner: {
        question: "Mình muốn tìm hiểu mở điểm bán Đảo Chè.",
        answer: "Đảo Chè có thể khảo sát mô hình cửa hàng sẵn có hoặc vị trí bạn dự định đầu tư. Bạn điền vài thông tin cơ bản, đội mở rộng điểm bán sẽ liên hệ trong 1–2 ngày làm việc.",
      },
    }[topic];
    setChatMessages((current) => [
      ...current,
      { id: `user-${current.length}`, sender: "user", text: copy.question },
      { id: `assistant-${current.length + 1}`, sender: "assistant", text: copy.answer },
    ]);
    setChatContext(topic);
  };

  const requestHumanSupport = async () => {
    try {
      const response = await fetch("/api/customer-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "support_request",
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          subject: "Yêu cầu gặp nhân viên",
          details: { context: chatContext, messages: chatMessages.slice(-10) },
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Không thể chuyển cuộc trò chuyện.");
      setChatMode("human");
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${current.length}`,
          sender: "assistant",
          text: "Mình đã chuyển cuộc trò chuyện tới nhân viên. Khung giờ trực là 08:00–22:00; thời gian phản hồi dự kiến dưới 5 phút.",
        },
      ]);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Không thể chuyển cuộc trò chuyện.");
    }
  };

  const sendChatMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = chatDraft.trim();
    if (!message) return;
    const normalized = message.toLocaleLowerCase("vi-VN");
    const nextContext: Exclude<ChatContext, null> = /đối tác|điểm bán|mở quán|phân phối/.test(normalized)
      ? "partner"
      : /nhóm|văn phòng|cơ quan|nhiều người/.test(normalized)
        ? "group"
        : "menu";
    const answer = chatMode === "human"
      ? "Tin nhắn đã được gửi tới tư vấn viên. Bạn có thể tiếp tục để lại yêu cầu, giỏ món và địa chỉ giao vẫn được giữ nguyên."
      : nextContext === "partner"
        ? "Mình có thể mở ngay hồ sơ đăng ký đối tác và giữ lại nội dung bạn vừa chia sẻ để đội phát triển điểm bán tư vấn tiếp."
        : nextContext === "group"
          ? "Mình đề xuất tạo đơn nhóm: mỗi người tự chọn món, tem theo tên và giao chung một địa chỉ."
          : "Mình gợi ý Chè bưởi Năm Roi 28.000đ cho lần đầu ghé đảo. Bạn có thể thêm ngay hoặc mở thực đơn để xem cả 15 món.";
    if (chatMode === "human") {
      try {
        const response = await fetch("/api/customer-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestType: "support_message",
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            subject: "Tin nhắn hỗ trợ trực tiếp",
            details: { message, context: chatContext },
          }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Không thể gửi tin nhắn tới tư vấn viên.");
      } catch (error) {
        flash(error instanceof Error ? error.message : "Không thể gửi tin nhắn tới tư vấn viên.");
        return;
      }
    }
    setChatMessages((current) => [
      ...current,
      { id: `user-${current.length}`, sender: "user", text: message },
      { id: `assistant-${current.length + 1}`, sender: "assistant", text: answer },
    ]);
    setChatContext(nextContext);
    setChatDraft("");
  };
  const hasBackNavigation = showAllProducts || activeTab !== "home";

  return {
    AccountServiceIcon,
    accountLoading,
    accountServiceDetail,
    activeGroupCode,
    activeOrder,
    activeTab,
    addSavedLocation,
    addressDraft,
    affiliateAccount,
    authBusy,
    authDraft,
    authError,
    authMode,
    customerAccount,
    customerSession,
    openAuthSheet,
    productRatings,
    promotionCode,
    refreshCustomerAccount,
    setAuthDraft,
    setAuthMode,
    setPromotionCode,
    setShowAuthSheet,
    showAuthSheet,
    signOutCustomer,
    submitCustomerAuth,
    affiliateApplicationSent,
    affiliateSession,
    showAffiliateAuth,
    setShowAffiliateAuth,
    affiliateAuthDraft,
    setAffiliateAuthDraft,
    affiliateAuthError,
    affiliateAuthBusy,
    submitAffiliateAuth,
    signOutAffiliate,
    affiliateDraft,
    askChatTopic,
    cart,
    cartChoices,
    cartCount,
    cartLines,
    cartPreview,
    cartTotal,
    catalogError,
    catalogLoading,
    category,
    chatContext,
    chatDraft,
    chatMessages,
    chatMode,
    checkoutClientReference,
    checkoutStep,
    checkoutTotal,
    confirmStorePreorder,
    continueCheckout,
    continueShopping,
    copyGroupLink,
    copyReferralLink,
    customer,
    customerInitials,
    dailyActionHubVerse,
    deliveryFee,
    deliveryQuote,
    deliveryQuoteError,
    deliveryQuoteLoading,
    editingGroupProfileId,
    favorites,
    finalizeGroupRoom,
    flash,
    fulfillment,
    goBack,
    goTo,
    groupChosenCount,
    groupClock,
    groupCountdown,
    groupGuestName,
    groupGuestSubmitted,
    groupHasStarted,
    groupIsExpired,
    groupOrderedNames,
    groupPendingNames,
    groupProductId,
    groupProfileDraft,
    groupProfileSaving,
    groupProfilesLoading,
    groupRoom,
    groupRoster,
    groupRosterDraft,
    groupRosters,
    groupSecondsLeft,
    groupShareLink,
    groupSubmitting,
    handleProfilePhoto,
    hasBackNavigation,
    homeProducts,
    hydrated,
    joinCode,
    joinGroupRoom,
    location,
    nearbyStores,
    officialStoreCount,
    openAffiliateApplication,
    openCart,
    openCatalog,
    openGroupJourney,
    openGroupProfileSetup,
    openGroupShare,
    openPartnerApplication,
    openProduct,
    openProfileEditor,
    openStorePreorderJourney,
    openTakeawayMenu,
    orderNow,
    partnerApplicationSent,
    partnerDraft,
    partnerStoreCount,
    payment,
    placeOrder,
    placedOrderId,
    placingOrder,
    privacyConsent,
    previousTab,
    productChoice,
    products,
    profileDraft,
    query,
    referralMessage,
    referralUrl,
    requestHumanSupport,
    saveCustomerProfile,
    saveGroupProfile,
    savedGroupProfiles,
    savedLocations,
    removeSavedLocation,
    addressBusy,
    addressBookSynced,
    selectedAccountService,
    selectedProduct,
    selectedRevenueSource,
    selectedServicePoint,
    selectedStore,
    sendChatMessage,
    setActiveOrder,
    setActiveTab,
    setAddressDraft,
    setAffiliateAccount,
    setAffiliateApplicationSent,
    setAffiliateDraft,
    setCart,
    setCartChoices,
    setCategory,
    setChatContext,
    setChatDraft,
    setChatMessages,
    setChatMode,
    setCheckoutClientReference,
    setCheckoutStep,
    setCustomer,
    setEditingGroupProfileId,
    setFavorites,
    setFulfillment,
    setGroupClock,
    setGroupGuestName,
    setGroupProductId,
    setGroupProfileDraft,
    setGroupProfileSaving,
    setGroupProfilesLoading,
    setGroupRoom,
    setGroupRosterDraft,
    setGroupRosters,
    setGroupSubmitting,
    setHydrated,
    setJoinCode,
    setLocation,
    setPartnerApplicationSent,
    setPartnerDraft,
    setPayment,
    setPrivacyConsent,
    setPlacedOrderId,
    setPlacingOrder,
    setPreviousTab,
    setProductChoice,
    setProfileDraft,
    setQuery,
    setSavedGroupProfiles,
    setSavedLocations,
    setSelectedAccountService,
    setSelectedProduct,
    setSelectedRevenueSource,
    setSelectedServicePoint,
    setSelectedStore,
    setShowAddressForm,
    setShowAffiliateApplication,
    setShowAffiliateShare,
    setShowAllProducts,
    setShowCart,
    setShowCartDecision,
    setShowChat,
    setShowExperienceProgram,
    setShowFavorites,
    setShowFilters,
    setShowGroupSetup,
    setShowGroupShare,
    setShowLocation,
    setShowNearbyActions,
    setShowNotifications,
    setShowPartnerApplication,
    setShowProfileEditor,
    setShowStorePreorder,
    setStoreFilter,
    setStorePreorderMode,
    setStorePreorderPartySize,
    setStorePreorderStoreId,
    setStorePreorderTableLabel,
    setStorePreorderTime,
    setToast,
    shareGroupTo,
    shareReferralTo,
    showAddressForm,
    showAffiliateApplication,
    showAffiliateShare,
    showAllProducts,
    showCart,
    showCartDecision,
    showChat,
    showExperienceProgram,
    showFavorites,
    showFilters,
    showGroupSetup,
    showGroupShare,
    showLocation,
    showNearbyActions,
    showNotifications,
    showPartnerApplication,
    showProfileEditor,
    showStorePreorder,
    startSavedGroupProfile,
    storePoints,
    storesError,
    storesLoading,
    storeFilter,
    storePreorderMode,
    storePreorderPartySize,
    storePreorderStoreId,
    storePreorderTableLabel,
    storePreorderTime,
    submitAffiliateApplication,
    submitGroupChoice,
    submitPartnerApplication,
    toast,
    toggleFavorite,
    updateCart,
    visibleProducts
  };
}

export type OrderController = ReturnType<typeof useOrderController>;
