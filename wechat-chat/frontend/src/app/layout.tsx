import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "こもれび — あなたの会話を、ひとつに。",
  description: "個人用WeChatローカルチャット。会話はこのPCに保存されます。",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "こもれび" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f5f6f3" };

export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="ja" suppressHydrationWarning><body>{children}</body></html>;
}
