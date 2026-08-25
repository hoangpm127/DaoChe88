import { ArrowLeft, Heart } from "lucide-react";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import { ProductPhoto } from "../controller";
import type { OrderController } from "../controller";

type FavoritesSheetProps = { model: OrderController };

export default function FavoritesSheet({ model }: FavoritesSheetProps) {
  const { favorites, openCatalog, openProduct, products, setShowFavorites, showFavorites, toggleFavorite } = model;
  return (showFavorites && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowFavorites(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.favoritesSheet}`} role="dialog" aria-modal="true" aria-labelledby="favorites-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div>
                <small>SỔ GHI NHỚ MÓN</small>
                <h2 id="favorites-title">Món bạn thích</h2>
              </div>
              <button type="button" aria-label="Quay lại" onClick={() => setShowFavorites(false)}>
                <ArrowLeft size={20} />
              </button>
            </div>
            <p className={styles.sheetCopy}>Các món được lưu trên thiết bị, không mất khi bạn thoát rồi mở lại ứng dụng.</p>
            {favorites.length ? (
              <div className={styles.favoriteList}>
                {products
                  .filter((product) => favorites.includes(product.id))
                  .map((product) => (
                    <article key={product.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowFavorites(false);
                          openProduct(product);
                        }}
                      >
                        <ProductPhoto index={product.image} imageUrl={product.imageUrl} />
                      </button>
                      <div>
                        <strong>{product.name}</strong>
                        <small>{product.note}</small>
                        <b>{money(product.price)}</b>
                      </div>
                      <button type="button" aria-label={`Bỏ lưu ${product.name}`} onClick={() => toggleFavorite(product.id)}>
                        <Heart size={18} fill="currentColor" />
                      </button>
                    </article>
                  ))}
              </div>
            ) : (
              <div className={styles.emptyFavorites}>
                <Heart size={34} />
                <strong>Chưa ghi nhớ món nào</strong>
                <p>Chạm biểu tượng trái tim trên món để lưu lại cho lần đặt sau.</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowFavorites(false);
                    openCatalog();
                  }}
                >
                  Xem toàn bộ món
                </button>
              </div>
            )}
          </section>
        </div>
      ));
}
