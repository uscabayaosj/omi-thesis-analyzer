import type { Metadata, Viewport } from "next";
import { Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Journal serif for headings and datelines — self-hosted by next/font, so it
// stays available offline in the installed PWA.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
});
import ServiceWorkerRegistration from "@/components/sw-register";
import AppVersion from "@/components/app-version";
import AppBadgeSync from "@/components/app-badge-sync";
import GlobalShortcuts from "@/components/shortcuts";
import UndoProvider from "@/components/UndoProvider";

export const metadata: Metadata = {
  // `template` lets each route name itself while keeping the product name in
  // the tab. Every route previously shipped this exact string, so tabs, back
  // history and bookmarks were indistinguishable across the whole app.
  title: {
    default: "TRACE — Personal & Research Assistant",
    template: "%s · TRACE",
  },
  description:
    "Turns conversations captured by a wearable pendant into thesis evidence and daily executive-function structure.",
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
  themeColor: "#161311",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${sourceSerif.variable}`}>
      <head />
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen">
        {/* Bypass block (WCAG 2.4.1). Every route repeats a back link, an
            eyebrow, a title, a subtitle and a nav row before its content, and
            a keyboard user had to tab through all of it on every navigation. */}
        <a
          href="#main"
          // slate-950 (#14100d) on cyan-400 (copper #d99a5e) = 7.87:1 — the same
          // near-black-on-copper pair every primary uses, not washed-out gray.
          className="sr-only focus:not-sr-only focus:fixed focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:min-h-[44px] focus:inline-flex focus:items-center focus:rounded-lg focus:bg-cyan-400 focus:text-slate-950 focus:font-medium" // impeccable-disable-line gray-on-color
        >
          Skip to content
        </a>
        <ServiceWorkerRegistration />
        <AppBadgeSync />
        <GlobalShortcuts />
        <UndoProvider>
          {children}
          <AppVersion />
        </UndoProvider>
      </body>
    </html>
  );
}
