import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Conversation",
    template: "%s · TRACE",
  },
  description: "One recorded conversation, with its thesis and ADHD Aid analyses.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
