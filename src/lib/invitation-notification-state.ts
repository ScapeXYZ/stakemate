export type PendingInvitationNotification = { id: string; status: string; recipientWalletAddress: string; readAt: string | null; dismissedAt: string | null };

/** Pure presentation guard in addition to server-side party-scoped database reads. */
export function pendingNotificationsForWallet(items: readonly PendingInvitationNotification[], walletAddress: string) {
  return items.filter((item) => item.status === "pending" && item.recipientWalletAddress === walletAddress);
}

/** Historical notification rows remain visible to their recipient, never to another wallet. */
export function notificationHistoryForWallet(items: readonly PendingInvitationNotification[], walletAddress: string) {
  return items.filter((item) => item.recipientWalletAddress === walletAddress);
}

/** A pending item becomes unread only until the recipient reads or dismisses it. */
export function unreadPendingNotificationCount(items: readonly PendingInvitationNotification[], walletAddress: string) {
  return pendingNotificationsForWallet(items, walletAddress).filter((item) => !item.readAt && !item.dismissedAt).length;
}
