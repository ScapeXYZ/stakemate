import { NextResponse } from "next/server";
import { configuredPublicReadOnlyMcpHandler, remoteMcpPublicReadOnlyEnabled } from "@/lib/server/remote-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

async function serve(request: Request) {
  if (!remoteMcpPublicReadOnlyEnabled()) return NextResponse.json({ error: "Remote MCP is disabled." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return configuredPublicReadOnlyMcpHandler().fetch(request);
}

export const POST = serve;
