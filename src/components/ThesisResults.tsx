import type { ComponentType } from "react";
import {
  ScrollIcon, HomeIcon, LinkIcon, MountainsIcon,
  TargetIcon, ScaleIcon, XCircleIcon, TrendingUpIcon,
} from "@/components/icons";

export interface Analysis {
  rq1_documentary_record: string;
  rq2_everyday_practices: string;
  rq3_cskt_intersection: string;
  rq4_wildness_imaginary: string;
  conditions_check: string;
  rival_hypothesis_test: string;
  refutation_signals: string;
  forward_thinking: string;
}

function AnalysisSection({
  icon: Icon, title, subtitle, content,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  content: string;
}) {
  return (
    <div className="card p-6">
      <div className="analysis-section">
        <h3 className="flex items-center gap-2">
          <Icon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
          {title}
        </h3>
        <p className="text-xs text-slate-400 mb-3">{subtitle}</p>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
      </div>
    </div>
  );
}

export function ThesisResults({ analysis, animate = true }: { analysis: Analysis; animate?: boolean }) {
  const dim = (text: string | undefined) =>
    text && text.trim() ? text : "No content was recorded for this dimension. Re-run the analysis to fill it in.";

  const sections = [
    { icon: ScrollIcon, title: "RQ1 — Documentary Record", subtitle: "Historical-legal constitution of authority: patents, water rights, allotments, grazing permits", content: dim(analysis.rq1_documentary_record) },
    { icon: HomeIcon, title: "RQ2 — Everyday Practices", subtitle: "Kinship, inheritance, branding, boundary-maintenance, conflict — how authority is produced daily", content: dim(analysis.rq2_everyday_practices) },
    { icon: LinkIcon, title: "RQ3 — CSKT Intersection", subtitle: "How ranching authority intersects with, depends on, and is contested by CSKT sovereignty", content: dim(analysis.rq3_cskt_intersection) },
    { icon: MountainsIcon, title: "RQ4 — Wildness Imaginary", subtitle: "Frontier mythology as double-erasure instrument (4A: Indigenous erasure, 4B: federal erasure)", content: dim(analysis.rq4_wildness_imaginary) },
    { icon: TargetIcon, title: "Orienting Conditions", subtitle: "Which of the five conditions are evidenced in this conversation?", content: dim(analysis.conditions_check) },
    { icon: ScaleIcon, title: "Rival Hypothesis Test", subtitle: "Is frontier framing public/strategic or intimate? Felt subjectivity or instrumental rhetoric?", content: dim(analysis.rival_hypothesis_test) },
    { icon: XCircleIcon, title: "Refutation Signals", subtitle: "Does anything challenge or complicate the pioneer sovereignty concept?", content: dim(analysis.refutation_signals) },
    { icon: TrendingUpIcon, title: "Forward Thinking", subtitle: "Research directions, questions to pursue, connections to other data", content: dim(analysis.forward_thinking) },
  ];

  return (
    <div className={`${animate ? "stagger-in" : ""} space-y-6`}>
      {sections.map((section) => (
        <AnalysisSection key={section.title} {...section} />
      ))}
    </div>
  );
}
