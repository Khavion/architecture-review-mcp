// Citation lookup and finding explanations. Pure and offline: both read the
// verified knowledge base that ships with the package and copy the quotes
// VERBATIM. Nothing here can write or invent a citation.

import { ACTIVE_RULES } from "@/data/reviewer/rules";
import { SERVICE_TOKENS, allTokenIds, tokenById } from "@/data/reviewer/tokens";
import { PILLARS, type Pillar, type Provider, type Rule, type Severity } from "@/data/reviewer/types";
import { detectTokensFromText } from "@/lib/reviewer/detect";
import { PILLAR_LABEL, PROVIDER_LABEL } from "@/lib/reviewer/labels";
import { hashesToRuleIds, ruleHash } from "@/lib/reviewer/rebuild";

import { MAX_CITATIONS } from "./constants";

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export type CitationHit = {
  ruleId: string;
  title: string;
  pillar: Pillar;
  provider: Provider;
  severity: Severity;
  /** the verbatim quote from the provider's documentation */
  quote: string;
  /** the page the quote was copied from */
  docUrl: string;
  /** the honest license label for the quote */
  license: string;
  /** ISO date the quote was copied from the live page */
  retrievedAt: string;
};

export type LookupInput = {
  /** a service name or id, for example "S3", "Amazon RDS", "key vault" */
  service: string;
  /** a pillar name such as "security" or "Cost optimization"; omit for all pillars */
  pillar?: string;
  /** what the caller wants to know; used only to rank the matches */
  question?: string;
};

// Rules that fire only through the diagram-craft or partner-validation paths
// are not engineering citations for a service, so a service lookup skips them.
function isServiceRule(rule: Rule): boolean {
  return !rule.triggers.craft_check && !rule.triggers.partner_check && !rule.triggers.partner_only;
}

const PILLAR_ALIASES: Record<string, Pillar> = {
  "cost optimization": "cost",
  "cost optimisation": "cost",
  "operational excellence": "operations",
  "performance efficiency": "performance",
  ops: "operations",
  perf: "performance",
  sec: "security",
};

/** Turn "Security", "cost optimization", or "ops" into a pillar id, or null. */
export function normalizePillar(input: string | undefined | null): Pillar | null {
  const text = (input ?? "").trim().toLowerCase();
  if (!text) return null;
  const exact = PILLARS.find((pillar) => pillar === text);
  if (exact) return exact;
  const byLabel = PILLARS.find((pillar) => PILLAR_LABEL[pillar].toLowerCase() === text);
  if (byLabel) return byLabel;
  return PILLAR_ALIASES[text] ?? null;
}

export type ResolvedService = { id: string; label: string };

/**
 * Resolve a service name to the closed token vocabulary the rules use: an exact
 * id, an exact label, then any alias found in the text, and last a label that
 * contains the text. Deterministic; nothing fuzzy beyond that.
 */
export function resolveServiceTokens(service: string): ResolvedService[] {
  const text = service.trim().toLowerCase();
  if (!text || text.length > 120) return [];
  const found = new Set<string>();
  if (allTokenIds().has(text)) found.add(text);
  for (const token of SERVICE_TOKENS) {
    if (token.label.toLowerCase() === text) found.add(token.id);
  }
  if (!found.size) for (const id of detectTokensFromText(service)) found.add(id);
  if (!found.size && text.length >= 4) {
    for (const token of SERVICE_TOKENS) {
      if (token.label.toLowerCase().includes(text)) found.add(token.id);
    }
  }
  return [...found].flatMap((id) => {
    const token = tokenById(id);
    return token ? [{ id, label: token.label }] : [];
  });
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "what", "how", "why", "when", "should", "can", "does", "are", "our",
  "your", "you", "from", "into", "have", "has", "not", "any", "all", "about", "which", "there", "their", "will",
]);

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function keywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map(stem);
  return new Set(words);
}

function overlapScore(question: Set<string>, rule: Rule): number {
  if (!question.size) return 0;
  const haystack = keywords(`${rule.title} ${rule.why} ${rule.recommendation} ${rule.citation.quote} ${rule.bp_id ?? ""}`);
  let score = 0;
  for (const word of question) if (haystack.has(word)) score += 1;
  return score;
}

