import { ArrowLeft, ArrowRight } from "lucide-react";
import styles from "../customer.module.css";
import { ProductFilter, categories } from "../data/products";
import type { OrderController } from "../controller";

type FilterSheetProps = { model: OrderController };

export default function FilterSheet({ model }: FilterSheetProps) {
  const { category, setCategory, setShowAllProducts, setShowFilters, showFilters, visibleProducts } = model;
  return (showFilters && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowFilters(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.filterSheet}`} role="dialog" aria-modal="true" aria-labelledby="filter-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div>
                <small>LỌC NHANH THỰC ĐƠN</small>
                <h2 id="filter-title">Bạn muốn ăn gì?</h2>
              </div>
              <button type="button" aria-label="Quay lại" onClick={() => setShowFilters(false)}>
                <ArrowLeft size={20} />
              </button>
            </div>
            <div className={styles.filterBlock}>
              <strong>Danh mục</strong>
              <div>
                {["Tất cả", ...categories.map((item) => item.label)].map((label) => (
                  <button className={category === label ? styles.filterActive : ""} type="button" key={label} onClick={() => setCategory(label as ProductFilter)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.filterBlock}>
              <strong>Ưu tiên hôm nay</strong>
              <div>
                <button className={category === "Bán chạy" ? styles.filterActive : ""} type="button" onClick={() => setCategory("Bán chạy")}>Bán chạy</button>
                <button className={category === "Nhẹ bụng" ? styles.filterActive : ""} type="button" onClick={() => setCategory("Nhẹ bụng")}>Dưới 200 kcal</button>
                <button className={category === "Thuần chay" ? styles.filterActive : ""} type="button" onClick={() => setCategory("Thuần chay")}>Thuần chay</button>
                <button className={category === "Giao nhanh" ? styles.filterActive : ""} type="button" onClick={() => setCategory("Giao nhanh")}>Giao dưới 15 phút</button>
                <button className={category === "Combo văn phòng" ? styles.filterActive : ""} type="button" onClick={() => setCategory("Combo văn phòng")}>Đơn nhóm</button>
              </div>
            </div>
            <div className={styles.filterBlock}>
              <strong>Khoảng giá</strong>
              <div>
                <button className={category === "Dưới 25k" ? styles.filterActive : ""} type="button" onClick={() => setCategory("Dưới 25k")}>Dưới 25k</button>
                <button className={category === "25k–40k" ? styles.filterActive : ""} type="button" onClick={() => setCategory("25k–40k")}>25k–40k</button>
                <button className={category === "Combo tiết kiệm" ? styles.filterActive : ""} type="button" onClick={() => setCategory("Combo tiết kiệm")}>Combo tiết kiệm</button>
              </div>
            </div>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                setShowFilters(false);
                setShowAllProducts(true);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Xem {visibleProducts.length} món phù hợp <ArrowRight size={17} />
            </button>
          </section>
        </div>
      ));
}
