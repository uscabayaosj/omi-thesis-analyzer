import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search",
  description: "Search across thesis and group analyses.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
