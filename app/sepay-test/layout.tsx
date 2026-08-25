import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Kiểm thử SePay 2.000đ | Tào Phớ 88",
  description: "Trang kiểm thử giao dịch TPBank, webhook SePay và đối soát tự động của Tào Phớ 88.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#146b3a",
  colorScheme: "light",
};

export default function SePayTestLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
