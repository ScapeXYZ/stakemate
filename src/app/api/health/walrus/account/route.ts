import "server-only";
import { NextResponse } from "next/server";
import { publicProviderStatus } from "@/lib/server/errors";
import { getWalrusMemoryService } from "@/lib/server/walrus-memory";

export const runtime = "nodejs";
/** Authenticated Mainnet read-only readiness; no result content or credentials are returned. */
export async function GET() { try { return NextResponse.json(await getWalrusMemoryService().accountReadiness()); } catch (error) { return NextResponse.json(publicProviderStatus(error), { status: 503 }); } }
