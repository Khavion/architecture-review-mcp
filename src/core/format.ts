// Plain-text rendering shared by the MCP server and the CLI. Every price line
// ends with the estimate sentence; quotes are printed exactly as the KB has them.

import type { Severity } from "@/data/reviewer/types";
import { PILLAR_LABEL, SEVERITY_LABEL } from "@/lib/reviewer/labels";

import type { CitationHit, ExplainedFinding, ResolvedService } from "./citations";
import type { GatedReview } from "./gate";
import type { ReviewFinding } from "./review";

const ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

/** "1 critical, 2 high" for the non-zero levels, or "none". */
export function describeCounts(counts: Record<Severity, number>): string {
  const parts = ORDER.filter((severity) => counts[severity] > 0).map((severity) => `${counts[severity]} ${severity}`);
  return parts.length ? parts.join(", ") : "none";
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function hoursText(hours: number): string {
  if (hours <= 0) return "no work needed";
  return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function findingBlock(finding: ReviewFinding, index: number, keyed: boolean): string[] {
  const lines = [
    `${index}. [${SEVERITY_LABEL[finding.severity].toUpperCase()}] ${finding.title}`,
    `   ${PILLAR_LABEL[finding.pillar]}, ${finding.providerLabel}. Rule ${finding.ruleId} (report id ${finding.ruleHash}).`,
  ];
  if (finding.evidence.length) lines.push(`   Found: ${finding.evidence.join("; ")}`);
  lines.push(`   Why it matters: ${finding.why}`);
  lines.push(`   Fix: ${finding.recommendation}`);
  if (keyed) lines.push(`   Effort: ${hoursText(finding.effortHours)}.`);
  lines.push(`   Source: "${finding.quote}"`);
  lines.push(`   Link: ${finding.docUrl}`);
  return lines;
}

/** The review as plain text. */
export function formatReviewText(review: GatedReview): string {
  const lines: string[] = ["Khavion architecture review"];
  if (review.source === "iac") {
    lines.push(
      `Files reviewed: ${review.files.length}. Services recognized: ${
        review.services.length ? review.services.map((s) => s.label).join(", ") : "none"
      }.`,
    );
    if (review.skippedFiles.length) {
      lines.push(`Skipped: ${review.skippedFiles.join(", ")}.`);
    }
  } else {
    lines.push(
      `Services recognized: ${review.services.length ? review.services.map((s) => s.label).join(", ") : "none"}.`,
    );
    if (review.unrecognized.length) lines.push(`Not recognized: ${review.unrecognized.join(", ")}.`);
  }
  lines.push(
    `Posture score: ${review.score} of 100. ${plural(review.findingsCount, "finding", "findings")}: ${describeCounts(review.bySeverity)}.`,
  );
  for (const note of review.coverageNotes) lines.push(`Note: ${note}`);

  if (review.findings.length === 0) {
    lines.push("", "No findings for the services recognized.");
  }
  review.findings.forEach((finding, i) => {
    lines.push("", ...findingBlock(finding, i + 1, review.tier === "keyed"));
  });

  if (review.hiddenCount > 0) {
    lines.push(
      "",
      `Not shown: ${plural(review.hiddenCount, "more finding", "more findings")} (${describeCounts(review.hiddenBySeverity)}).`,
    );
  }
  if (review.quote) lines.push("", review.quote.text);
  if (review.nextStep) {
    lines.push(review.nextStep.text, `Why: ${review.nextStep.rationale}`);
  }
  if (review.reportUrl) lines.push(`Report: ${review.reportUrl}`);
  if (review.reportNote) lines.push(review.reportNote);
  if (review.fallbackReason) lines.push("", review.fallbackReason);
  if (review.notice) lines.push("", review.notice);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Citation hits as plain text. */
export function formatCitationsText(hits: readonly CitationHit[], matched: readonly ResolvedService[]): string {
  if (!hits.length) {
    return matched.length
      ? `No cited rule matches ${matched.map((m) => m.label).join(", ")} with those filters.`
      : "No known service matches that name. Try a service such as S3, RDS, Lambda, Key Vault, or Cloud Run.";
  }
  const lines: string[] = [
    `${plural(hits.length, "cited rule", "cited rules")} for ${matched.map((m) => m.label).join(", ")}:`,
  ];
  hits.forEach((hit, i) => {
    lines.push(
      "",
      `${i + 1}. ${hit.title} (${PILLAR_LABEL[hit.pillar]}, ${SEVERITY_LABEL[hit.severity]})`,
      `   Rule: ${hit.ruleId}`,
      `   Quote: "${hit.quote}"`,
      `   Source: ${hit.docUrl}`,
      `   License: ${hit.license}`,
    );
  });
  return lines.join("\n");
}

/** One explained finding as plain text. */
export function formatExplainText(finding: ExplainedFinding): string {
  const lines = [
    `${finding.title} [${SEVERITY_LABEL[finding.severity]}]`,
    `${PILLAR_LABEL[finding.pillar]}. Rule ${finding.ruleId} (report id ${finding.ruleHash})${finding.bpId ? `. Best practice ${finding.bpId}` : ""}.`,
    "",
    `Why it matters: ${finding.whyItMatters}`,
    `Fix: ${finding.fix}`,
    "",
    `Source: "${finding.citation.quote}"`,
    `Link: ${finding.citation.docUrl}`,
    `License: ${finding.citation.license}`,
  ];
  for (const extra of finding.alsoCite) {
    lines.push("", `Also: "${extra.quote}"`, `Link: ${extra.docUrl}`);
  }
  return lines.join("\n");
}
