import { ArrowLeft, Check, CheckCircle2, ChevronDown, Clock3, Flame, Heart, Leaf, Plus, ShieldCheck, Star, Utensils } from "lucide-react";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import { ProductPhoto } from "../controller";
import type { OrderController } from "../controller";

type ProductDetailsSheetProps = { model: OrderController };

export default function ProductDetailsSheet({ model }: ProductDetailsSheetProps) {
  const { favorites, flash, productChoice, productRatings, selectedProduct, setCartChoices, setProductChoice, setSelectedProduct, toggleFavorite, updateCart } = model;
  // Chỉ có khoá khi món đã thật sự có người đánh giá. Món chưa ai đánh giá thì
  // không hiện ô này — thà trống còn hơn bịa một con số cho đẹp.
  const rating = selectedProduct ? productRatings[selectedProduct.id] : undefined;
  return (selectedProduct && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedProduct(null);
          }}
        >
          <section className={`${styles.sheet} ${styles.productSheet}`} role="dialog" aria-modal="true" aria-labelledby="product-title">
            <div className={styles.sheetGrabber} />
            <button className={styles.productSheetClose} type="button" aria-label="Quay lại" onClick={() => setSelectedProduct(null)}>
              <ArrowLeft size={20} />
            </button>
            <div className={styles.productSheetPhoto}>
              <ProductPhoto index={selectedProduct.image} imageUrl={selectedProduct.imageUrl} gallery={selectedProduct.id === "TP-T2-S"} />
              <span className={styles.productAvailability}>
                <CheckCircle2 size={14} /> {selectedProduct.stock}
              </span>
              <button type="button" aria-label="Yêu thích" className={favorites.includes(selectedProduct.id) ? styles.favoriteActive : ""} onClick={() => toggleFavorite(selectedProduct.id)}>
                <Heart size={19} fill={favorites.includes(selectedProduct.id) ? "currentColor" : "none"} />
              </button>
            </div>
            <div className={styles.productSheetBody}>
              <div className={styles.productTitleRow}>
                <div>
                  <small>
                    {selectedProduct.category.toLocaleUpperCase("vi")} · {selectedProduct.id}
                  </small>
                  <h2 id="product-title">{selectedProduct.name}</h2>
                  <p>{selectedProduct.legacy}</p>
                </div>
              </div>
              <div className={styles.productSheetMeta}>
                <span>
                  <Clock3 size={14} /> {selectedProduct.prep}
                </span>
              </div>
              <p>{selectedProduct.description}</p>
              <div className={styles.productTags}>
                {selectedProduct.tags.map((tag) => (
                  <span key={tag}>
                    <Check size={11} /> {tag}
                  </span>
                ))}
              </div>
              <div className={styles.productInsightGrid}>
                {rating && (
                  <article>
                    <Star size={17} fill="currentColor" />
                    <span>
                      <small>ĐÁNH GIÁ</small>
                      <strong>{rating.average.toFixed(1)} · {rating.total} lượt</strong>
                    </span>
                  </article>
                )}
                <article>
                  <Flame size={17} />
                  <span>
                    <small>NĂNG LƯỢNG</small>
                    <strong>{selectedProduct.calories} kcal</strong>
                  </span>
                </article>
                <article>
                  <Utensils size={17} />
                  <span>
                    <small>KHẨU PHẦN</small>
                    <strong>{selectedProduct.serving}</strong>
                  </span>
                </article>
                <article>
                  <Leaf size={17} />
                  <span>
                    <small>PROTEIN</small>
                    <strong>{selectedProduct.nutrition.protein}</strong>
                  </span>
                </article>
                {/*
                  ĐÃ GỠ ô "ĐIỂM THƯỞNG +N" theo từng món.
                  Điểm thưởng KHÔNG tính theo món. awardLoyaltyPoints (M11) cộng
                  điểm theo tiền hàng của cả đơn, dùng thông số
                  loyalty.points_per_1000_vnd, và bỏ qua hoàn toàn cột
                  reward_points của catalog. Trên production mọi món đều có
                  reward_points = 0 nên khách chỉ thấy "+0 điểm".
                  Muốn hiện điểm theo từng món thì phải trả tỷ lệ loyalty kèm
                  trong /api/catalog rồi tính từ giá — đó là việc của backend.
                */}
              </div>
              <section className={styles.customizationSection}>
                <div className={styles.customizationHeading}>
                  <div>
                    <strong>1. Chọn mức ngọt</strong>
                    <small>Khuyến nghị 50% để cân bằng vị</small>
                  </div>
                  <em>Bắt buộc</em>
                </div>
                <div className={styles.choiceChips}>
                  {selectedProduct.sweetness.map((value) => (
                    <button className={productChoice.sweetness === value ? styles.choiceActive : ""} type="button" key={value} onClick={() => setProductChoice({ ...productChoice, sweetness: value })}>
                      {value}
                    </button>
                  ))}
                </div>
              </section>
              <section className={styles.customizationSection}>
                <div className={styles.customizationHeading}>
                  <div>
                    <strong>2. Nhiệt độ / cách đóng</strong>
                    <small>Đá và cốt có thể đóng riêng</small>
                  </div>
                </div>
                <div className={styles.choiceChips}>
                  {["Mát", "Lạnh", "Đá riêng", "Dùng ấm"].map((value) => (
                    <button
                      className={productChoice.temperature === value ? styles.choiceActive : ""}
                      type="button"
                      key={value}
                      onClick={() =>
                        setProductChoice({
                          ...productChoice,
                          temperature: value,
                        })
                      }
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </section>
              <section className={styles.customizationSection}>
                <div className={styles.customizationHeading}>
                  <div>
                    <strong>3. Topping thêm</strong>
                    <small>Chọn một topping cho bản demo</small>
                  </div>
                </div>
                <div className={styles.toppingList}>
                  <button
                    className={productChoice.topping === "Không thêm" ? styles.toppingActive : ""}
                    type="button"
                    onClick={() =>
                      setProductChoice({
                        ...productChoice,
                        topping: "Không thêm",
                      })
                    }
                  >
                    <span>Không thêm</span>
                    <b>0đ</b>
                    <i>{productChoice.topping === "Không thêm" && <Check size={13} />}</i>
                  </button>
                  {selectedProduct.toppings.map((topping) => (
                    <button
                      className={productChoice.topping === topping.name ? styles.toppingActive : ""}
                      type="button"
                      key={topping.name}
                      onClick={() =>
                        setProductChoice({
                          ...productChoice,
                          topping: topping.name,
                        })
                      }
                    >
                      <span>{topping.name}</span>
                      <b>{topping.price ? `+${money(topping.price)}` : "Miễn phí"}</b>
                      <i>{productChoice.topping === topping.name && <Check size={13} />}</i>
                    </button>
                  ))}
                </div>
              </section>
              <details className={styles.productDetailBlock} open>
                <summary>
                  <span>
                    <Leaf size={17} /> Thành phần & nguồn gốc
                  </span>
                  <ChevronDown size={16} />
                </summary>
                <div>
                  <p>
                    <strong>Thành phần:</strong> {selectedProduct.ingredients}
                  </p>
                  <p>
                    <strong>Nguồn nguyên liệu:</strong> {selectedProduct.origin}
                  </p>
                  <p className={styles.allergenNote}>
                    <ShieldCheck size={15} />
                    <span>
                      <strong>Thông tin dị ứng</strong>
                      {selectedProduct.allergens}
                    </span>
                  </p>
                </div>
              </details>
              <details className={styles.productDetailBlock}>
                <summary>
                  <span>
                    <Flame size={17} /> Dinh dưỡng ước tính
                  </span>
                  <ChevronDown size={16} />
                </summary>
                <div className={styles.nutritionTable}>
                  <span>
                    Năng lượng <b>{selectedProduct.calories} kcal</b>
                  </span>
                  <span>
                    Protein <b>{selectedProduct.nutrition.protein}</b>
                  </span>
                  <span>
                    Carbohydrate <b>{selectedProduct.nutrition.carbs}</b>
                  </span>
                  <span>
                    Chất béo <b>{selectedProduct.nutrition.fat}</b>
                  </span>
                  <small>* Ước tính trên khẩu phần tiêu chuẩn, chưa gồm topping thêm.</small>
                </div>
              </details>
              <div className={styles.productAssurance}>
                <ShieldCheck size={18} />
                <div>
                  <strong>Cam kết Tào Phớ 88</strong>
                  <small>Làm mới trong ngày · niêm phong chống tràn · hoàn món nếu sai tuỳ chọn.</small>
                </div>
              </div>
              <div className={styles.productSheetAction}>
                <div>
                  <small>TỔNG TẠM TÍNH</small>
                  <strong>{money(selectedProduct.price + (selectedProduct.toppings.find((item) => item.name === productChoice.topping)?.price || 0))}</strong>
                  <em>
                    {productChoice.sweetness} ngọt · {productChoice.temperature} · {productChoice.topping}
                  </em>
                </div>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => {
                    setCartChoices((current) => ({ ...current, [selectedProduct.id]: { ...productChoice } }));
                    updateCart(selectedProduct.id, 1);
                    flash(`Đã thêm ${selectedProduct.name} · ${productChoice.sweetness} · ${productChoice.topping}.`);
                    setSelectedProduct(null);
                  }}
                >
                  Thêm vào giỏ <Plus size={17} />
                </button>
              </div>
            </div>
          </section>
        </div>
      ));
}
