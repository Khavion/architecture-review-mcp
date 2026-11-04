# Runs the published MCP server over stdio. The package bundles everything it needs.
FROM node:22-slim
RUN npm install -g @khavion/architecture-review-mcp
ENTRYPOINT ["architecture-review-mcp"]
