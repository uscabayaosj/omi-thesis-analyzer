import type { Metadata, Viewport } from "next";
import { Barlow } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-barlow",
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
  themeColor: "#0b110e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${barlow.variable}`}>
      <head />
      <body className="text-slate-100 antialiased min-h-screen">
        <script
          type="application/x-direction-contract"
          data-seed="e0da3c73"
          dangerouslySetInnerHTML={{ __html: [
            "THESIS: The land itself as information design — every conversation is a survey point.",
            "OWN-WORLD: USGS topo survey palette — forest-dark ground, contour cream text, survey blue accent, Barlow headings, section grid.",
            "STORY: The researcher sees today's field notes as survey station entries. Analysis traces in like contour lines.",
            "FIRST VIEWPORT: Dark topo field. Survey designation heading. Daily Rollup primary. Numbered station entries.",
            "FORM: The Geological Survey Map, candidate 1 of 7, seed e0da3c73.",
            "FINISH: unreviewed and undocumented is unfinished.",
          ].join("\n") }}
        />
        <a
          href="#main"
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
