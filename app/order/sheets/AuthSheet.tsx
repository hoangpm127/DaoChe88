import { ArrowRight, ShieldCheck, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type AuthSheetProps = { model: OrderController };

/**
 * Đăng nhập và đăng ký tài khoản khách (M11).
 *
 * Backend đã có từ M11 nhưng chưa từng có giao diện gọi tới, nên mọi người mở
 * app đều dùng chung một hồ sơ ghi cứng trong mã nguồn. Đây là màn hình nối vào
 * /api/customers/session.
 *
 * ĐẶT ĐƠN KHÔNG CẦN ĐĂNG NHẬP — theo quyết định trong kế hoạch, khách vãng lai
 * vẫn đặt được. Đăng nhập để giữ lịch sử đơn, điểm thưởng và ưu đãi.
 */
export default function AuthSheet({ model }: AuthSheetProps) {
  const { authBusy, authDraft, authError, authMode, setAuthDraft, setAuthMode, setShowAuthSheet, showAuthSheet, submitCustomerAuth } = model;
  if (!showAuthSheet) return null;
  const registering = authMode === "register";
  return (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) setShowAuthSheet(false);
      }}
    >
      <section className={`${styles.sheet} ${styles.authSheet}`} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className={styles.sheetGrabber} />
        <div className={styles.sheetHeading}>
          <div>
            <small>TÀI KHOẢN ĐẢO CHÈ</small>
            <h2 id="auth-title">{registering ? "Tạo tài khoản" : "Đăng nhập"}</h2>
          </div>
          <button type="button" aria-label="Đóng" onClick={() => setShowAuthSheet(false)}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.authModeSwitch} role="tablist">
          <button type="button" role="tab" aria-selected={!registering} className={!registering ? styles.authModeActive : ""} onClick={() => setAuthMode("login")}>
            Đã có tài khoản
          </button>
          <button type="button" role="tab" aria-selected={registering} className={registering ? styles.authModeActive : ""} onClick={() => setAuthMode("register")}>
            Tạo mới
          </button>
        </div>

        <form className={styles.authForm} onSubmit={submitCustomerAuth}>
          {registering && (
            <label>
              <span>Họ tên *</span>
              <input
                required
                value={authDraft.fullName}
                onChange={(event) => setAuthDraft({ ...authDraft, fullName: event.target.value })}
                placeholder="Tên của bạn"
                autoComplete="name"
              />
            </label>
          )}
          <label>
            <span>Số điện thoại *</span>
            <input
              required
              inputMode="tel"
              value={authDraft.phone}
              onChange={(event) => setAuthDraft({ ...authDraft, phone: event.target.value })}
              placeholder="VD: 0912 345 678"
              autoComplete="tel"
            />
          </label>
          <label>
            <span>Mật khẩu *</span>
            <input
              required
              type="password"
              value={authDraft.password}
              onChange={(event) => setAuthDraft({ ...authDraft, password: event.target.value })}
              placeholder={registering ? "Ít nhất 8 ký tự" : "Mật khẩu của bạn"}
              autoComplete={registering ? "new-password" : "current-password"}
            />
          </label>

          {authError && <p className={styles.authError} role="alert">{authError}</p>}

          <button className={styles.primaryButton} type="submit" disabled={authBusy}>
            {authBusy ? "Đang xử lý…" : registering ? "Tạo tài khoản" : "Đăng nhập"} <ArrowRight size={18} />
          </button>
        </form>

        <div className={styles.authNote}>
          <ShieldCheck size={18} />
          <div>
            <strong>Đặt món không bắt buộc đăng nhập</strong>
            <p>
              {registering
                ? "Tài khoản mới chỉ thấy đơn đặt từ lúc đăng nhập trở đi. Đơn cũ đặt bằng số này sẽ được mở khoá khi có xác minh số điện thoại."
                : "Chưa có kênh gửi mã xác minh nên chưa thể tự đặt lại mật khẩu. Quên mật khẩu thì bạn liên hệ cửa hàng."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
