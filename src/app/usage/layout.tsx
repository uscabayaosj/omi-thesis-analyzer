import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Usage",
  description: "API calls and cost for the current month.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