function toHit(rule: Rule): CitationHit {
  return {
    ruleId: rule.id,
    title: rule.title,
    pillar: rule.pillar,
    provider: rule.provider,
    severity: rule.severity,
    quote: rule.citation.quote, // verbatim from the verified KB row
    docUrl: rule.citation.doc_url,
    license: rule.citation.source_license,
    retrievedAt: rule.citation.retrieved_at,
  };
}

/**
 * Up to five cited rules for a service, filtered by pillar, ranked by how many
 * keywords from the question appear in the rule (then by severity). An unknown
 * service or an unknown pillar returns an empty list.
 */
export function lookupCitation(input: LookupInput): CitationHit[] {
  const services = new Set(resolveServiceTokens(input.service).map((s) => s.id));
  if (!services.size) return [];
  let pillar: Pillar | null = null;
  if (input.pillar && input.pillar.trim()) {
    pillar = normalizePillar(input.pillar);
    if (!pillar) return [];
  }
  const question = keywords(input.question ?? "");
  return ACTIVE_RULES.filter(isServiceRule)
    .filter((rule) => rule.triggers.services_any.some((id) => services.has(id)))
    .filter((rule) => !pillar || rule.pillar === pillar)
    .map((rule) => ({ rule, score: overlapScore(question, rule) }))
    .sort(
      (a, b) =>
        b.score - a.score || SEVERITY_RANK[a.rule.severity] - SEVERITY_RANK[b.rule.severity] || a.rule.id.localeCompare(b.rule.id),
    )
    .slice(0, MAX_CITATIONS)
    .map(({ rule }) => toHit(rule));
}

export type ExplainedFinding = {
  ruleId: string;
  /** the 8-hex id used in report links */
  ruleHash: string;
  title: string;
  provider: Provider;
  pillar: Pillar;
  severity: Severity;
  bpId: string | null;
  /** why it matters, in Khavion's words */
  whyItMatters: string;
  /** how to fix and verify it, in Khavion's words */
  fix: string;
  citation: { quote: string; docUrl: string; license: string; retrievedAt: string };
  /** further verbatim quotes that support the same finding */
  alsoCite: { quote: string; docUrl: string }[];
};

const HASH_PATTERN = /^[0-9a-f]{8}$/i;

function findRule(id: string): Rule | null {
  const text = id.trim();
  if (!text) return null;
  const byId = ACTIVE_RULES.find((rule) => rule.id === text) ?? ACTIVE_RULES.find((rule) => rule.id === text.toLowerCase());
  if (byId) return byId;
  if (HASH_PATTERN.test(text)) {
    const [ruleId] = hashesToRuleIds([text.toLowerCase()]);
    if (ruleId) return ACTIVE_RULES.find((rule) => rule.id === ruleId) ?? null;
  }
  return null;
}

/** Explain one finding by rule id or by the 8-hex hash a report link uses. Null when nothing matches. */
export function explainFinding(id: string): ExplainedFinding | null {
  const rule = findRule(id);
  if (!rule) return null;
  return {
    ruleId: rule.id,
    ruleHash: ruleHash(rule.id),
    title: rule.title,
    provider: rule.provider,
    pillar: rule.pillar,
    severity: rule.severity,
    bpId: rule.bp_id,
    whyItMatters: rule.why,
    fix: rule.recommendation,
    citation: {
      quote: rule.citation.quote,
      docUrl: rule.citation.doc_url,
      license: rule.citation.source_license,
      retrievedAt: rule.citation.retrieved_at,
    },
    alsoCite: (rule.also_cite ?? []).map((c) => ({ quote: c.quote, docUrl: c.doc_url })),
  };
}

/** Rule ids that contain the text, for a "did you mean" line. At most five. */
export function suggestRuleIds(text: string): string[] {
  const needle = text.trim().toLowerCase();
  if (needle.length < 3) return [];
  return ACTIVE_RULES.filter((rule) => rule.id.includes(needle))
    .map((rule) => rule.id)
    .slice(0, 5);
}

export function providerLabel(provider: Provider): string {
  return PROVIDER_LABEL[provider];
}

export function pillarLabel(pillar: Pillar): string {
  return PILLAR_LABEL[pillar];
}
