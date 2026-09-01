import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Place",
    template: "%s · TRACE",
  },
  description: "A named place and the meetings that happened there.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
