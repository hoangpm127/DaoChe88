import { Check, CheckCircle2, ChevronDown, ChevronRight, Crown, MapPin, MapPinned, MessageCircleMore, QrCode, Share2, ShieldCheck, UsersRound, Utensils } from "lucide-react";
import styles from "../customer.module.css";
import { groupProfileTypes } from "../data/content";
import { money } from "../lib/order-utils";
import type { OrderController } from "../controller";

type GroupTabProps = { model: OrderController };

export default function GroupTab({ model }: GroupTabProps) {
  const { products } = model;
  const { finalizeGroupRoom, groupChosenCount, groupCountdown, groupGuestName, groupGuestSubmitted, groupHasStarted, groupIsExpired, groupOrderedNames, groupPendingNames, groupProductId, groupProfilesLoading, groupRoom, groupRoster, groupSubmitting, joinCode, joinGroupRoom, openGroupProfileSetup, openGroupShare, savedGroupProfiles, setGroupGuestName, setGroupProductId, setGroupRoom, setJoinCode, startSavedGroupProfile, submitGroupChoice } = model;
  return (
    <section className={`${styles.tabPage} ${styles.groupHub}`}>
      <div className={styles.pageIntro}>
        <span className={styles.pageIcon}>
          <UsersRound size={25} />
        </span>
        <div>
          <p>NHÓM QUEN THUỘC · ĐẶT LẠI THẬT NHANH</p>
          <h1>Đặt đơn cho nhóm</h1>
          <span>Cài địa chỉ một lần; những lần sau chỉ cần chọn nhóm, chọn món và xác nhận bill.</span>
        </div>
      </div>
      {!groupRoom ? (
        <>
          <div className={styles.groupSectionHeading}>
            <div><small>NHÓM CỦA BẠN</small><h2>Chạm để chọn món ngay</h2></div>
            <span>{savedGroupProfiles.length} nhóm đã lưu</span>
          </div>
          {groupProfilesLoading ? (
            <div className={styles.groupLoadingCard}><span /><div><i /><i /></div></div>
          ) : savedGroupProfiles.length ? (
            <div className={styles.savedGroupList}>
              {savedGroupProfiles.map((profile) => {
                const type = groupProfileTypes.find((item) => item.id === profile.kind) || groupProfileTypes[1];
                const Icon = type.icon;
                return (
                  <article className={styles.savedGroupCard} key={profile.id}>
                    <span className={styles.savedGroupIcon}><Icon size={22} /></span>
                    <div>
                      <small>{type.title.toLocaleUpperCase("vi-VN")}</small>
                      <strong>{profile.name}</strong>
                      <p><MapPin size={13} /> {profile.address}</p>
                      <em>{profile.deliverySlot} · {profile.shippingMode === "pickup" ? "Tự đến lấy" : profile.payment}</em>
                    </div>
                    <div className={styles.savedGroupActions}>
                      <button type="button" onClick={() => startSavedGroupProfile(profile)}>Chọn món <ChevronRight size={15} /></button>
                      <button type="button" onClick={() => openGroupProfileSetup(profile.kind, profile)}>Sửa</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.groupEmptyState}>
              <span><MapPinned size={23} /></span>
              <div><strong>Chưa có nhóm mặc định</strong><small>Cài một lần ở bên dưới; từ lần sau nhóm sẽ tự hiện sẵn tại đây.</small></div>
            </div>
          )}

          <div className={styles.groupSectionHeading}>
            <div><small>CÀI MỘT LẦN · DÙNG NHIỀU LẦN</small><h2>Bạn sẽ đặt cho ai?</h2></div>
          </div>
          <div className={styles.groupTypeGrid}>
            {groupProfileTypes.map((type) => {
              const Icon = type.icon;
              return (
                <button type="button" key={type.id} onClick={() => openGroupProfileSetup(type.id)}>
                  <span><Icon size={22} /></span>
                  <div><strong>{type.shortTitle}</strong><small>{type.note}</small></div>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </div>

          <div className={styles.joinRoom}>
            <div>
              <strong>Đã có mã phòng?</strong>
              <small>Nhập mã đồng nghiệp gửi để chọn món cùng nhóm.</small>
            </div>
            <div>
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="VD: DC-7K9M2QX" aria-label="Mã phòng nhóm" />
              <button type="button" onClick={joinGroupRoom}>
                Tham gia
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className={`${styles.roomCard} ${groupRoom.role === "host" ? styles.roomHost : styles.roomGuest}`}>
          <div className={styles.groupRoomTop}>
            <div className={styles.groupRoomIdentity}>
              <div className={styles.roomSuccess}>
                {groupRoom.role === "host" ? <Crown size={16} /> : <UsersRound size={16} />}
                <span>{groupRoom.role === "host" ? "BẠN LÀ CHỦ NHÓM" : `PHÒNG ${groupRoom.code}`}</span>
              </div>
              <h2>{groupRoom.office}</h2>
              <p>Nhận lúc {groupRoom.slot} · tem theo tên</p>
            </div>
            <div className={`${styles.groupCountdown} ${groupIsExpired ? styles.groupCountdownExpired : ""}`}>
              <small>{groupIsExpired ? "ĐÃ KHÓA" : groupHasStarted ? "CÒN LẠI" : "CHỜ CHIA SẺ"}</small>
              <strong>{groupCountdown}</strong>
              <p>{groupIsExpired ? "Chờ chủ nhóm chốt" : groupHasStarted ? "5 phút chọn món" : "Bắt đầu khi chia sẻ"}</p>
            </div>
          </div>

          {groupRoom.role === "host" ? (
            <>
              <div className={styles.groupHostSummary}>
                <div><small>ĐÃ CHỌN</small><strong>{groupChosenCount}{groupRoster.length ? `/${groupRoster.length}` : ""} người</strong></div>
                <div><small>TẠM TÍNH</small><strong>{money(groupRoom.total)}</strong></div>
                <span><ShieldCheck size={16} /> Bạn chốt bill</span>
              </div>

              <div className={styles.groupHostTools}>
                <div className={styles.roomShare}>
                  <span><QrCode size={30} /></span>
                  <div><small>MÃ PHÒNG</small><strong>{groupRoom.code}</strong></div>
                  <button type="button" onClick={openGroupShare}><Share2 size={15} /> Chia sẻ</button>
                </div>
                {groupRoom.address && (
                  <div className={styles.activeGroupDelivery}>
                    <MapPin size={17} />
                    <div><small>{groupRoom.shippingMode === "pickup" ? "ĐIỂM NHẬN" : "GIAO TỚI"}</small><strong>{groupRoom.address}</strong></div>
                  </div>
                )}
              </div>

              <div className={styles.groupMemberOrders}>
                <div className={styles.groupMemberHeading}>
                  <div><small>TRẠNG THÁI THÀNH VIÊN</small><strong>{groupPendingNames.length ? `Còn ${groupPendingNames.length} người chưa chọn` : "Mọi người đã chọn xong"}</strong></div>
                  <b>{groupRoom.items.length} món</b>
                </div>
                {groupRoster.length ? (
                  <div className={styles.groupMemberList}>
                    {groupRoster.map((name, index) => {
                      const memberItems = groupRoom.items.filter((item) => item.guestName.trim().toLocaleLowerCase("vi-VN") === name.toLocaleLowerCase("vi-VN"));
                      const memberTotal = memberItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
                      return (
                        <article className={memberItems.length ? styles.groupMemberReady : styles.groupMemberPending} key={name}>
                          <span>{memberItems.length ? <Check size={14} /> : index + 1}</span>
                          <div><strong>{name}</strong><small>{memberItems.length ? memberItems.map((item) => item.productName).join(" · ") : "Chưa chọn món"}</small></div>
                          <b>{memberItems.length ? money(memberTotal) : "Chờ"}</b>
                        </article>
                      );
                    })}
                  </div>
                ) : groupRoom.items.length ? (
                  <div className={styles.groupMemberList}>
                    {groupRoom.items.map((item) => (
                      <article key={item.id}>
                        <span><Check size={14} /></span>
                        <div><strong>{item.guestName}</strong><small>{item.productName}</small></div>
                        <b>{money(item.price * item.quantity)}</b>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className={styles.groupWaiting}><UsersRound size={17} /> Chia sẻ link để mọi người chọn món.</p>
                )}
              </div>

              <div className={styles.groupHostActions}>
                <button className={`${styles.primaryButton} ${styles.groupSharePrimary}`} type="button" onClick={openGroupShare}>
                  <Share2 size={17} /> Chia sẻ link
                </button>
                <button className={`${styles.secondaryButton} ${styles.groupFinalizeButton}`} type="button" disabled={!groupRoom.items.length} onClick={finalizeGroupRoom}>
                  <ShieldCheck size={17} /> Chốt bill & tiếp tục
                </button>
              </div>
            </>
          ) : groupGuestSubmitted ? (
            <div className={styles.groupGuestComplete}>
              <span><CheckCircle2 size={25} /></span>
              <div><small>ĐÃ GỬI CHO CHỦ NHÓM</small><strong>{groupGuestName}, bạn chọn xong rồi!</strong><p>Chủ nhóm sẽ kiểm bill, đặt giao và thanh toán.</p></div>
            </div>
          ) : (
            <form className={styles.groupQuickOrder} onSubmit={submitGroupChoice}>
              <div className={styles.groupQuickHeading}>
                <span><Utensils size={18} /></span>
                <div><small>CHỈ 2 BƯỚC</small><strong>Chọn tên · Chọn món</strong></div>
              </div>
              <div className={styles.groupQuickFields}>
                <label>
                  <span>Bạn là ai?</span>
                  {groupRoster.length ? (
                    <select disabled={groupIsExpired || groupSubmitting} value={groupGuestName} onChange={(event) => setGroupGuestName(event.target.value)}>
                      <option value="">Chọn tên của bạn</option>
                      {groupRoster.map((name) => <option disabled={groupOrderedNames.has(name.toLocaleLowerCase("vi-VN"))} key={name} value={name}>{name}{groupOrderedNames.has(name.toLocaleLowerCase("vi-VN")) ? " · đã chọn" : ""}</option>)}
                    </select>
                  ) : (
                    <input disabled={groupIsExpired || groupSubmitting} value={groupGuestName} onChange={(event) => setGroupGuestName(event.target.value)} placeholder="Nhập tên của bạn" />
                  )}
                </label>
                <label>
                  <span>Món của bạn</span>
                  <select disabled={groupIsExpired || groupSubmitting} value={groupProductId} onChange={(event) => setGroupProductId(event.target.value)}>
                    {products.slice(0, 6).map((product) => <option key={product.id} value={product.id}>{product.name} · {money(product.price)}</option>)}
                  </select>
                </label>
              </div>
              <button type="submit" disabled={groupIsExpired || groupSubmitting || !groupGuestName}>
                {groupSubmitting ? "Đang gửi…" : groupIsExpired ? "Đã hết giờ chọn món" : "Tớ đã chọn xong"} <CheckCircle2 size={17} />
              </button>
            </form>
          )}
          <button className={styles.textButton} type="button" onClick={() => setGroupRoom(null)}>
            Rời phòng
          </button>
        </div>
      )}
      <details className={styles.groupGuide}>
        <summary>
          <span><MessageCircleMore size={18} /></span>
          <div><small>CÓ THỂ BẠN CHƯA BIẾT?</small><strong>Hướng dẫn cách sử dụng</strong></div>
          <ChevronDown size={17} />
        </summary>
        <div className={styles.howItWorks}>
          {[
            ["01", "Chủ nhóm chia sẻ link", "Đồng hồ 5 phút bắt đầu ngay khi mở phòng."],
            ["02", "Thành viên chọn tên & món", "Bấm “Tớ đã chọn xong” để gửi vào bill chung."],
            ["03", "Chủ nhóm chốt bill", "Kiểm người còn thiếu rồi chọn giao hàng và thanh toán."],
          ].map((item) => (
            <div key={item[0]}>
              <span>{item[0]}</span>
              <p><strong>{item[1]}</strong><small>{item[2]}</small></p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
