import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Đảo Chè — Đặt món & vận hành";
const description = "Một nền tảng cho khách hàng, đối tác và đội ngũ Đảo Chè với sáu không gian làm việc theo vai trò.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title,
    description,
    applicationName: "Đảo Chè OS",
    formatDetection: { telephone: false },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "vi_VN",
      images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "Đảo Chè — 6 không gian, 17 vai trò" }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og-v2.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
