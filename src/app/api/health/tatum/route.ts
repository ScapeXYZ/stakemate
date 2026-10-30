import "server-only";
import { NextResponse } from "next/server";
import { publicProviderStatus } from "@/lib/server/errors";
import { getTatumSuiClient } from "@/lib/server/tatum-sui";

export const runtime = "nodejs";
export async function GET() { try { return NextResponse.json(await getTatumSuiClient().health()); } catch (error) { return NextResponse.json(publicProviderStatus(error), { status: 503 }); } }
