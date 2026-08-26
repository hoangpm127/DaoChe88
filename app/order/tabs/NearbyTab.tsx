import { CheckCircle2, ChevronRight, Clock3, Plus, Store } from "lucide-react";
import styles from "../customer.module.css";
import HanoiStoreMap from "../HanoiStoreMap";
import { isOfficialStore } from "../data/stores";
import { storeServiceIcons } from "../data/content";
import type { OrderController } from "../controller";

type NearbyTabProps = { model: OrderController };

export default function NearbyTab({ model }: NearbyTabProps) {
  const { location, nearbyStores, setSelectedStore, storeFilter, storePoints, storesError, storesLoading } = model;
  return (
    <section className={`${styles.tabPage} ${styles.nearbyPage}`}>
      <HanoiStoreMap
        stores={nearbyStores}
        onSelect={(storeId) => {
          const store = storePoints.find((point) => point.id === storeId);
          if (store) setSelectedStore(store);
        }}
      />
      <div className={styles.nearbySummary}>
        <strong>
          {nearbyStores.length} {storeFilter === "all" ? "điểm tại Hà Nội" : storeFilter === "official" ? "điểm chính thống" : "điểm đối tác"}
        </strong>
        <span>{location.servicePoint ? `Đang đặt tại ${location.servicePoint}` : "Gần điểm giao trước"}</span>
      </div>
      {storesLoading && <p role="status">Đang tải danh sách điểm bán…</p>}
      {!storesLoading && storesError && <p role="alert">{storesError}</p>}
      {!storesLoading && !storesError && nearbyStores.length === 0 && <p>Chưa có điểm bán phù hợp với bộ lọc.</p>}
      <div className={styles.storeList}>
        {nearbyStores.map((store) => {
          const official = isOfficialStore(store);
          return (
          <button className={official ? styles.officialStoreCard : styles.partnerStoreCard} type="button" key={store.id} onClick={() => setSelectedStore(store)}>
            <span className={styles.storeTypeIcon}>
              <Store size={21} />
            </span>
            <div className={styles.storeCardBody}>
              <div className={styles.storeCardHeader}>
                <em>{store.kind}</em>
                <b className={store.open ? styles.storeOpen : styles.storeClosed}>{store.open ? "Đang mở" : "Đã đóng"}</b>
              </div>
              <strong className={styles.storeCardName}>
                {store.name}
                {store.id === location.servicePointId && <i className={styles.storeCardActive}>Đang đặt tại đây</i>}
              </strong>
              <p className={styles.storeCardAddress}>{store.address}</p>
              <small className={styles.storeCardMeta}>
                <span><Clock3 size={12} /> {store.hours}</span>
              </small>
              <span className={styles.storeServiceLine}>
                {store.services.slice(0, 2).map((service) => {
                  const ServiceIcon = storeServiceIcons[service] || CheckCircle2;
                  return <i key={service}><ServiceIcon size={11} /> {service}</i>;
                })}
                {store.services.length > 2 && <i><Plus size={10} /> {store.services.length - 2}</i>}
              </span>
            </div>
            <aside>
              <strong>{store.distance === null ? "Chưa rõ khoảng cách" : `${store.distance.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km`}</strong>
              <small>{store.eta}</small>
              <ChevronRight size={17} />
            </aside>
          </button>
          );
        })}
      </div>
    </section>
  );
}
