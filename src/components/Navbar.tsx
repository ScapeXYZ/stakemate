"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { InvitationNotifications } from "@/components/InvitationNotifications";
import { mainNavigationLinks } from "@/lib/main-navigation";

// Use document routes rather than bare fragments: this navbar is also rendered
// on Activity, where a bare #prepare-duel fragment would otherwise do nothing.
const WalletControl = dynamic(() => import("./WalletControl").then((module) => module.WalletControl), { ssr: false });

export function Navbar() {
  const [open, setOpen] = useState(false);
  return <header className="nav-shell"><nav className="nav" aria-label="Main navigation"><Link href="/#top" className="brand" aria-label="StakeMate home"><span>✦</span> StakeMate</Link><button className="menu" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Toggle menu">☰</button><div className={`nav-links ${open ? "is-open" : ""}`}>{mainNavigationLinks.map((link) => <Link key={link.label} href={link.href} onClick={() => setOpen(false)}><span aria-hidden="true">{link.icon}</span> {link.label}</Link>)}</div><InvitationNotifications /><WalletControl /></nav></header>;
}
