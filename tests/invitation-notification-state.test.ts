import assert from "node:assert/strict";
import test from "node:test";
import { notificationHistoryForWallet, pendingNotificationsForWallet, unreadPendingNotificationCount } from "../src/lib/invitation-notification-state";

const virus = "0xvirus"; const badman = "0xbadman";
const items = [
  { id: "new", status: "pending", recipientWalletAddress: virus, readAt: null, dismissedAt: null },
  { id: "read", status: "pending", recipientWalletAddress: virus, readAt: "2030-01-01T00:00:00.000Z", dismissedAt: null },
  { id: "dismissed", status: "pending", recipientWalletAddress: virus, readAt: "2030-01-01T00:00:00.000Z", dismissedAt: "2030-01-01T00:00:01.000Z" },
  { id: "terminal", status: "accepted", recipientWalletAddress: virus, readAt: null, dismissedAt: null },
  { id: "other-wallet", status: "pending", recipientWalletAddress: badman, readAt: null, dismissedAt: null },
] as const;

test("only a recipient's genuinely unread pending invitations receive a notification badge", () => {
  assert.deepEqual(pendingNotificationsForWallet(items, virus).map((item) => item.id), ["new", "read", "dismissed"]);
  assert.equal(unreadPendingNotificationCount(items, virus), 1);
  assert.equal(unreadPendingNotificationCount(items, badman), 1);
});

test("historical invitation notification state remains recipient-scoped while terminal rows never become unread", () => {
  const history = [...items, { id: "expired", status: "expired", recipientWalletAddress: virus, readAt: null, dismissedAt: null }];
  assert.deepEqual(notificationHistoryForWallet(history, virus).map((item) => item.id), ["new", "read", "dismissed", "terminal", "expired"]);
  assert.equal(unreadPendingNotificationCount(history, virus), 1);
  assert.deepEqual(notificationHistoryForWallet(history, badman).map((item) => item.id), ["other-wallet"]);
});
