import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How this works",
  description: "What each part of TRACE does, and what happens to your data.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
