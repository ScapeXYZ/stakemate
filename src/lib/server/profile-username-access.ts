export class ProfileAuthenticationRequiredError extends Error {
  constructor() {
    super("Profile authentication is required.");
    this.name = "ProfileAuthenticationRequiredError";
  }
}

export async function withAuthenticatedProfileWallet<T>(
  session: { walletAddress: string } | null,
  operation: (walletAddress: string) => Promise<T>,
): Promise<T> {
  if (!session) {
    throw new ProfileAuthenticationRequiredError();
  }

  return operation(session.walletAddress);
}
