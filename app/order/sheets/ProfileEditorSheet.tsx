import { Camera, Check, ShieldCheck, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type ProfileEditorSheetProps = { model: OrderController };

export default function ProfileEditorSheet({ model }: ProfileEditorSheetProps) {
  const { handleProfilePhoto, profileDraft, saveCustomerProfile, setProfileDraft, setShowProfileEditor, showProfileEditor } = model;
  return (showProfileEditor && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowProfileEditor(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.profileEditorSheet}`} role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div>
                <small>HỒ SƠ KHÁCH HÀNG</small>
                <h2 id="profile-editor-title">Thông tin của bạn</h2>
              </div>
              <button type="button" aria-label="Đóng" onClick={() => setShowProfileEditor(false)}>
                <X size={20} />
              </button>
            </div>

            <div className={styles.profileAvatarEditor}>
              <div
                className={styles.profileAvatarPreview}
                style={profileDraft.avatar ? { backgroundImage: `url(${profileDraft.avatar})` } : undefined}
              >
                {!profileDraft.avatar && (
                  <strong>
                    {profileDraft.name.trim().split(/\s+/).slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "TP"}
                  </strong>
                )}
                <small><Camera size={14} /></small>
              </div>
              <div>
                <strong>Ảnh đại diện</strong>
                <p>Ảnh được thu nhỏ tự động để tải nhanh và hiển thị đẹp trên điện thoại.</p>
                <span className={styles.profileAvatarActions}>
                  <label htmlFor="customer-profile-photo"><Camera size={15} /> Chọn ảnh</label>
                  <input id="customer-profile-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleProfilePhoto} />
                  {profileDraft.avatar && (
                    <button type="button" onClick={() => setProfileDraft((current) => ({ ...current, avatar: undefined }))}>
                      Dùng chữ viết tắt
                    </button>
                  )}
                </span>
              </div>
            </div>

            <form className={styles.profileEditForm} onSubmit={saveCustomerProfile}>
              <label>
                <span>Họ và tên</span>
                <input
                  autoFocus
                  required
                  value={profileDraft.name}
                  onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Họ tên của bạn"
                />
              </label>
              <div className={styles.profileEditFormRow}>
                <label>
                  <span>Số điện thoại</span>
                  <input
                    required
                    inputMode="tel"
                    autoComplete="tel"
                    value={profileDraft.phone}
                    onChange={(event) => setProfileDraft((current) => ({ ...current, phone: event.target.value }))}
                    placeholder="09xx xxx xxx"
                  />
                </label>
                <label>
                  <span>Ngày sinh</span>
                  <input
                    type="date"
                    value={profileDraft.birthday || ""}
                    onChange={(event) => setProfileDraft((current) => ({ ...current, birthday: event.target.value }))}
                  />
                </label>
              </div>
              <div className={styles.profileEditFormRow}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={profileDraft.email || ""}
                    onChange={(event) => setProfileDraft((current) => ({ ...current, email: event.target.value }))}
                    placeholder="ban@email.com"
                  />
                </label>
                <label>
                  <span>Xưng hô</span>
                  <select
                    value={profileDraft.gender || "Chưa chọn"}
                    onChange={(event) => setProfileDraft((current) => ({ ...current, gender: event.target.value }))}
                  >
                    <option>Nữ</option>
                    <option>Nam</option>
                    <option>Khác</option>
                    <option>Chưa chọn</option>
                  </select>
                </label>
              </div>
              <div className={styles.profilePrivacyNote}>
                <ShieldCheck size={17} />
                <span>Thông tin này giúp giao đúng người, gửi quà sinh nhật và cá nhân hóa ưu đãi của bạn.</span>
              </div>
              <button className={styles.primaryButton} type="submit">
                Lưu hồ sơ <Check size={17} />
              </button>
            </form>
          </section>
        </div>
      ));
}
