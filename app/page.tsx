import { ArrowRight, ShieldCheck, ShoppingBag, UsersRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import styles from "./gateway.module.css";

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.brand}>
          <Image src="/pwa-icon-192.png" width={46} height={46} alt="Biểu trưng Tào Phớ 88" priority unoptimized />
          <span><strong>Tào Phớ 88</strong><small>MỘT NỀN TẢNG · ĐÚNG KHÔNG GIAN</small></span>
        </header>

        <div className={styles.hero}>
          <span className={styles.eyebrow}><ShieldCheck size={17} /> Dữ liệu dùng chung · quyền theo vai trò</span>
          <h1>Bạn đến để đặt món<br />hay để vận hành?</h1>
          <p>Khách hàng có một hành trình thật nhanh. Đội ngũ và đối tác làm việc trong sáu không gian, mỗi người chỉ thấy đúng phần mình phụ trách.</p>
        </div>

        <div className={styles.choices}>
          <Link className={styles.customer} href="/order">
            <span><ShoppingBag size={27} /></span>
            <div><small>KHÁCH HÀNG & CỘNG ĐỒNG</small><strong>Đặt món Tào Phớ 88</strong><p>Thực đơn, đơn nhóm, ưu đãi, đơn hàng và Affiliate cá nhân.</p></div>
            <em>Vào đặt món <ArrowRight size={18} /></em>
          </Link>
          <Link className={styles.operations} href="/portal">
            <span><UsersRound size={27} /></span>
            <div><small>ĐỐI TÁC & ĐỘI NGŨ</small><strong>Không gian vận hành</strong><p>6 workspace dùng chung cho đủ 17 vai trò, có phiên riêng trên từng thiết bị.</p></div>
            <em>Chọn vai trò <ArrowRight size={18} /></em>
          </Link>
        </div>

        <footer><span>17 vai trò</span><i /> <span>6 không gian</span><i /> <span>1 nguồn dữ liệu</span></footer>
      </section>
    </main>
  );
}
