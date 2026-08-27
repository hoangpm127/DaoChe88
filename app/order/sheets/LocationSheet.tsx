import { ArrowLeft, ArrowRight, Building2, Check, ChevronRight, Home, MapPin, Navigation, Plus, Trash2 } from "lucide-react";
import HanoiLocationPicker, { isHanoiCoordinate } from "../../components/HanoiLocationPicker";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type LocationSheetProps = { model: OrderController };

export default function LocationSheet({ model }: LocationSheetProps) {
  const { addSavedLocation, addressBusy, addressBookSynced, addressDraft, customer, customerSession, flash, location, removeSavedLocation, savedLocations, setAddressDraft, setCustomer, setLocation, setShowAddressForm, setShowLocation, showAddressForm, showLocation } = model;
  const locate = () => {
    if (!navigator.geolocation) return flash("Thiết bị này không hỗ trợ định vị GPS.");
    navigator.geolocation.getCurrentPosition((position) => {
      if (!isHanoiCoordinate(position.coords.latitude, position.coords.longitude)) {
        flash("Vị trí hiện tại nằm ngoài phạm vi phục vụ tại Hà Nội.");
        return;
      }
      const coordinates = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
      setLocation({ ...location, coordinates });
      if (showAddressForm) {
        setAddressDraft({
          ...addressDraft,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        });
      }
      flash(`Đã cập nhật vị trí GPS, sai số khoảng ${Math.round(position.coords.accuracy)} mét.`);
    }, () => flash("Chưa lấy được vị trí. Hãy cho phép truy cập GPS rồi thử lại."), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 });
  };
  return (showLocation && (
        <div
          className={`${styles.backdrop} ${styles.locationBackdrop}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowLocation(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.locationSheet}`} role="dialog" aria-modal="true" aria-labelledby="location-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div>
                <small>SỔ ĐỊA CHỈ GIAO HÀNG</small>
                <h2 id="location-title">Bạn muốn giao tới đâu?</h2>
              </div>
              <button type="button" aria-label="Quay lại" onClick={() => setShowLocation(false)}>
                <ArrowLeft size={20} />
              </button>
            </div>
            <p className={styles.sheetCopy}>
              {customerSession
                ? "Địa chỉ lưu vào tài khoản của bạn, đổi máy vẫn còn."
                : "Địa chỉ lưu trên thiết bị này. Đăng nhập để giữ lại khi đổi máy."}
            </p>
            <div className={styles.mapPreview}>
              <div className={styles.mapGrid} />
              <span className={styles.mapPin}>
                <MapPin size={22} fill="currentColor" />
              </span>
              <div>
                <small>{location.address ? "ĐANG CHỌN" : "CHƯA CHỌN ĐỊA CHỈ"}</small>
                <strong>{location.office || "Chưa có địa chỉ giao"}</strong>
                <p>{location.address || "Thêm địa chỉ hoặc dùng vị trí hiện tại để bắt đầu."}</p>
                <em>
                  <Navigation size={12} /> {location.coordinates || "Chưa có tọa độ GPS"}
                </em>
              </div>
            </div>
            <button className={styles.currentLocationButton} type="button" onClick={locate}>
              <Navigation size={17} />
              <span>
                <strong>Dùng vị trí hiện tại</strong>
                <small>GPS thật · chỉ dùng để tính phí và giao hàng</small>
              </span>
              <ChevronRight size={15} />
            </button>
            <div className={styles.addressBookHeading}>
              <div>
                <strong>Địa chỉ đã lưu</strong>
                <small>
                  {savedLocations.length
                    ? `${savedLocations.length} địa điểm${customerSession && addressBookSynced ? " · đồng bộ theo tài khoản" : ""}`
                    : "Chưa lưu địa chỉ nào"}
                </small>
              </div>
              <button type="button" onClick={() => setShowAddressForm((value) => !value)}>
                <Plus size={16} /> Thêm địa chỉ
              </button>
            </div>
            {showAddressForm && (
              <form className={styles.addressForm} onSubmit={addSavedLocation}>
                <div className={styles.addressTypeTabs}>
                  {["Nhà", "Cơ quan", "Khác"].map((label) => (
                    <button className={addressDraft.label === label ? styles.addressTypeActive : ""} type="button" key={label} onClick={() => setAddressDraft({ ...addressDraft, label })}>
                      {label}
                    </button>
                  ))}
                </div>
                <label>
                  <span>Tên địa điểm *</span>
                  <input
                    value={addressDraft.office}
                    onChange={(event) =>
                      setAddressDraft({
                        ...addressDraft,
                        office: event.target.value,
                      })
                    }
                    placeholder="VD: Nhà riêng, Văn phòng Marketing"
                  />
                </label>
                <label>
                  <span>Địa chỉ cụ thể *</span>
                  <textarea
                    value={addressDraft.address}
                    onChange={(event) =>
                      setAddressDraft({
                        ...addressDraft,
                        address: event.target.value,
                      })
                    }
                    placeholder="Số nhà, đường, phường, quận, Hà Nội"
                  />
                </label>
                <HanoiLocationPicker
                  latitude={addressDraft.latitude.trim() ? Number(addressDraft.latitude) : null}
                  longitude={addressDraft.longitude.trim() ? Number(addressDraft.longitude) : null}
                  label="Ghim đúng vị trí giao hàng"
                  onChange={(latitude, longitude) => setAddressDraft({
                    ...addressDraft,
                    latitude: latitude.toFixed(6),
                    longitude: longitude.toFixed(6),
                  })}
                />
                <label>
                  <span>Hướng dẫn giao</span>
                  <input
                    value={addressDraft.detail}
                    onChange={(event) =>
                      setAddressDraft({
                        ...addressDraft,
                        detail: event.target.value,
                      })
                    }
                    placeholder="VD: Gọi khi tới cổng"
                  />
                </label>
                <button className={styles.primaryButton} type="submit" disabled={addressBusy}>
                  {addressBusy ? "Đang lưu…" : "Lưu và giao tới đây"} <ArrowRight size={17} />
                </button>
              </form>
            )}
            <div className={styles.locationList}>
              {savedLocations.map((item) => (
                <div className={styles.locationRow} key={item.servicePointId || item.name}>
                  <button
                    type="button"
                    className={location.name === item.name ? styles.locationActive : ""}
                    onClick={() => {
                      setLocation(item);
                      setCustomer({ ...customer, address: item.address });
                      setShowLocation(false);
                      flash(`Đã chọn ${item.office}.`);
                    }}
                  >
                    <span>{item.name.toLocaleLowerCase("vi").startsWith("nhà") ? <Home size={19} /> : <Building2 size={19} />}</span>
                    <div>
                      <strong>{item.office}</strong>
                      <p>{item.address}</p>
                      {/* Khoảng cách và thời gian giao KHÔNG hiện ở đây nữa. Trước
                          kia chúng là chuỗi lưu sẵn, không ai tính lại, nên sai
                          ngay khi khách đổi địa chỉ. Phí và thời gian thật được
                          máy chủ tính ở bước thanh toán từ toạ độ. */}
                      <em>{item.coordinates ? `Toạ độ ${item.coordinates}` : "Chưa có toạ độ · phí giao tính khi đặt"}</em>
                    </div>
                    {location.name === item.name && <Check size={17} />}
                  </button>
                  <button
                    className={styles.locationRemove}
                    type="button"
                    disabled={addressBusy}
                    aria-label={`Xoá địa chỉ ${item.office}`}
                    onClick={() => void removeSavedLocation(item)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {!savedLocations.length && (
                <p className={styles.locationEmpty}>
                  Chưa có địa chỉ nào. Bấm “Thêm địa chỉ” hoặc dùng vị trí hiện tại.
                </p>
              )}
            </div>
          </section>
        </div>
      ));
}
