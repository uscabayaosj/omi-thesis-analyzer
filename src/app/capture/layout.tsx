import type { Metadata } from "next";

// Every other route sets its own title through a layout like this one; /capture
// was the only one that didn't, so it fell back to the app default and was
// indistinguishable from any other tab.
export const metadata: Metadata = {
  title: "Capture",
  description: "What the pendant is recording, and what has been transcribed.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
