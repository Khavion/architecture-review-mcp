// The local review. Pure and offline: it turns infrastructure-as-code text, or a
// list of services, into a report with the SAME engine the website runs
// (lib/reviewer/engine.ts), in engineering mode with the website's default
// workload answers. No model, no network, no clock: the same input always gives
// the same output.

import { tokenById } from "@/data/reviewer/tokens";
import type { Pillar, Provider, Severity } from "@/data/reviewer/types";
import { detectTokensFromText } from "@/lib/reviewer/detect";
import { extractIacText, extractIacTokenIds, looksLikeIacSource } from "@/lib/reviewer/diagram-parse";
import { assembleReport } from "@/lib/reviewer/engine";
import { PROVIDER_LABEL } from "@/lib/reviewer/labels";
import { ruleHash } from "@/lib/reviewer/rebuild";
import type { Report, ReviewPurpose } from "@/lib/reviewer/report";

import { resolveServiceTokens } from "./citations";

export type IacFile = { path: string; content: string };

export type ReviewOptions = {
  /** the visitor's own words about the workload; only used by the engine's keyword rules */
  intent?: string;
  /** a production workload; the website's default is false */
  production?: boolean;
  /** what the workload is for; the website's default is "general" */
  purpose?: ReviewPurpose;
};

export type ReviewFinding = {
  ruleId: string;
  /** the 8-hex id used in report links */
  ruleHash: string;
  provider: Provider;
  providerLabel: string;
  pillar: Pillar;
  severity: Severity;
  bpId: string | null;
  title: string;
  /** why it matters, in Khavion's words */
  why: string;
  /** how to fix and verify it, in Khavion's words */
  recommendation: string;
  /** what in the input put the rule in play */
  evidence: string[];
  /** the verbatim quote from the provider's documentation */
  quote: string;
  /** the page the quote was copied from */
  docUrl: string;
  effortHours: number;
  costCents: number;
};

export type ReviewOffer = {
  key: string;
  name: string;
  priceLabel: string;
  rationale: string;
  recommended: boolean;
};

export type RecognizedService = { id: string; label: string; provider: Provider };

export type ReviewResult = {
  mode: "engineering";
  source: "iac" | "stack";
  /** IaC files that were read */
  files: string[];
  /** files given that do not look like infrastructure-as-code */
  skippedFiles: string[];
  /** stack inputs that matched no known service */
  unrecognized: string[];
  services: RecognizedService[];
  /** every finding, most severe first */
  findings: ReviewFinding[];
  bySeverity: Record<Severity, number>;
  findingsCount: number;
  /** the itemized estimate, in cents */
  quoteTotalCents: number;
  /** 0 to 100 */
  score: number;
  offers: ReviewOffer[];
  recommendedOffer: ReviewOffer | null;
  ruleIds: string[];
  /** how many services were in view; the score is scaled to it and a report link carries it */
  serviceCount: number;
  coverageNotes: string[];
};

/** The most code text the red-flag patterns scan in one review. */
const MAX_PATTERN_TEXT = 2_000_000;

// A fixed timestamp keeps the function pure; the report time is never shown.
const FIXED_NOW = "1970-01-01T00:00:00.000Z";

// The engine words its evidence for the website's form ("what you told us").
// These packages read code or a list, so say that instead. Citations are never
// touched.
const EVIDENCE_WORDING: Record<ReviewResult["source"], Record<string, string>> = {
  iac: { "Mentioned in what you told us": "A pattern this rule checks for appears in the infrastructure code" },
  stack: { "Mentioned in what you told us": "Mentioned in the description you gave" },
};

