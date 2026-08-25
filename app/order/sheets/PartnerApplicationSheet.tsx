import { Building2, Check, CheckCircle2, ChevronDown, Send, ShieldCheck, Store, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type PartnerApplicationSheetProps = { model: OrderController };

export default function PartnerApplicationSheet({ model }: PartnerApplicationSheetProps) {
  const { partnerApplicationSent, partnerDraft, setPartnerDraft, setShowPartnerApplication, showPartnerApplication, submitPartnerApplication } = model;
  return (showPartnerApplication && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowPartnerApplication(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.partnerApplicationSheet}`} role="dialog" aria-modal="true" aria-labelledby="partner-application-title">
            <div className={styles.sheetGrabber} />
            {partnerApplicationSent ? (
              <div className={styles.applicationSuccess}>
                <span><CheckCircle2 size={34} /></span>
                <small>{partnerDraft.mode === "Có điểm bán sẵn" ? "ĐÃ NHẬN HỒ SƠ PHÂN PHỐI" : "ĐÃ NHẬN HỒ SƠ ĐIỂM BÁN MỚI"}</small>
                <h2 id="partner-application-title">Cảm ơn bạn đã cùng mở rộng Đảo Chè</h2>
                <p>{partnerDraft.mode === "Có điểm bán sẵn" ? "Đội đối tác sẽ xem mô hình đang vận hành, tệp khách và liên hệ trao đổi sản phẩm trong vòng 01–02 ngày làm việc." : "Đội phát triển điểm bán sẽ xem vị trí, vùng phục vụ và liên hệ khảo sát sơ bộ trong vòng 01–02 ngày làm việc."}</p>
                <button className={styles.primaryButton} type="button" onClick={() => setShowPartnerApplication(false)}>
                  Hoàn tất <Check size={18} />
                </button>
              </div>
            ) : (
              <form onSubmit={submitPartnerApplication}>
                <div className={styles.sheetHeading}>
                  <div>
                    <small>{partnerDraft.mode === "Có điểm bán sẵn" ? "KÊNH ĐỐI TÁC PHÂN PHỐI" : "MỞ ĐIỂM BÁN ĐẢO CHÈ"}</small>
                    <h2 id="partner-application-title">{partnerDraft.mode === "Có điểm bán sẵn" ? "Đăng ký đối tác phân phối" : "Đăng ký mở điểm bán"}</h2>
                  </div>
                  <button type="button" aria-label="Đóng" onClick={() => setShowPartnerApplication(false)}>
                    <X size={20} />
                  </button>
                </div>
                <p className={styles.sheetCopy}>{partnerDraft.mode === "Có điểm bán sẵn" ? "Dành cho chủ quán coffee, nhà hàng hoặc cửa hàng muốn bán thêm sản phẩm Đảo Chè." : "Dành cho người sẵn sàng đầu tư địa điểm mới và cần hỗ trợ lựa chọn vùng, mô hình cùng quy trình vận hành."}</p>

                <div className={styles.partnerModePicker} aria-label="Hình thức hợp tác">
                  <button className={partnerDraft.mode === "Có điểm bán sẵn" ? styles.partnerModeActive : ""} type="button" onClick={() => setPartnerDraft({ ...partnerDraft, mode: "Có điểm bán sẵn" })}>
                    <Store size={21} />
                    <span><strong>Có điểm bán sẵn</strong><small>Coffee, nhà hàng, cửa hàng</small></span>
                  </button>
                  <button className={partnerDraft.mode === "Sẵn sàng đầu tư" ? styles.partnerModeActive : ""} type="button" onClick={() => setPartnerDraft({ ...partnerDraft, mode: "Sẵn sàng đầu tư" })}>
                    <Building2 size={21} />
                    <span><strong>Sẵn sàng đầu tư</strong><small>Tìm vị trí và mở điểm mới</small></span>
                  </button>
                </div>

                <div className={styles.partnerFitGrid}>
                  <span><b>Hồ sơ</b><small>Đánh giá mức độ phù hợp</small></span>
                  <span><b>Vận hành</b><small>Trao đổi mô hình hợp tác</small></span>
                  <span><b>Vùng</b><small>Gợi ý phạm vi phục vụ</small></span>
                </div>

                <div className={styles.applicationFormGrid}>
                  <label>
                    <span>Họ và tên *</span>
                    <input required value={partnerDraft.name} onChange={(event) => setPartnerDraft({ ...partnerDraft, name: event.target.value })} placeholder="Tên người phụ trách" />
                  </label>
                  <label>
                    <span>Số điện thoại *</span>
                    <input required inputMode="tel" value={partnerDraft.phone} onChange={(event) => setPartnerDraft({ ...partnerDraft, phone: event.target.value })} placeholder="0912 345 678" />
                  </label>
                  <label>
                    <span>Mô hình hiện có hoặc dự kiến</span>
                    <select value={partnerDraft.business} onChange={(event) => setPartnerDraft({ ...partnerDraft, business: event.target.value })}>
                      <option>Quán cà phê / đồ uống</option>
                      <option>Nhà hàng / quán ăn</option>
                      <option>Cửa hàng tiện lợi / thực phẩm</option>
                      <option>Mặt bằng độc lập</option>
                      <option>Chưa có mặt bằng</option>
                    </select>
                    <ChevronDown size={16} />
                  </label>
                  <label>
                    <span>Khu vực mong muốn</span>
                    <select value={partnerDraft.district} onChange={(event) => setPartnerDraft({ ...partnerDraft, district: event.target.value })}>
                      <option>Nam Từ Liêm</option>
                      <option>Bắc Từ Liêm</option>
                      <option>Cầu Giấy</option>
                      <option>Hà Đông</option>
                      <option>Thanh Xuân</option>
                      <option>Đống Đa</option>
                      <option>Ba Đình</option>
                      <option>Tây Hồ</option>
                      <option>Long Biên / Gia Lâm</option>
                      <option>Khu vực khác tại Hà Nội</option>
                    </select>
                    <ChevronDown size={16} />
                  </label>
                  <label>
                    <span>Địa chỉ điểm bán hoặc vị trí dự kiến *</span>
                    <input required value={partnerDraft.address} onChange={(event) => setPartnerDraft({ ...partnerDraft, address: event.target.value })} placeholder="Số nhà, đường, phường hoặc khu vực đang tìm" />
                  </label>
                  <label>
                    <span>Thông tin giúp đánh giá nhanh</span>
                    <textarea value={partnerDraft.details} onChange={(event) => setPartnerDraft({ ...partnerDraft, details: event.target.value })} placeholder="Diện tích, lượng khách/ngày, khung giờ hoạt động hoặc ngân sách dự kiến…" />
                  </label>
                </div>

                <div className={styles.applicationRule}>
                  <ShieldCheck size={18} />
                  <p>Đăng ký chưa phát sinh cam kết đầu tư. Đảo Chè sẽ đánh giá vùng phục vụ, mức độ phù hợp và trao đổi mô hình trước khi khảo sát.</p>
                </div>
                <button className={styles.primaryButton} type="submit">
                  {partnerDraft.mode === "Có điểm bán sẵn" ? "Gửi hồ sơ phân phối" : "Gửi hồ sơ mở điểm bán"} <Send size={17} />
                </button>
              </form>
            )}
          </section>
        </div>
      ));
}
