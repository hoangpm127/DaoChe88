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
  servicePoint: string;
  servicePointId: string;
  distance: string;
  eta: string;
};

export const emptyDeliveryLocation: DeliveryLocation = {
  name: "Địa chỉ giao hàng",
  office: "",
  address: "",
  coordinates: "",
  detail: "",
  servicePoint: "",
  servicePointId: "",
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
    coordinates,
    distance,
    hours: site.hoursLabel,
    open: site.openNow,
    closedReason: site.closureReason,
    eta: site.etaMinutes === null ? "Chưa có ước tính" : `${site.etaMinutes} phút`,
    services: site.fulfillment.map((value) => fulfillmentLabels[value] || value),
  };
}
