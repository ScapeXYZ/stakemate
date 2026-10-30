import "server-only";
import { NextResponse } from "next/server";
import { publicProviderStatus } from "@/lib/server/errors";
import { getWalrusMemoryService } from "@/lib/server/walrus-memory";

export const runtime = "nodejs";
export async function GET() { try { return NextResponse.json(await getWalrusMemoryService().health()); } catch (error) { return NextResponse.json(publicProviderStatus(error), { status: 503 }); } }
