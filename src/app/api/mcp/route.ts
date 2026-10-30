import { NextResponse } from "next/server";
import { remoteMcpEnabled } from "@/lib/server/remote-mcp-policy";

async function serve(request: Request) {
  // A real OAuth verifier is intentionally not injectable from the browser or
  // environment strings. Until the separately reviewed deployment adapter is
  // installed, the endpoint remains unavailable even if a flag is set.
  if (!remoteMcpEnabled()) return NextResponse.json({ error: "Remote MCP is disabled." }, { status: 404 });
  return NextResponse.json({ error: "Remote MCP OAuth verifier is not configured." }, { status: 503 });
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
