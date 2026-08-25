import type { Metadata, Viewport } from "next";
import PortalPwaBridge from "./PortalPwaBridge";

export const metadata: Metadata = {
  title: "Không gian vận hành | Đảo Chè OS",
  description: "Sáu không gian làm việc và phân quyền theo vai trò của nền tảng Đảo Chè.",
  applicationName: "Đảo Chè OS",
  manifest: "/portal.webmanifest?v=1",
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
    title: "Đảo Chè OS",
  },
};

export const viewport: Viewport = {
  themeColor: "#153f2f",
  colorScheme: "light",
};

export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}<PortalPwaBridge /></>;
}
