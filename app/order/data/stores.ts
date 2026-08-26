export type PublicSiteApi = {
  id: string;
  code: string;
  name: string;
  kind: string;
  address: string;
  district: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  hoursLabel: string;
  fulfillment: string[];
  openNow: boolean;
  closureReason: string;
  reopensAt: string | null;
  distanceMeters: number | null;
  etaMinutes: number | null;
};

export type StorePoint = {
  id: string;
  code: string;
  name: string;
  kind: string;
  kindCode: string;
  address: string;
  district: string;
  coordinates: string;
  distance: number | null;
  hours: string;
  open: boolean;
  closedReason: string;
  eta: string;
  services: string[];
};

export type DeliveryLocation = {
  name: string;
  office: string;
  address: string;
  coordinates: string;
  detail: string;
  /** Id bản ghi trong sổ địa chỉ trên máy chủ — KHÔNG phải id cửa hàng. */
  addressId: string;
  servicePoint: string;
  servicePointId: string;
  /**
   * Khách đã tự chọn cửa hàng hay chưa.
   *
   * Khi bằng true, bộ chọn tự động không được đổi sang cửa hàng khác nữa; nó chỉ
   * làm mới khoảng cách và thời gian cho đúng cửa hàng khách đã chọn.
   */
  servicePointPinned: boolean;
  distance: string;
  eta: string;
};

export const emptyDeliveryLocation: DeliveryLocation = {
  name: "Địa chỉ giao hàng",
  office: "",
  address: "",
  coordinates: "",
  detail: "",
  addressId: "",
  servicePoint: "",
  servicePointId: "",
  servicePointPinned: false,
  distance: "Chưa xác định",
  eta: "Chưa xác định",
};

const fulfillmentLabels: Record<string, string> = {
  delivery: "Giao hàng",
  pickup: "Nhận tại quầy",
  "dine-in": "Dùng tại quán",
};

export function isOfficialStore(store: Pick<StorePoint, "kindCode">) {
  return store.kindCode === "official-store" || store.kindCode === "official-express";
}

export function apiSiteToStorePoint(site: PublicSiteApi): StorePoint {
  const coordinates = site.latitude === null || site.longitude === null ? "" : `${site.latitude}, ${site.longitude}`;
  const distance = site.distanceMeters === null ? null : site.distanceMeters / 1_000;
  return {
    id: site.id,
    code: site.code,
    name: site.name,
    kindCode: site.kind,
    kind: isOfficialStore({ kindCode: site.kind }) ? "Cửa hàng chính thống" : "Điểm đối tác",
    address: site.address,
    district: site.district,
    coordinates,
    distance,
    hours: site.hoursLabel,
    open: site.openNow,
    closedReason: site.closureReason,
    eta: site.etaMinutes === null ? "Chưa có ước tính" : `${site.etaMinutes} phút`,
    services: site.fulfillment.map((value) => fulfillmentLabels[value] || value),
  };
}
