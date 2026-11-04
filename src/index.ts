// The program: `architecture-review-mcp` runs the server on stdio. stdout is the
// protocol channel, so messages for people go to stderr.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { VERSION, createServer } from "./server";

const HELP = [
  "architecture-review-mcp: Khavion architecture review as an MCP server (stdio).",
  "",
  "Add it to an MCP client with the command: npx -y @khavion/architecture-review-mcp",
  "Optional: set KHAVION_API_KEY in the server's environment for the full review output.",
  "Tools: lookup_citation, review_iac, review_stack, explain_finding.",
  "",
].join("\n");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  await createServer().connect(new StdioServerTransport());
  process.stderr.write(`architecture-review-mcp ${VERSION} ready on stdio\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`architecture-review-mcp could not start: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exit(1);
});
