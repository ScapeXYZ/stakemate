"use client";

import { useEffect, useState } from "react";

export function InvitationCountdown({ expiresAt, serverNow }: { expiresAt: string; serverNow: string }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Date.parse(expiresAt) - Date.parse(serverNow)));
  useEffect(() => { const receivedAt = Date.now(); const tick = () => setRemaining(Math.max(0, Date.parse(expiresAt) - Date.parse(serverNow) - (Date.now() - receivedAt))); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer); }, [expiresAt, serverNow]);
  if (!remaining) return <span>Expired</span>;
  const totalSeconds = Math.ceil(remaining / 1000); return <span>{Math.floor(totalSeconds / 60)}:{String(totalSeconds % 60).padStart(2, "0")} remaining</span>;
}
