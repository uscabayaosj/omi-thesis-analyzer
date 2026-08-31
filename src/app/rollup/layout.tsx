import type { Metadata } from "next";

export const metadata: Metadata = {
  // An object, not a plain string: a bare `title` here becomes the closest
  // ancestor config for /rollup/week, which then has no template to inherit
  // and renders "This Week" with no product suffix. `default` names this
  // route; `template` keeps supplying the suffix to the nested one.
  title: {
    default: "Daily Rollup",
    template: "%s · TRACE",
  },
  description: "Close out the day: actions, commitments, open loops and tomorrow's prep.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
