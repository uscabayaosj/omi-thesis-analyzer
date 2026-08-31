import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Open Promises",
  description: "Every commitment still open, across every conversation, oldest first.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
