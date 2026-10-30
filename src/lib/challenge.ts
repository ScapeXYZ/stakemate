export type ChallengeInput = {
  fixture: string;
  market: string;
  stake: string;
  opponent: string;
  deadline: string;
};

export type ChallengeErrors = Partial<Record<keyof ChallengeInput, string>>;

export function validateChallenge(input: ChallengeInput): ChallengeErrors {
  const errors: ChallengeErrors = {};
  if (!input.fixture) errors.fixture = "Choose a demo fixture.";
  if (!input.market) errors.market = "Choose a prediction market.";
  const stake = Number(input.stake);
  if (!input.stake || !Number.isFinite(stake) || stake <= 0) errors.stake = "Enter a stake greater than 0.";
  if (!input.opponent.trim()) errors.opponent = "Enter an opponent handle.";
  if (!input.deadline) errors.deadline = "Choose a deadline.";
  else if (new Date(input.deadline).getTime() <= Date.now()) errors.deadline = "Deadline must be in the future.";
  return errors;
}
