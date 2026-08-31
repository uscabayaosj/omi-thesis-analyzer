import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "This Week",
  description: "Synthesize the week's daily rollups into one view.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
