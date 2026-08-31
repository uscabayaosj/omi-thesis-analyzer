import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Daily Rollup",
  description: "Close out the day: actions, commitments, open loops and tomorrow's prep.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
