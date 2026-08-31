import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Group Analysis",
  description: "Run one analysis across several conversations at once.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
