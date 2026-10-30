import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { configuredMcpDependencies, createStakeMateMcpServer } from "@/lib/server/stakemate-mcp";

// stdout is reserved for MCP JSON-RPC. Never log configuration or secrets there.
void serveStdio(() => createStakeMateMcpServer(configuredMcpDependencies()), { onerror: (error) => console.error(`StakeMate MCP transport error: ${error.name}`) });
console.error("StakeMate MCP server listening on stdio (read-only/preview-only).");
