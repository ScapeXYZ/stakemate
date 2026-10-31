import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { analyzeAgentMemories, AgentInsightsRateLimiter, recordsForCanonicalInvitations } from "@/lib/server/agent-insights";
import { getCanonicalInvitationPersistenceAdapter } from "@/lib/server/canonical-invitation-persistence";
import { getInvitationStore } from "@/lib/server/invitations";
import { authenticatedWallet } from "@/lib/server/session";
import { getWalrusMemoryService } from "@/lib/server/walrus-memory";
import { recallPublishedWalrusBatch } from "@/lib/server/walrus-batch";
import { getPostgresWalrusEvidenceStore } from "@/lib/server/walrus-evidence-store";
export const runtime = "nodejs";
const limiter = new AgentInsightsRateLimiter();
/** Owner-scoped, read-only Memory recall: no writes, invitations, signatures, or transfers. */
export async function GET() { try { const session = await authenticatedWallet(); if (!session) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 }); const subject = createHash("sha256").update(session.walletAddress).digest("hex"); if (!limiter.allow(subject)) return NextResponse.json({ error: "RATE_LIMITED", retryAfterSeconds: 60 }, { status: 429, headers: { "Retry-After": "60" } }); const profile = await getInvitationStore().profileForWallet(session.walletAddress); if (!profile) return NextResponse.json({ error: "USERNAME_REQUIRED" }, { status: 403 }); const store = getPostgresWalrusEvidenceStore(); const manifest = await store.manifest(); if (!manifest) throw new Error("WALRUS_EVIDENCE_NOT_IMPORTED"); const recalled = await recallPublishedWalrusBatch(manifest, getWalrusMemoryService(), store);
  // Lifecycle gates protect invitation mutations. Recall remains read-only, but
  // records are personalized only when immutable, wallet-scoped invitations
  // can be read through the already-isolated pilot adapter.
  let invitations = { sent: [] as Awaited<ReturnType<ReturnType<typeof getCanonicalInvitationPersistenceAdapter>["inbox"]>>["sent"], received: [] as Awaited<ReturnType<ReturnType<typeof getCanonicalInvitationPersistenceAdapter>["inbox"]>>["received"] }; let walletBindingAvailable = false;
  try { invitations = await getCanonicalInvitationPersistenceAdapter().inbox(session.walletAddress); walletBindingAvailable = true; } catch { /* Recall remains useful but no wallet-specific record is trusted without canonical DB binding. */ }
  const insight = await analyzeAgentMemories(recordsForCanonicalInvitations(recalled.records, [...invitations.sent, ...invitations.received]), store); return NextResponse.json({ ...insight, recall: { status: "completed", batchDigest: manifest.batchDigest, completedReceiptCount: recalled.receiptCount, recalledCount: recalled.recalledCount, rejectedCount: recalled.rejectedCount, walletBindingAvailable }, provenance: recalled.provenance, readOnly: true }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { const code = error instanceof Error ? error.message : "MEMORY_RECALL_UNAVAILABLE"; return NextResponse.json({ error: "MEMORY_RECALL_UNAVAILABLE", code }, { status: 503 }); } }
