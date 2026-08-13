import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistration from "@/components/sw-register";
import AppVersion from "@/components/app-version";

export const metadata: Metadata = {
  title: "TRACE — Personal & Research Assistant",
  description:
    "Turns Omi wearable conversations into thesis evidence and daily executive-function structure.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TRACE",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#13294b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head />
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen">
        <ServiceWorkerRegistration />
        {children}
        <AppVersion />
      </body>
    </html>
  );
}
