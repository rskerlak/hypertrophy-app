import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/AppProviders";
import { BottomNav } from "@/components/BottomNav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Next aplica basePath a `manifest` automáticamente, pero NO a `icons`: los
// prefijamos a mano para que resuelvan bien también en GitHub Pages (subruta).
const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "MyoNoesis",
  description: "Mesociclos de hipertrofia basados en evidencia. Motor determinista y transparente.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "MyoNoesis" },
  icons: {
    icon: [
      { url: `${bp}/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${bp}/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: `${bp}/apple-icon.png`, sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f6f3",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Aplica el tema guardado ANTES del primer pintado para evitar el flash.
// localStorage es solo caché de UI; la fuente de verdad vive en settings (Dexie).
const themeInit = `(function(){try{var t=localStorage.getItem("mn-theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppProviders>
          <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-28 pt-6">
            <div className="flex-1">{children}</div>
            <footer className="mt-10 pb-2 text-center text-[11px] tracking-wide text-[var(--muted)]/60">
              Idea y desarrollo de Rodrigo Skerlak
            </footer>
          </main>
          <BottomNav />
        </AppProviders>
      </body>
    </html>
  );
}
