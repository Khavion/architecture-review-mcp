// Free versus keyed output. A review is always computed in full on the local
// machine; this module decides how much of it to show.
//
//   no key, or a key that cannot be used:  the top 3 findings by severity, counts
//                                          for the rest, and the free-tier notice
//   valid key:                             every finding, the quote total, the
//                                          recommended next step, and a report link
//
// The key is a soft gate (the rule set ships in the package, like it does in the
// website's browser bundle). It exists to tie a report link to a work email.

import type { Severity } from "@/data/reviewer/types";
import { formatUsd } from "@/lib/reviewer/pricing";

import { requestReportLink, resolveAccess, verifyKey, type AccessOptions } from "./api";
import { ESTIMATE_DISCLAIMER, FREE_FINDING_LIMIT, FREE_NOTICE } from "./constants";
import type { RecognizedService, ReviewFinding, ReviewResult } from "./review";

const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export type PriceLine = { cents: number; label: string; text: string };

export type NextStepLine = { name: string; priceLabel: string; rationale: string; text: string };

export type GatedReview = {
  tier: "free" | "keyed";
  /** one sentence, set when a key was supplied but could not be used */
  fallbackReason: string | null;
  /** the free-tier notice; null on the keyed tier */
  notice: string | null;
  source: "iac" | "stack";
  files: string[];
  skippedFiles: string[];
  unrecognized: string[];
  services: RecognizedService[];
  coverageNotes: string[];
  score: number;
  bySeverity: Record<Severity, number>;
  findingsCount: number;
  /** the findings shown: three on the free tier, all of them on the keyed tier */
  findings: ReviewFinding[];
  hiddenCount: number;
  hiddenBySeverity: Record<Severity, number>;
  /** keyed tier only. The text ends with the estimate sentence. */
  quote: PriceLine | null;
  /** keyed tier only. The text ends with the estimate sentence. */
  nextStep: NextStepLine | null;
  /** keyed tier only, when Khavion returned a link */
  reportUrl: string | null;
  /** keyed tier only: one sentence when no link could be had */
  reportNote: string | null;
};

function emptyCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function countBySeverity(findings: readonly ReviewFinding[]): Record<Severity, number> {
  const counts = emptyCounts();
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function baseOf(result: ReviewResult) {
  return {
    source: result.source,
    files: result.files,
    skippedFiles: result.skippedFiles,
    unrecognized: result.unrecognized,
    services: result.services,
    coverageNotes: result.coverageNotes,
    score: result.score,
    bySeverity: result.bySeverity,
    findingsCount: result.findingsCount,
  };
}

/** The free view of a review: the top findings, counts for the rest, no money, no link. */
export function freeView(result: ReviewResult, fallbackReason: string | null = null): GatedReview {
  const shown = result.findings.slice(0, FREE_FINDING_LIMIT);
  const hidden = result.findings.slice(FREE_FINDING_LIMIT);
  return {
    tier: "free",
    fallbackReason,
    notice: FREE_NOTICE,
    ...baseOf(result),
    findings: shown,
    hiddenCount: hidden.length,
    hiddenBySeverity: countBySeverity(hidden),
    quote: null,
    nextStep: null,
    reportUrl: null,
    reportNote: null,
  };
}

/** Review output for a key: every finding, the quote total, the next step. The link is added by the caller. */
function keyedView(result: ReviewResult): GatedReview {
  const total = result.quoteTotalCents;
  const label = formatUsd(total);
  const offer = result.recommendedOffer;
  return {
    tier: "keyed",
    fallbackReason: null,
    notice: null,
    ...baseOf(result),
    findings: result.findings,
    hiddenCount: 0,
    hiddenBySeverity: emptyCounts(),
    quote: {
      cents: total,
      label,
      text: `Quote total: ${label} for ${result.findingsCount} ${result.findingsCount === 1 ? "finding" : "findings"}. ${ESTIMATE_DISCLAIMER}`,
    },
    nextStep: offer
      ? {
          name: offer.name,
          priceLabel: offer.priceLabel,
          rationale: offer.rationale,
          text: `Recommended next step: ${offer.name}, ${offer.priceLabel}. ${ESTIMATE_DISCLAIMER}`,
        }
      : null,
    reportUrl: null,
    reportNote: null,
  };
}

/**
 * Apply the free or keyed view to a finished review. With a key (the `key`
 * option or KHAVION_API_KEY), Khavion is asked whether it is valid. If it is,
 * the output is complete and a report link is requested with the rule ids
 * (nothing else leaves the machine). If the check fails for any reason the
 * output falls back to the free view with a one-sentence reason. Never throws.
 */
export async function gateReview(result: ReviewResult, options: AccessOptions = {}): Promise<GatedReview> {
  const access = resolveAccess(options);
  if (!access.key) return freeView(result);
  if (!access.baseUrl) {
    return freeView(result, "The Khavion address is not usable (it must be https), so this is the free output.");
  }
  const check = await verifyKey(access);
  if (check === "unreachable") {
    return freeView(result, "Khavion could not be reached to check the key, so this is the free output.");
  }
  if (check === "invalid") {
    return freeView(result, "The key was not accepted, so this is the free output.");
  }
  const keyed = keyedView(result);
  if (result.ruleIds.length === 0) {
    return { ...keyed, reportNote: "There are no findings, so there is no report link." };
  }
  const url = await requestReportLink(access, result.ruleIds, result.serviceCount);
  return url
    ? { ...keyed, reportUrl: url }
    : { ...keyed, reportNote: "A report link could not be created right now; the findings above are complete." };
}

/** True when any finding is at or above the level. Counts come from the full review, free tier included. */
export function exceedsLevel(bySeverity: Record<Severity, number>, level: "high" | "critical"): boolean {
  const at = level === "critical" ? SEVERITIES.slice(0, 1) : SEVERITIES.slice(0, 2);
  return at.some((severity) => bySeverity[severity] > 0);
}
