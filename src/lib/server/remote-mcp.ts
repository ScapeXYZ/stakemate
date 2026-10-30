import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { createStakeMateMcpServer, type McpDependencies } from "@/lib/server/stakemate-mcp";
import type { McpAuthContext } from "@/lib/server/mcp-auth-context";
export { remoteMcpEnabled } from "@/lib/server/remote-mcp-policy";

export type RemotePrincipal = McpAuthContext;
export type RemoteAuthorization = { verify(request: Request): Promise<RemotePrincipal | null> };

/**
 * Official SDK Streamable HTTP handler. The authorization implementation must
 * validate a short-lived OAuth access token before returning a wallet principal.
 */
export function createRemoteMcpHandler(dependencies: Omit<McpDependencies, "authContext">, authorization: RemoteAuthorization) {
  return createMcpHandler(async ({ requestInfo }) => {
    const principal = requestInfo ? await authorization.verify(requestInfo) : null;
    return createStakeMateMcpServer({ ...dependencies, authContext: async () => principal });
  }, { legacy: "reject", responseMode: "auto", maxRequestBodySize: 256 * 1024 });
}

/** Rejects remote enablement until a deployment supplies a real OAuth verifier. */
export const noRemoteAuthorization: RemoteAuthorization = { verify: async () => null };
