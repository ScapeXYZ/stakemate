export const mainNavigationLinks = [
  { label: "Create Duel", href: "/#prepare-duel", icon: "⚽" },
  { label: "Invitations", href: "/#invitations", icon: "✉" },
  { label: "Connect AI Agent", href: "/#ai-agent", icon: "✦" },
  { label: "Walrus Memory", href: "/activity", icon: "◌" },
] as const;

/** Navigation is rendered on every page, so home sections need document routes. */
export function isCrossPageSafeNavigationHref(href: string) {
  return href === "/activity" || href.startsWith("/#");
}
