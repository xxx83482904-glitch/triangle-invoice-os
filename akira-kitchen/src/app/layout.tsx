import "./globals.css";
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja" suppressHydrationWarning><head>
    {/* Size the static first paint before the React bundle hydrates. Only this
        known CSS variable differs from server HTML; ResizeObserver takes over. */}
    <script dangerouslySetInnerHTML={{__html:'document.documentElement.style.setProperty("--akira-stage-scale",String(Math.min(innerWidth,innerHeight*4/3)/1448))'}} />
  </head><body>{children}</body></html>;
}
