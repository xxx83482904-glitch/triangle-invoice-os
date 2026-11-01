import type { Metadata, Viewport } from "next";
import { AkiraKitchen } from "./akira-kitchen";

export const metadata: Metadata = {
  title: "あきらくんと おりょうり",
  description: "にぎる・まぜる・つめる・かざる。あきらくんと遊ぶ、子どものための料理あそび。",
  robots: { index: false, follow: false },
  manifest: "/akira-kitchen/manifest.webmanifest",
  appleWebApp: { capable: true, title: "あきらとおりょうり", statusBarStyle: "default" },
  icons: { icon: "/akira-kitchen/icon.svg", apple: "/akira-kitchen/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#c5edfc" };

export default function AkiraKitchenPage() {
  return <AkiraKitchen />;
}
