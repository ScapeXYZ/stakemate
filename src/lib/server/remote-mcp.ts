import { createMcpHandler, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createStakeMateMcpServer, createStakeMatePublicMcpServer, configuredMcpDependencies, type McpDependencies } from "@/lib/server/stakemate-mcp";
import type { McpAuthContext } from "@/lib/server/mcp-auth-context";
export { remoteMcpEnabled, remoteMcpPublicReadOnlyEnabled } from "@/lib/server/remote-mcp-policy";

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

const publicMcpResource = "https://stakemate.isholadigital.tech/api/mcp";
const publicMcpOrigin = new URL(publicMcpResource).origin;
const publicMcpHost = new URL(publicMcpResource).host;
const maxPublicMcpRequestBytes = 64 * 1024;
const publicMcpTimeoutMs = 8_000;
const publicMcpWindowMs = 60_000;
const publicMcpRequestLimit = 30;
const publicMcpAllowedOrigins = new Set(["https://claude.ai"]);

type PublicMcpDependencies = Pick<McpDependencies, "store" | "football">;
type RateBucket = { startedAt: number; count: number };

/** Best-effort per-isolate abuse control; Vercel/WAF remains the outer limit. */
export class PublicMcpRateLimiter {
  private buckets = new Map<string, RateBucket>();
  constructor(private readonly now: () => number = Date.now) {}

  allow(key: string) {
    const now = this.now();
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= publicMcpWindowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      if (this.buckets.size > 1_000) this.buckets.delete(this.buckets.keys().next().value!);
      return true;
    }
    if (current.count >= publicMcpRequestLimit) return false;
    current.count += 1;
    return true;
  }
}

const rateLimiter = new PublicMcpRateLimiter();

function response(status: number, body: Record<string, string>, extra: HeadersInit = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}

function publicMcpClientKey(request: Request) {
  // This is solely an abuse-control bucket, never an authenticated identity.
  return request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
}

function requestRejected(request: Request, limiter: PublicMcpRateLimiter): Response | null {
  const url = new URL(request.url);
  if (url.origin !== publicMcpOrigin || request.headers.get("host") !== publicMcpHost) return response(421, { error: "Misdirected MCP request." });
  const origin = request.headers.get("origin");
  if (origin && !publicMcpAllowedOrigins.has(origin)) return response(403, { error: "MCP request origin is not allowed." });
  if (request.method !== "POST") return response(405, { error: "MCP endpoint accepts POST only." }, { Allow: "POST" });
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) return response(415, { error: "MCP requests must use application/json." });
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/u.test(length) || Number(length) > maxPublicMcpRequestBytes)) return response(413, { error: "MCP request is too large." });
  if (!limiter.allow(publicMcpClientKey(request))) return response(429, { error: "MCP request rate limit exceeded." }, { "Retry-After": "60" });
  return null;
}

/**
 * The public transport needs only protocol and representation headers.  Do
 * not hand client credentials, cookies, or arbitrary forwarding headers to
 * the SDK or a future tool implementation.
 */
function anonymousMcpRequest(request: Request, signal: AbortSignal) {
  const headers = new Headers();
  for (const name of ["accept", "content-type", "content-length", "mcp-protocol-version"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Request(request, { headers, signal });
}

async function withTimeout<T>(work: Promise<T>, timeoutMs = publicMcpTimeoutMs, onTimeout?: () => void) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        onTimeout?.();
        reject(new Error("PUBLIC_MCP_TIMEOUT"));
      }, timeoutMs);
    })]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function securedResponse(result: Response) {
  const headers = new Headers(result.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
}

/**
 * Stateless Streamable HTTP server limited to two anonymous, public tools.
 * No authorization header, client data, or wallet information is used as an
 * identity input anywhere on this path.
 */
export type PublicReadOnlyMcpOptions = { limiter?: PublicMcpRateLimiter; timeoutMs?: number };

export function createPublicReadOnlyMcpHandler(dependencies: PublicMcpDependencies, options: PublicReadOnlyMcpOptions = {}): { fetch(request: Request): Promise<Response> } {
  const limiter = options.limiter ?? rateLimiter;
  return {
    async fetch(request: Request) {
      const rejected = requestRejected(request, limiter);
      if (rejected) return rejected;
      try {
        const controller = new AbortController();
        const anonymousRequest = anonymousMcpRequest(request, controller.signal);
        const server = createStakeMatePublicMcpServer(dependencies);
        const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: maxPublicMcpRequestBytes });
        await server.connect(transport);
        try {
          return securedResponse(await withTimeout(transport.handleRequest(anonymousRequest), options.timeoutMs, () => controller.abort()));
        } finally {
          await server.close();
        }
      } catch (error) {
        return error instanceof Error && error.message === "PUBLIC_MCP_TIMEOUT"
          ? response(504, { error: "MCP request timed out." })
          : response(500, { error: "MCP request could not be served." });
      }
    },
  };
}

let configuredPublicHandler: ReturnType<typeof createPublicReadOnlyMcpHandler> | undefined;

export function configuredPublicReadOnlyMcpHandler() {
  configuredPublicHandler ??= createPublicReadOnlyMcpHandler(configuredMcpDependencies());
  return configuredPublicHandler;
}
