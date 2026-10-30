import { NextResponse } from "next/server";
import { uniqueInvitationMemoryEvents } from "@/lib/server/invitation-memory-events";
import { getCanonicalInvitationPersistenceAdapter } from "@/lib/server/canonical-invitation-persistence";
import { assertInvitationLifecycleEnabled } from "@/lib/server/invitation-lifecycle-gate";
import { FileMemoryReceiptStore, getWalrusMemoryService } from "@/lib/server/walrus-memory";
import { inspectWalrusBatchReceipts, readWalrusBatchManifest } from "@/lib/server/walrus-batch";
import { authenticatedWallet } from "@/lib/server/session";

export const runtime = "nodejs";

/** Party-scoped, non-writing Mainnet review evidence for the isolated pilot. */
export async function GET() {
  try {
    assertInvitationLifecycleEnabled();
    const session = await authenticatedWallet();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const inbox = await getCanonicalInvitationPersistenceAdapter().inbox(session.walletAddress);
    const events = uniqueInvitationMemoryEvents([...inbox.sent, ...inbox.received]);
    const review = await getWalrusMemoryService().dryRun(events);
    const receiptPath = process.env.WALRUS_MEMORY_RECEIPTS_PATH ?? "/tmp/stakemate-walrus/receipts.json";
    const manifestPath = process.env.WALRUS_MEMORY_MANIFEST_PATH ?? "/tmp/stakemate-walrus/mainnet-batch.json";
    const receiptStore = new FileMemoryReceiptStore(receiptPath);
    const receipts = await Promise.all(review.entries.map((entry) => receiptStore.get(entry.digest)));
    const receiptByDigest = new Map(receipts.filter((receipt): receipt is NonNullable<typeof receipt> => Boolean(receipt)).map((receipt) => [receipt.digest, receipt]));
    let walletVerified = 0;
    let approvedBatch: { state: "available"; digest: string; recordCount: number; completedReceipts: number; walletLinkedReceipts: number; unpublishedOrUnmatchedCandidates: number } | { state: "missing_or_invalid" } = { state: "missing_or_invalid" };
    try { const manifest = await readWalrusBatchManifest(manifestPath); const inspected = await inspectWalrusBatchReceipts(manifest, receiptStore); const batchByDigest = new Map(manifest.entries.map((entry) => [entry.digest, entry])); walletVerified = review.entries.filter((entry) => { const receipt = receiptByDigest.get(entry.digest); const batchEntry = batchByDigest.get(entry.digest); return !entry.duplicate && receipt?.status === "completed" && Boolean(receipt.blobId) && batchEntry?.recordId === entry.recordId; }).length; approvedBatch = { state: "available", digest: manifest.batchDigest, recordCount: manifest.recordCount, completedReceipts: inspected.completed.length, walletLinkedReceipts: walletVerified, unpublishedOrUnmatchedCandidates: review.entries.filter((entry) => !batchByDigest.has(entry.digest) && !entry.duplicate).length }; } catch { /* The current candidate view remains useful when an operator has not supplied the local manifest. */ }
    return NextResponse.json({ network: "mainnet", connectivity: "not_checked", writesEnabled: false, verifiedMainnetWrites: walletVerified, approvedBatch, events, review: { ...review, entries: review.entries.map((entry) => ({ ...entry, receipt: receiptByDigest.get(entry.digest) ? { status: receiptByDigest.get(entry.digest)!.status, blobId: receiptByDigest.get(entry.digest)!.blobId ?? null } : null })) }, source: "canonical invitation commitments", readOnly: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MEMORY_REVIEW_UNAVAILABLE";
    const diagnostic = process.env.NODE_ENV === "production" ? undefined : error instanceof Error ? { name: error.name, message: error.message } : undefined;
    return NextResponse.json({ error: "Memory candidates could not be validated. No Mainnet write was attempted.", code, diagnostic }, { status: code === "INVITATION_LIFECYCLE_DISABLED" ? 423 : 503 });
  }
}
