import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "People",
  description: "Everyone who appears in your recorded conversations.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
