type Props = { state: "loading" | "empty" | "error" | "success" };
export function ChallengeStatus({ state }: Props) {
  const content = {
    loading: ["Preparing your draft", "Validating demo challenge details…"],
    empty: ["No active challenges", "Create a simulated challenge to see it here."],
    error: ["Demo action unavailable", "Check the required fields and try again."],
    success: ["Draft challenge created", "This is a local demo draft. Nothing was sent on-chain."],
  }[state];
  return <div className={`status status-${state}`} role={state === "error" ? "alert" : "status"}><span>{state === "success" ? "✓" : state === "error" ? "!" : "○"}</span><div><b>{content[0]}</b><p>{content[1]}</p></div></div>;
}
