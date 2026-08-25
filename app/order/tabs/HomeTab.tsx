import { ArrowRight, ChevronRight, Minus, Plus, Search, Star, UserPlus } from "lucide-react";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import { ProductPhoto, SectionTitle } from "../controller";
import type { OrderController } from "../controller";

type HomeTabProps = { model: OrderController };

export default function HomeTab({ model }: HomeTabProps) {
  const { cart, goTo, homeProducts, openAffiliateApplication, openCatalog, openProduct, query, updateCart } = model;
  return (
    <>
      <section className={`${styles.hero} ${styles.compactGroupCard}`}>
        <div className={styles.heroImage} aria-hidden="true" />
        <div className={styles.heroOverlay} />
        <div className={styles.heroCopy}>
          <span>ĐẶT ĐƠN CHO NHÓM</span>
          <h1>
            Cả nhóm chọn
            <br />
            Giao tận nơi
          </h1>
          <p>Tem theo tên, đúng người đúng món</p>
          <button type="button" onClick={() => goTo("group")}>
            Đặt theo nhóm <ArrowRight size={17} />
          </button>
        </div>
      </section>

      <section className={styles.productSection}>
        <SectionTitle title={query ? "Kết quả tìm kiếm" : "Món nổi bật"} action="Xem tất cả" onAction={openCatalog} />
        <div className={styles.productRail}>
          {homeProducts.map((product) => (
            <article className={styles.productCard} key={product.id}>
              <button className={styles.productImageButton} type="button" aria-label={`Xem ${product.name}`} onClick={() => openProduct(product)}>
                <ProductPhoto index={product.image} imageUrl={product.imageUrl} />
                {product.popular && (
                  <span className={styles.popularTag}>
                    <Star size={11} fill="currentColor" /> Bán chạy
                  </span>
                )}
                <span className={styles.productStock}>{product.stock}</span>
              </button>
              <div className={styles.productInfo}>
                <h3>{product.name}</h3>
                <p>{product.note}</p>
                <div className={styles.productCardFacts}>
                  <span>{product.serving}</span>
                  <span>{product.prep}</span>
                </div>
                <div>
                  <strong>{money(product.price)}</strong>
                  {cart[product.id] ? (
                    <span className={styles.quantityControl}>
                      <button type="button" aria-label={`Giảm ${product.name}`} onClick={() => updateCart(product.id, -1)}>
                        <Minus size={14} />
                      </button>
                      <b>{cart[product.id]}</b>
                      <button type="button" aria-label={`Thêm ${product.name}`} onClick={() => updateCart(product.id, 1)}>
                        <Plus size={14} />
                      </button>
                    </span>
                  ) : (
                    <button className={styles.addButton} type="button" aria-label={`Thêm ${product.name}`} onClick={() => updateCart(product.id, 1)}>
                      <Plus size={18} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {!homeProducts.length && (
            <div className={styles.noResults}>
              <Search size={28} />
              <strong>Chưa tìm thấy món phù hợp</strong>
              <span>Thử tìm “chè bưởi”, “khúc bạch” hoặc “sầu riêng”.</span>
            </div>
          )}
        </div>
      </section>

      <section className={styles.homeAffiliateInvite}>
        <span><UserPlus size={22} /></span>
        <div>
          <small>CHƯƠNG TRÌNH GIỚI THIỆU</small>
          <strong>Giới thiệu khách, nhận hoa hồng từ đơn thật</strong>
          <p>Đăng ký một lần để được cấp mã riêng; hoa hồng chỉ tính trên đơn đã giao và kiểm tra được đến từng bill.</p>
        </div>
        <button type="button" onClick={openAffiliateApplication} aria-label="Đăng ký Affiliate">
          <ChevronRight size={17} />
        </button>
      </section>

    </>
  );
}
