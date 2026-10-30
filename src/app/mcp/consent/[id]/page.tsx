import { RemoteMcpConsentScreen } from "@/components/RemoteMcpConsentScreen";

export default async function RemoteMcpConsentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ state?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <RemoteMcpConsentScreen id={id} state={query.state ?? ""} />;
}
