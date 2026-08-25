import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Đặt món | Tào Phớ 88",
  description: "Đặt món ngọt Việt, đơn nhóm văn phòng và gói tháng trực tiếp từ Tào Phớ 88.",
  applicationName: "Tào Phớ 88",
  manifest: "/manifest.webmanifest?v=4",
  icons: {
    icon: [
      { url: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tào Phớ 88",
  },
};

export const viewport: Viewport = {
  themeColor: "#168d34",
  colorScheme: "light",
};

export default function OrderLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
