// Khavion architecture review as an MCP server over stdio. Four tools, all
// deterministic and rules-based: no AI model is called. stdout carries the
// protocol only; anything else goes to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  explainFinding,
  formatCitationsText,
  formatExplainText,
  formatReviewText,
  gateReview,
  lookupCitation,
  resolveServiceTokens,
  reviewIac,
  reviewStack,
  suggestRuleIds,
} from "../../core/src";
import pkg from "../package.json";

const MAX_FILES = 200;
const MAX_FILE_CHARS = 400_000;
const MAX_TOTAL_CHARS = 2_000_000;
const MAX_TOKENS = 200;

const PILLARS = ["security", "reliability", "cost", "performance", "operations", "sustainability"] as const;

function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], ...(isError ? { isError: true } : {}) };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "architecture-review-mcp", version: pkg.version });

  server.registerTool(
    "lookup_citation",
    {
      title: "Look up a cited best practice",
      description:
        "Find the cloud provider's own documentation for a service. Returns up to 5 rules for the service, each with a verbatim quote from the provider's docs and the page link. Free, offline, and complete. Use it to ground a recommendation in a primary source before you state it.",
      inputSchema: {
        service: z
          .string()
          .min(1)
          .max(120)
          .describe("The service, by name or id. Examples: S3, Amazon RDS, Lambda, Key Vault, Cloud Run."),
        pillar: z
          .enum(PILLARS)
          .optional()
          .describe("Limit results to one Well-Architected pillar. Omit to search all pillars."),
        question: z
          .string()
          .max(500)
          .optional()
          .describe("What you want to know, in a sentence. Used only to rank the matches by shared keywords."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ service, pillar, question }) => {
      const matched = resolveServiceTokens(service);
      const hits = lookupCitation({ service, pillar, question });
      return text(formatCitationsText(hits, matched));
    },
  );

  server.registerTool(
    "review_iac",
    {
      title: "Review infrastructure as code",
      description:
        "Review Terraform, CloudFormation, or Kubernetes files against cited cloud best practices. Pass the file contents. Without an API key it returns the top 3 findings by severity plus counts for the rest. With KHAVION_API_KEY set in the server's environment and valid, it returns every finding, the quote total, the recommended next step, and a report link. File contents stay on this machine; only the key, rule ids, and a count of services are sent to Khavion.",
      inputSchema: {
        files: z
          .array(
            z.object({
              path: z.string().min(1).max(500).describe("File path, used for labels and to spot .tf files."),
              content: z.string().max(MAX_FILE_CHARS).describe("The full text of the file."),
            }),
          )
          .min(1)
          .max(MAX_FILES)
          .describe("The infrastructure files to review."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ files }) => {
      const total = files.reduce((sum, file) => sum + file.content.length, 0);
      if (total > MAX_TOTAL_CHARS) {
        return text(`The files add up to more than ${MAX_TOTAL_CHARS.toLocaleString("en-US")} characters. Send fewer files.`, true);
      }
      const gated = await gateReview(reviewIac(files));
      return text(formatReviewText(gated));
    },
  );

  server.registerTool(
    "review_stack",
    {
      title: "Review a list of services",
      description:
        "Review a stack described as a list of services, such as s3, rds, lambda. Optionally add a sentence about the workload. Same output rules as review_iac: the top 3 findings without a valid API key, everything with one. Nothing but the key, rule ids, and a count of services leaves this machine.",
      inputSchema: {
        tokens: z
          .array(z.string().min(1).max(120))
          .min(1)
          .max(MAX_TOKENS)
          .describe("Service ids or names. Examples: s3, rds, Amazon EC2, Key Vault."),
        intent: z
          .string()
          .max(2000)
          .optional()
          .describe("One or two sentences about the workload, for example whether it is public-facing."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ tokens, intent }) => {
      const gated = await gateReview(reviewStack({ tokens, intent }));
      return text(formatReviewText(gated));
    },
  );

  server.registerTool(
    "explain_finding",
    {
      title: "Explain a finding",
      description:
        "Explain one finding by rule id (for example aws-sec-encryption-at-rest) or by the 8-character id used in report links. Returns why it matters, the fix, and the verbatim citation with its link. Free and offline.",
      inputSchema: {
        id: z.string().min(1).max(100).describe("A rule id, or an 8-character hexadecimal report id."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const found = explainFinding(id);
      if (found) return text(formatExplainText(found));
      const suggestions = suggestRuleIds(id);
      return text(
        `No finding matches "${id}".${suggestions.length ? ` Rules with similar ids: ${suggestions.join(", ")}.` : ""}`,
        true,
      );
    },
  );

  return server;
}

export const VERSION: string = pkg.version;
