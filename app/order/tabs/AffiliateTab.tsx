import { ArrowRight, CalendarDays, CheckCircle2, ChevronRight, Copy, DollarSign, LogOut, ReceiptText, Share2, ShieldCheck, TrendingUp, UserPlus, WalletCards } from "lucide-react";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import { SectionTitle } from "../controller";
import type { OrderController } from "../controller";

type AffiliateTabProps = { model: OrderController };

export default function AffiliateTab({ model }: AffiliateTabProps) {
  const {
    affiliateAccount, affiliateSession, affiliateAuthBusy, affiliateAuthDraft, affiliateAuthError,
    copyReferralLink, openAffiliateApplication, setAffiliateAuthDraft, setShowAffiliateShare,
    signOutAffiliate, submitAffiliateAuth,
  } = model;

  // Chưa đăng nhập thì KHÔNG hiện số nào. Trước đây trang này đọc token trong
  // localStorage nên ai mở link cũng thấy hoa hồng; nay số liệu chỉ hiện sau khi
  // xác thực đúng chủ tài khoản.
  if (!affiliateSession) {
    return (
      <section className={`${styles.tabPage} ${styles.affiliatePage}`}>
        <div className={styles.affiliateHero}>
          <div className={styles.affiliateHeroTop}>
            <span className={styles.affiliateIcon}><DollarSign size={25} /></span>
            <div>
              <p>AFFILIATE · DỮ LIỆU ĐƠN THẬT</p>
              <h1>Trung tâm Affiliate</h1>
            </div>
            <span className={styles.rateBadge}>6–10%</span>
          </div>
          <div className={styles.affiliateHeroSummary}>
            <span><ShieldCheck size={14} /> Đăng nhập để xem hoa hồng</span>
            <span><CheckCircle2 size={14} /> Đối soát từng bill</span>
          </div>
        </div>

        <form className={styles.affiliateAuthForm} onSubmit={submitAffiliateAuth}>
          <h2>Đăng nhập cộng tác viên</h2>
          <p>Tài khoản được cấp sau khi hồ sơ của bạn được duyệt.</p>
          <label>
            <span>Số điện thoại</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="username"
              value={affiliateAuthDraft.phone}
              onChange={(event) => setAffiliateAuthDraft((current) => ({ ...current, phone: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>Mật khẩu</span>
            <input
              type="password"
              autoComplete="current-password"
              value={affiliateAuthDraft.password}
              onChange={(event) => setAffiliateAuthDraft((current) => ({ ...current, password: event.target.value }))}
              required
            />
          </label>
          {affiliateAuthError && <p className={styles.affiliateAuthError}>{affiliateAuthError}</p>}
          <button className={styles.primaryButton} type="submit" disabled={affiliateAuthBusy}>
            {affiliateAuthBusy ? "Đang đăng nhập…" : "Đăng nhập"} <ArrowRight size={16} />
          </button>
          <small>Quên mật khẩu thì liên hệ quản trị để được đặt lại. Hệ thống chưa có kênh xác minh số điện thoại nên không thể tự đặt lại.</small>
        </form>

        <button className={styles.affiliateJoinCta} type="button" onClick={openAffiliateApplication}>
          <span><UserPlus size={20} /></span>
          <div><strong>Chưa có tài khoản? Đăng ký Affiliate</strong><small>Nhận mã riêng sau khi được xác minh</small></div>
          <ChevronRight size={17} />
        </button>
        <div className={styles.policyNote}><CheckCircle2 size={18} /><p>Không thu phí tham gia, không thưởng tuyển người. Hoa hồng chỉ tính trên đơn thật đã giao và có thể kiểm tra đến từng bill.</p></div>
      </section>
    );
  }

  return (
    <section className={`${styles.tabPage} ${styles.affiliatePage}`}>
      <div className={styles.affiliateHero}>
        <div className={styles.affiliateHeroTop}>
          <span className={styles.affiliateIcon}><DollarSign size={25} /></span>
          <div>
            <p>AFFILIATE · DỮ LIỆU ĐƠN THẬT</p>
            <h1>Trung tâm Affiliate</h1>
          </div>
          <span className={styles.rateBadge}>{affiliateAccount?.status === "active" ? `${affiliateAccount.commissionBps / 100}%` : "6–10%"}</span>
        </div>
        <div className={styles.affiliateHeroSummary}>
          <span><TrendingUp size={14} /> {affiliateAccount?.displayName || affiliateSession.userName}</span>
          <button type="button" onClick={signOutAffiliate}><LogOut size={13} /> Đăng xuất</button>
        </div>
        <div className={styles.affiliateBalance}>
          <div>
            <small>SẴN SÀNG ĐỐI SOÁT</small>
            <strong>{money(affiliateAccount?.summary.availableAmount || 0)}</strong>
            <em>{affiliateAccount?.status === "active" ? `Mã ${affiliateAccount.code} · dữ liệu tự cập nhật` : affiliateAccount?.status === "pending" ? "Hồ sơ đang chờ Super Admin duyệt" : "Tài khoản chưa gắn hồ sơ cộng tác viên"}</em>
          </div>
          <button type="button" disabled>
            Tài chính đối soát <ArrowRight size={16} />
          </button>
        </div>
      </div>

      <div className={styles.affiliateTierGuide} aria-label="Các bậc Affiliate">
        <article>
          <span>CƠ BẢN</span><strong>6%</strong><small>Theo chính sách được duyệt</small>
        </article>
        <article className={affiliateAccount?.commissionBps === 800 ? styles.affiliateTierCurrent : ""}>
          <span>TIÊU CHUẨN</span><strong>8%</strong><small>Mức mặc định hiện tại</small>
        </article>
        <article className={affiliateAccount?.commissionBps === 1000 ? styles.affiliateTierCurrent : ""}>
          <span>CHIẾN DỊCH</span><strong>10%</strong><small>Theo thỏa thuận được duyệt</small>
        </article>
      </div>

      <div className={styles.affiliateStats}>
        <article><span>Doanh số ghi nhận</span><strong>{money(affiliateAccount?.summary.salesAmount || 0)}</strong><small>{affiliateAccount?.summary.orderCount || 0} đơn đúng mã</small></article>
        <article><span>Hoa hồng tổng</span><strong>{money(affiliateAccount?.summary.commissionAmount || 0)}</strong><small>{affiliateAccount?.commissionBps ? `Mức ${affiliateAccount.commissionBps / 100}%` : "Chờ duyệt mức"}</small></article>
        <article><span>Chờ đơn hoàn tất</span><strong>{money(affiliateAccount?.summary.pendingAmount || 0)}</strong><small>Chưa đủ điều kiện đối soát</small></article>
        <article><span>Đã thanh toán</span><strong>{money(affiliateAccount?.summary.paidAmount || 0)}</strong><small>Từ sổ đối soát hệ thống</small></article>
      </div>

      {affiliateAccount?.status === "active" && affiliateAccount.code ? <article className={styles.referralSpotlight}>
        <div className={styles.referralSpotlightHeading}>
          <span><Share2 size={23} /></span>
          <div><small>LINK AFFILIATE CỦA BẠN</small><h2>Chia sẻ ngay, nhận Affiliate</h2></div>
          <em>{affiliateAccount.code}</em>
        </div>
        <p>Mỗi khách mở link sẽ được ghi nhận đúng về bạn. Thu nhập tự động cập nhật sau khi đơn giao thành công.</p>
        <button className={styles.referralLink} type="button" onClick={copyReferralLink} aria-label="Sao chép link Affiliate">
          <span>{`daoche.app/order?ref=${affiliateAccount.code}`}</span><Copy size={16} />
        </button>
        <div className={styles.referralActions}>
          <button type="button" onClick={copyReferralLink}><Copy size={16} /> Sao chép</button>
          <button type="button" onClick={() => setShowAffiliateShare(true)}><Share2 size={17} /> Chia sẻ ngay</button>
        </div>
      </article> : <article className={styles.referralSpotlight}><div className={styles.referralSpotlightHeading}><span><ShieldCheck size={23} /></span><div><small>HỒ SƠ AFFILIATE</small><h2>{affiliateAccount?.status === "pending" ? "Đang chờ xác minh" : "Nhận mã giới thiệu riêng"}</h2></div></div><p>{affiliateAccount?.status === "pending" ? "Super Admin sẽ kiểm tra hồ sơ và cấp mã. Trang này tự cập nhật ngay sau khi được duyệt." : "Đăng ký một lần để được cấp mã riêng; hệ thống chỉ tính hoa hồng cho mã đang hoạt động."}</p>{!affiliateAccount && <button className={styles.primaryButton} type="button" onClick={openAffiliateApplication}>Đăng ký Affiliate <ArrowRight size={16} /></button>}</article>}

      <section className={styles.affiliateDashboard}>
        <div className={styles.affiliateDashboardHeading}>
          <div><small>BÁO CÁO THU NHẬP</small><h2>Cập nhật từ đơn hàng</h2></div>
          <button type="button" disabled><CalendarDays size={15} /> Thời gian thực</button>
        </div>
        <div className={styles.dashboardTotals}>
          <div><small>Doanh số phát sinh</small><strong>{money(affiliateAccount?.summary.salesAmount || 0)}</strong><em><TrendingUp size={13} /> {affiliateAccount?.summary.orderCount || 0} đơn</em></div>
          <div><small>Hoa hồng ghi nhận</small><strong>{money(affiliateAccount?.summary.commissionAmount || 0)}</strong><em>{affiliateAccount?.code || "Chưa có mã"}</em></div>
        </div>
      </section>

      <SectionTitle title="Hoa hồng gần đây" />
      <div className={styles.commissionList}>
        {(affiliateAccount?.recent || []).map((item) => (
          <div key={item.orderCode}>
            <span><WalletCards size={18} /></span>
            <div><strong>{item.orderCode}</strong><small>{money(item.salesAmount)} · {item.orderStatus === "delivered" ? "đã giao" : "đang xử lý"}</small></div>
            <b>+{money(item.commissionAmount)}</b><em>{item.commissionStatus === "paid" ? "Đã trả" : ["earned", "approved"].includes(item.commissionStatus) ? "Khả dụng" : "Chờ đối soát"}</em>
          </div>
        ))}
        {affiliateAccount?.recent.length === 0 && <div><span><ReceiptText size={18} /></span><div><strong>Chưa có đơn được ghi nhận</strong><small>Đơn qua đúng link sẽ xuất hiện tại đây.</small></div></div>}
      </div>

      {!affiliateAccount && <button className={styles.affiliateJoinCta} type="button" onClick={openAffiliateApplication}>
        <span><UserPlus size={20} /></span>
        <div><strong>Đăng ký Affiliate</strong><small>Nhận mã riêng sau khi được xác minh</small></div>
        <ChevronRight size={17} />
      </button>}
      <div className={styles.policyNote}><CheckCircle2 size={18} /><p>Không thu phí tham gia, không thưởng tuyển người. Hoa hồng chỉ tính trên đơn thật đã giao và có thể kiểm tra đến từng bill.</p></div>
    </section>
  );
}
