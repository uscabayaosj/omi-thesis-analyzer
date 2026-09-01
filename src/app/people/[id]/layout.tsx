import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Person",
    template: "%s · TRACE",
  },
  description: "Everything recorded about one person.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
