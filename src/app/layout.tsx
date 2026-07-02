import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/AppProviders";
import { BottomNav } from "@/components/BottomNav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hipertrofia",
  description: "App personal de mesociclos de hipertrofia basada en evidencia.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Hipertrofia" },
};

export const viewport: Viewport = {
  themeColor: "#0b0c10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppProviders>
          <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-24 pt-6">{children}</main>
          <BottomNav />
        </AppProviders>
      </body>
    </html>
  );
}
