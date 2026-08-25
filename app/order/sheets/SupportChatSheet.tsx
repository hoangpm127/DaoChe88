import { ChevronRight, MessageCircleMore, Plus, Send, Sparkles, Store, UsersRound, X } from "lucide-react";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import { ProductPhoto } from "../controller";
import type { OrderController } from "../controller";

type SupportChatSheetProps = { model: OrderController };

export default function SupportChatSheet({ model }: SupportChatSheetProps) {
  const { askChatTopic, chatContext, chatDraft, chatMessages, chatMode, goTo, openPartnerApplication, products, requestHumanSupport, sendChatMessage, setChatDraft, setChatMode, setShowChat, showChat, updateCart } = model;
  return (showChat && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowChat(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.chatSheet}`} role="dialog" aria-modal="true" aria-labelledby="chat-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.chatHeading}>
              <span className={styles.chatAgentIcon}><MessageCircleMore size={23} /></span>
              <div>
                <small>TƯ VẤN &amp; ĐẶT MÓN</small>
                <h2 id="chat-title">Chat cùng Đảo Chè</h2>
                <p><i /> {chatMode === "ai" ? "AI đang hỗ trợ ngay" : "Đã chuyển tới nhân viên"}</p>
              </div>
              <button type="button" aria-label="Đóng Chat" onClick={() => setShowChat(false)}><X size={20} /></button>
            </div>

            <div className={styles.chatModeBar}>
              <div><Sparkles size={16} /><span><strong>AI tư vấn 24/7</strong><small>Nhân viên trực 08:00–22:00</small></span></div>
              {chatMode === "ai" ? (
                <button type="button" onClick={requestHumanSupport}>Gặp nhân viên</button>
              ) : (
                <button type="button" onClick={() => setChatMode("ai")}>Quay lại AI</button>
              )}
            </div>

            <div className={styles.chatMessages} aria-live="polite">
              {chatMessages.map((message) => (
                <div className={message.sender === "user" ? styles.chatMessageUser : styles.chatMessageAssistant} key={message.id}>
                  {message.sender === "assistant" && <span><Sparkles size={14} /></span>}
                  <p>{message.text}</p>
                </div>
              ))}
            </div>

            {chatContext === "menu" && products[0] && (
              <div className={styles.chatCommerceCard}>
                <span className={styles.chatProductPhoto}><ProductPhoto index={products[0].image} imageUrl={products[0].imageUrl} /></span>
                <div><small>AI GỢI Ý DỄ ĂN</small><strong>{products[0].name}</strong><p>{products[0].note}</p><b>{money(products[0].price)}</b></div>
                <button type="button" onClick={() => updateCart(products[0].id, 1)}><Plus size={17} /> Thêm</button>
              </div>
            )}
            {chatContext === "group" && (
              <button className={styles.chatRouteCard} type="button" onClick={() => { setShowChat(false); goTo("group"); }}>
                <span><UsersRound size={21} /></span><div><small>ĐẶT ĐƠN CHO NHÓM</small><strong>Tạo phòng chọn món chung</strong><p>Tem theo tên, đúng người đúng món</p></div><ChevronRight size={18} />
              </button>
            )}
            {chatContext === "partner" && (
              <button className={`${styles.chatRouteCard} ${styles.chatPartnerCard}`} type="button" onClick={() => { setShowChat(false); openPartnerApplication("Sẵn sàng đầu tư"); }}>
                <span><Store size={21} /></span><div><small>MỞ RỘNG ĐIỂM BÁN</small><strong>Đăng ký trở thành đối tác</strong><p>Khảo sát vị trí và mô hình phù hợp</p></div><ChevronRight size={18} />
              </button>
            )}

            <div className={styles.chatQuickReplies}>
              <button type="button" onClick={() => askChatTopic("menu")}>Tư vấn món</button>
              <button type="button" onClick={() => askChatTopic("group")}>Đơn nhóm</button>
              <button type="button" onClick={() => askChatTopic("partner")}>Mở điểm bán</button>
            </div>
            <form className={styles.chatComposer} onSubmit={sendChatMessage}>
              <input value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="Hỏi món, giao hàng hoặc mở điểm bán..." aria-label="Nội dung Chat" />
              <button type="submit" aria-label="Gửi tin nhắn"><Send size={18} /></button>
            </form>
            <p className={styles.chatFinePrint}>AI có thể tư vấn và chuẩn bị giỏ món; đơn chỉ được gửi khi bạn xác nhận ở bước thanh toán.</p>
          </section>
        </div>
      ));
}
