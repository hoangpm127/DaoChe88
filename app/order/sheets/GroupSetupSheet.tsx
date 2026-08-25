import { ArrowRight, ChevronDown, MapPinned, ShieldCheck, X } from "lucide-react";
import styles from "../customer.module.css";
import { groupProfileTypes } from "../data/content";
import type { OrderController } from "../controller";

type GroupSetupSheetProps = { model: OrderController };

export default function GroupSetupSheet({ model }: GroupSetupSheetProps) {
  const { editingGroupProfileId, groupProfileDraft, groupProfileSaving, groupRosterDraft, saveGroupProfile, setGroupProfileDraft, setGroupRosterDraft, setShowGroupSetup, showGroupSetup } = model;
  return (showGroupSetup && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget && !groupProfileSaving) setShowGroupSetup(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.groupSetupSheet}`} role="dialog" aria-modal="true" aria-labelledby="group-setup-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div>
                <small>CÀI MỘT LẦN · DÙNG CHO NHỮNG LẦN SAU</small>
                <h2 id="group-setup-title">{groupProfileTypes.find((item) => item.id === groupProfileDraft.kind)?.title}</h2>
              </div>
              <button type="button" aria-label="Đóng" disabled={groupProfileSaving} onClick={() => setShowGroupSetup(false)}><X size={20} /></button>
            </div>
            <div className={styles.groupSetupPromise}>
              <ShieldCheck size={19} />
              <p>Địa chỉ và cách nhận món được lưu theo tài khoản. Khi đặt lại, bill sẽ tự điền sẵn để bạn chỉ cần kiểm tra và xác nhận.</p>
            </div>
            <form className={styles.groupSetupForm} onSubmit={saveGroupProfile}>
              <label>
                <span>Tên gợi nhớ của nhóm</span>
                <input autoFocus value={groupProfileDraft.name} onChange={(event) => setGroupProfileDraft({ ...groupProfileDraft, name: event.target.value })} placeholder="VD: Team Marketing tầng 22" />
              </label>
              <div className={styles.formRow}>
                <label>
                  <span>Người nhận</span>
                  <input value={groupProfileDraft.recipient} onChange={(event) => setGroupProfileDraft({ ...groupProfileDraft, recipient: event.target.value })} placeholder="Họ tên" />
                </label>
                <label>
                  <span>Số điện thoại</span>
                  <input inputMode="tel" value={groupProfileDraft.phone} onChange={(event) => setGroupProfileDraft({ ...groupProfileDraft, phone: event.target.value })} placeholder="09xx xxx xxx" />
                </label>
              </div>
              <label>
                <span>{groupProfileDraft.shippingMode === "pickup" ? "Điểm bạn sẽ tới nhận món" : "Địa chỉ giao mặc định"}</span>
                <input value={groupProfileDraft.address} onChange={(event) => setGroupProfileDraft({ ...groupProfileDraft, address: event.target.value })} placeholder="Tòa nhà, số nhà, đường, quận..." />
              </label>
              <label>
                <span>Ghi chú bàn giao</span>
                <input value={groupProfileDraft.deliveryNote} onChange={(event) => setGroupProfileDraft({ ...groupProfileDraft, deliveryNote: event.target.value })} placeholder="VD: Giao lễ tân, gọi trước 3 phút" />
              </label>
              <label className={styles.groupRosterField}>
                <span>Danh sách thành viên · không bắt buộc</span>
                <input value={groupRosterDraft} onChange={(event) => setGroupRosterDraft(event.target.value)} placeholder="VD: Minh Anh, Quốc Bảo, Hương, Đức" />
                <small>Ngăn cách bằng dấu phẩy. Khi mở link, mỗi người chỉ cần chọn đúng tên của mình.</small>
              </label>
              <div className={styles.formRow}>
                <label>
                  <span>Giờ nhận mặc định</span>
                  <input type="time" value={groupProfileDraft.deliverySlot} onChange={(event) => setGroupProfileDraft({ ...groupProfileDraft, deliverySlot: event.target.value })} />
                </label>
                <label>
                  <span>Khóa đơn lúc</span>
                  <input type="time" value={groupProfileDraft.cutoff} onChange={(event) => setGroupProfileDraft({ ...groupProfileDraft, cutoff: event.target.value })} />
                </label>
              </div>
              <label>
                <span>Cách chủ phòng thanh toán</span>
                <select value={groupProfileDraft.payment} onChange={(event) => setGroupProfileDraft({ ...groupProfileDraft, payment: event.target.value })}>
                  <option>Chủ phòng thanh toán chung</option>
                  <option>Doanh nghiệp tài trợ</option>
                  <option>Thanh toán khi nhận món</option>
                </select>
                <ChevronDown size={16} />
              </label>
              <div className={styles.groupSetupSummary}>
                <span><MapPinned size={17} /> {groupProfileDraft.shippingMode === "pickup" ? "Bếp làm trước · tự đến lấy" : "AI tự chọn điểm làm món gần địa chỉ"}</span>
                <strong>{groupProfileDraft.deliverySlot}</strong>
              </div>
              <button className={styles.primaryButton} type="submit" disabled={groupProfileSaving}>
                {groupProfileSaving ? "Đang lưu nhóm..." : editingGroupProfileId ? "Lưu thay đổi & chọn món" : "Lưu nhóm & chọn món"} <ArrowRight size={18} />
              </button>
            </form>
          </section>
        </div>
      ));
}