function fromReport(
  report: Report,
  base: Pick<ReviewResult, "source" | "files" | "skippedFiles" | "unrecognized">,
): ReviewResult {
  const wording = EVIDENCE_WORDING[base.source];
  const findings: ReviewFinding[] = report.findings.map((f) => ({
    ruleId: f.ruleId,
    ruleHash: ruleHash(f.ruleId),
    provider: f.provider,
    providerLabel: PROVIDER_LABEL[f.provider],
    pillar: f.pillar,
    severity: f.severity,
    bpId: f.bpId,
    title: f.title,
    why: f.why,
    recommendation: f.recommendation,
    evidence: f.evidence.map((line) => wording[line] ?? line),
    quote: f.citation.quote, // verbatim from the verified KB row
    docUrl: f.citation.doc_url,
    effortHours: f.effortHours,
    costCents: f.costCents,
  }));
  const offers: ReviewOffer[] = (report.offers ?? []).map((o) => ({
    key: o.key,
    name: o.name,
    priceLabel: o.priceLabel,
    rationale: o.rationale,
    recommended: o.recommended,
  }));
  const tokenIds = [...new Set([...report.declared, ...report.detected])];
  const services: RecognizedService[] = tokenIds.flatMap((id) => {
    const token = tokenById(id);
    return token ? [{ id, label: token.label, provider: token.provider }] : [];
  });
  return {
    mode: "engineering",
    ...base,
    services,
    findings,
    bySeverity: report.bySeverity,
    findingsCount: findings.length,
    quoteTotalCents: report.totals.estimateTotalCents,
    score: report.score,
    offers,
    recommendedOffer: offers.find((o) => o.recommended) ?? null,
    ruleIds: findings.map((f) => f.ruleId),
    serviceCount: report.context?.serviceCount ?? 0,
    coverageNotes: report.coverageNotes,
  };
}

function contextFrom(options: ReviewOptions) {
  return {
    mode: "engineering" as const,
    production: Boolean(options.production),
    purpose: options.purpose ?? "general",
  };
}

/**
 * Review infrastructure-as-code: Terraform, CloudFormation, or Kubernetes text.
 * Services come from the exact resource-type map; the same text also feeds the
 * engine's red-flag patterns (for example an open 0.0.0.0/0 rule), exactly as
 * the website does when a visitor adds an IaC file. Files that do not look like
 * IaC are listed in skippedFiles and otherwise ignored.
 */
export function reviewIac(files: readonly IacFile[], options: ReviewOptions = {}): ReviewResult {
  const read: IacFile[] = [];
  const skippedFiles: string[] = [];
  for (const file of files) {
    if (looksLikeIacSource(file.path, file.content)) read.push(file);
    else skippedFiles.push(file.path);
  }
  const exact = [...new Set(read.flatMap((file) => extractIacTokenIds(file.content)))];
  // Each file is already bounded by extractIacText; bound the whole as well.
  const iacText = read
    .map((file) => extractIacText(file.content))
    .join("\n")
    .slice(0, MAX_PATTERN_TEXT);
  const detected = detectTokensFromText(iacText).filter((id) => !exact.includes(id));
  const report = assembleReport({
    declared: exact,
    detected,
    intent: options.intent ?? "",
    ocrText: iacText,
    now: FIXED_NOW,
    partialInput: true,
    context: contextFrom(options),
  });
  return fromReport(report, {
    source: "iac",
    files: read.map((file) => file.path),
    skippedFiles,
    unrecognized: [],
  });
}

export type StackInput = ReviewOptions & {
  /** service ids ("s3", "rds") or names ("Amazon S3", "key vault") */
  tokens: readonly string[];
};

/** Review a list of services, with an optional sentence about the workload. */
export function reviewStack(input: StackInput): ReviewResult {
  const ids = new Set<string>();
  const unrecognized: string[] = [];
  for (const raw of input.tokens) {
    const matches = resolveServiceTokens(raw);
    if (matches.length) for (const match of matches) ids.add(match.id);
    else if (raw.trim()) unrecognized.push(raw.trim());
  }
  const report = assembleReport({
    declared: [...ids],
    detected: [],
    intent: input.intent ?? "",
    now: FIXED_NOW,
    context: contextFrom(input),
  });
  return fromReport(report, { source: "stack", files: [], skippedFiles: [], unrecognized });
}
