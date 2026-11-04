// Shared constants for the three Khavion architecture review packages (the MCP
// server, the CLI, and the GitHub Action). Not published on its own: the build
// bundles this module into each package.

import { ESTIMATE_DISCLAIMER } from "@/data/reviewer/pricing";

/** Printed on every price line the packages render. Same sentence as the website. */
export { ESTIMATE_DISCLAIMER };

/** The one place the two Khavion endpoints live. KHAVION_BASE_URL may override it (tests only). */
export const DEFAULT_BASE_URL = "https://khavion.com";

/** Where a visitor gets a free work-email key. */
export const KEY_PAGE_URL = "https://khavion.com/tools/api-key";

/** Without a valid key, a review shows this many findings and counts for the rest. */
export const FREE_FINDING_LIMIT = 3;

/** Said plainly whenever the output is the free tier. */
export const FREE_NOTICE = `Free work-email key opens every finding, the quote total, the recommended next step, and a report link: ${KEY_PAGE_URL}`;

/** The most citations lookupCitation returns. */
export const MAX_CITATIONS = 5;
