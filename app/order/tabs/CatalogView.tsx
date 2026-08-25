import { Heart, Minus, Plus, SlidersHorizontal, Star } from "lucide-react";
import styles from "../customer.module.css";
import { catalogFilters } from "../data/products";
import { money } from "../lib/order-utils";
import { ProductPhoto } from "../controller";
import type { OrderController } from "../controller";

type CatalogViewProps = { model: OrderController };

export default function CatalogView({ model }: CatalogViewProps) {
  const { cart, category, favorites, openProduct, selectedServicePoint, setCategory, setShowFilters, toggleFavorite, updateCart, visibleProducts } = model;
  return (
    <section className={styles.catalogPage}>
      <div className={styles.catalogHeading}>
        <div>
          <small>THỰC ĐƠN ĐẢO CHÈ</small>
          <h1>Tất cả món</h1>
          <p>
            {visibleProducts.length} lựa chọn · làm từ {selectedServicePoint}
          </p>
        </div>
        <button type="button" onClick={() => setShowFilters(true)}>
          <SlidersHorizontal size={19} /> Lọc
        </button>
      </div>
      <div className={styles.catalogCategories} role="group" aria-label="Lọc thực đơn">
        {catalogFilters.map((filter) => (
          <button className={category === filter ? styles.categoryActive : ""} type="button" key={filter} onClick={() => setCategory(filter)}>
            {filter}
          </button>
        ))}
      </div>
      <div className={styles.catalogList}>
        {visibleProducts.map((product) => (
          <article className={styles.catalogCard} key={product.id}>
            <button className={styles.catalogImageButton} type="button" aria-label={`Xem ${product.name}`} onClick={() => openProduct(product)}>
              <ProductPhoto index={product.image} imageUrl={product.imageUrl} />
              {product.popular && (
                <span>
                  <Star size={11} fill="currentColor" /> Bán chạy
                </span>
              )}
            </button>
            <div className={styles.catalogInfo}>
              <div>
                <button type="button" className={favorites.includes(product.id) ? styles.favoriteActive : ""} aria-label={`Lưu ${product.name}`} onClick={() => toggleFavorite(product.id)}>
                  <Heart size={17} fill={favorites.includes(product.id) ? "currentColor" : "none"} />
                </button>
                <h2 onClick={() => openProduct(product)}>{product.name}</h2>
                <p>{product.note}</p>
              </div>
              <div className={styles.catalogMeta}>
                <span>{product.prep}</span>
              </div>
              <div className={styles.catalogFacts}>
                <span>{product.serving}</span>
                <span>{product.stock}</span>
              </div>
              <div className={styles.catalogAction}>
                <strong>{money(product.price)}</strong>
                {cart[product.id] ? (
                  <span className={styles.quantityControl}>
                    <button type="button" aria-label={`Giảm ${product.name}`} onClick={() => updateCart(product.id, -1)}>
                      <Minus size={15} />
                    </button>
                    <b>{cart[product.id]}</b>
                    <button type="button" aria-label={`Thêm ${product.name}`} onClick={() => updateCart(product.id, 1)}>
                      <Plus size={15} />
                    </button>
                  </span>
                ) : (
                  <button type="button" aria-label={`Thêm ${product.name} vào giỏ`} onClick={() => updateCart(product.id, 1)}>
                    <Plus size={17} /> Thêm
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
