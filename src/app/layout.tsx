import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/app/toaster";
import { ThemeProvider, themeInitScript } from "@/components/app/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { sidebarInitScript } from "@/lib/sidebar-preference";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/noto-sans-jp/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRIANGLE Invoice OS",
  description: "案件ごとの請求・入金・支払いを一元管理するInvoice OS",
};

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
