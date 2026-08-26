import type { StorePoint } from "../data/stores";

/**
 * Luật chọn điểm bán phục vụ một khách.
 *
 * Tách riêng khỏi order-utils vì đây là phần từng hỏng nặng nhất và cần test
 * chạy thẳng bằng Node: order-utils kéo theo data/content, mà tệp đó import
 * lucide-react nên không import trần được ngoài trình duyệt.
 */

export const distanceBetweenCoordinates = (origin: string, destination: string) => {
  const [originLatitude, originLongitude] = origin.split(",").map((value) => Number(value.trim()));
  const [destinationLatitude, destinationLongitude] = destination.split(",").map((value) => Number(value.trim()));

  if (![originLatitude, originLongitude, destinationLatitude, destinationLongitude].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(destinationLatitude - originLatitude);
  const longitudeDelta = toRadians(destinationLongitude - originLongitude);
  const originLatitudeRadians = toRadians(originLatitude);
  const destinationLatitudeRadians = toRadians(destinationLatitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitudeRadians) * Math.cos(destinationLatitudeRadians) * Math.sin(longitudeDelta / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

/**
 * Cửa hàng gần nhất tính từ một toạ độ thật.
 *
 * Trả về null khi KHÔNG có toạ độ để so. Bản trước trả về phần tử đầu danh sách
 * trong trường hợp đó — mà khi không có toạ độ gốc thì máy chủ xếp danh sách
 * theo tên, nên mọi khách chưa bật GPS đều bị gán vào đúng một cửa hàng: cái
 * đứng đầu bảng chữ cái. Thà nói "chưa biết" rồi để lớp trên chọn cách khác.
 */
export const nearestStoreForCoordinates = (stores: StorePoint[], coordinates: string) => {
  if (!coordinates.trim()) return null;
  const candidates = stores.filter(
    (store) => store.coordinates && Number.isFinite(distanceBetweenCoordinates(coordinates, store.coordinates)),
  );
  if (!candidates.length) return null;
  const open = candidates.filter((store) => store.open);
  return (open.length ? open : candidates).reduce((nearest, store) =>
    distanceBetweenCoordinates(coordinates, store.coordinates) < distanceBetweenCoordinates(coordinates, nearest.coordinates)
      ? store
      : nearest,
  );
};

/** Bỏ dấu tiếng Việt và hạ chữ thường để so khớp địa chỉ dạng chữ. */
const plainText = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Tên đường của một địa chỉ: bỏ số nhà và các tiền tố "số", "sảnh", "lô"... */
const streetName = (value: string) =>
  plainText(value).split(",")[0].replace(/^(?:so|shop|sanh|kiot|lo|toa|nha)\b/, "").replace(/^[\s\d/.-]+/, "").trim();

/**
 * Cửa hàng phục vụ địa chỉ của khách khi chưa có toạ độ.
 *
 * Địa chỉ nhập tay trong sổ không kèm toạ độ nên không tính được khoảng cách
 * thật. Ở đây so tên đường rồi tới quận/huyện của điểm bán với chuỗi địa chỉ
 * khách nhập — thô hơn haversine nhưng đúng hướng, thay vì rơi về một cửa hàng
 * cố định bất kể khách ở đâu.
 */
export const storeMatchingAddressText = (stores: StorePoint[], address: string) => {
  const target = plainText(address).trim();
  if (!target) return null;
  const ranked = stores
    .map((store) => {
      const street = streetName(store.address);
      const district = plainText(store.district).trim();
      let score = 0;
      if (street.length > 3 && target.includes(street)) score += 3;
      if (district.length > 2 && target.includes(district)) score += 2;
      if (score && store.open) score += 1;
      return { store, score };
    })
    .filter((entry) => entry.score >= 2)
    .sort((first, second) => second.score - first.score);
  return ranked[0]?.store || null;
};

/**
 * Cửa hàng mặc định cho khách: gần nhất theo toạ độ, không có toạ độ thì đoán
 * theo chữ trong địa chỉ, không nữa thì điểm đang mở đầu tiên. Luôn trả về một
 * điểm khi danh sách không rỗng, vì thực đơn phải tải từ một điểm cụ thể.
 */
export const defaultStoreForCustomer = (stores: StorePoint[], coordinates: string, address: string) =>
  nearestStoreForCoordinates(stores, coordinates)
  || storeMatchingAddressText(stores, address)
  || stores.find((store) => store.open)
  || stores[0]
  || null;
