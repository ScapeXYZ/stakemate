import { InvitationAuditEvidence } from "@/components/InvitationAuditEvidence";

type InvitePageProps = { params: Promise<{ id: string }> };

export default async function InvitePage({ params }: InvitePageProps) {
  const { id } = await params;
  return <main><section className="principles"><p className="eyebrow">INVITATION · READ-ONLY EVIDENCE</p><h1>Canonical invitation audit</h1><p className="hero-text">Invitation <code>{id}</code> is visible only to an authenticated participant when the server-side lifecycle gate is approved.</p><InvitationAuditEvidence id={id} /></section></main>;
}
