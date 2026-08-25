import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Đặt món | Đảo Chè",
  description: "Chè bưởi, khúc bạch, sầu riêng, khoai dẻo và combo văn phòng — ốc đảo tráng miệng giao tận nơi.",
  applicationName: "Đảo Chè",
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
    title: "Đảo Chè",
  },
};

export const viewport: Viewport = {
  themeColor: "#168d34",
  colorScheme: "light",
};

export default function OrderLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
