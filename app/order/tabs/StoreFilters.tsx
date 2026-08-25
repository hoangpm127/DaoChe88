import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type StoreFiltersProps = { model: OrderController };

export default function StoreFilters({ model }: StoreFiltersProps) {
  const { officialStoreCount, partnerStoreCount, setStoreFilter, storeFilter, storePoints } = model;
  return (
    <div className={styles.storeFilterBar} role="group" aria-label="Lọc loại điểm bán">
        <button aria-pressed={storeFilter === "all"} className={storeFilter === "all" ? styles.storeFilterActive : ""} type="button" onClick={() => setStoreFilter("all")}>
          <span>Tất cả</span><b>{storePoints.length}</b>
        </button>
        <button aria-pressed={storeFilter === "official"} className={`${styles.officialFilter} ${storeFilter === "official" ? styles.storeFilterActive : ""}`} type="button" onClick={() => setStoreFilter("official")}>
          <i /> <span>Chính thống</span><b>{officialStoreCount}</b>
        </button>
        <button aria-pressed={storeFilter === "partner"} className={`${styles.partnerFilter} ${storeFilter === "partner" ? styles.storeFilterActive : ""}`} type="button" onClick={() => setStoreFilter("partner")}>
          <i /> <span>Đối tác</span><b>{partnerStoreCount}</b>
        </button>
    </div>
  );
}
