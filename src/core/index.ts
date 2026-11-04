// Source of truth for the three Khavion architecture review packages. Not
// published on its own. Everything exported here is deterministic and offline,
// except the two Khavion calls in api.ts and gate.ts, which run only when a key
// is supplied.

export { ESTIMATE_DISCLAIMER, FREE_FINDING_LIMIT, FREE_NOTICE, KEY_PAGE_URL, DEFAULT_BASE_URL, MAX_CITATIONS } from "./constants";
export {
  explainFinding,
  lookupCitation,
  normalizePillar,
  resolveServiceTokens,
  suggestRuleIds,
  type CitationHit,
  type ExplainedFinding,
  type LookupInput,
  type ResolvedService,
} from "./citations";
export {
  reviewIac,
  reviewStack,
  type IacFile,
  type RecognizedService,
  type ReviewFinding,
  type ReviewOffer,
  type ReviewOptions,
  type ReviewResult,
  type StackInput,
} from "./review";
export { exceedsLevel, freeView, gateReview, type GatedReview, type NextStepLine, type PriceLine } from "./gate";
export {
  acceptableReportUrl,
  isPlausibleKey,
  normalizeBaseUrl,
  requestReportLink,
  resolveAccess,
  verifyKey,
  type AccessOptions,
  type FetchLike,
  type KeyCheck,
  type ResolvedAccess,
} from "./api";
export { describeCounts, formatCitationsText, formatExplainText, formatReviewText } from "./format";
export {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  SKIPPED_DIRECTORIES,
  collectIacFiles,
  type CollectLimits,
  type CollectResult,
} from "./files";
