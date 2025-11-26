"use server";

/**
 * Temporary stub for Farcaster session.
 * Later this should be replaced with real AuthKit integration.
 */
export async function getFarcasterSession() {
  // For now, just return null so /api/hatch knows there's no session.
  return null;

  // Example shape when you wire real Farcaster:
  // return {
  //   fid: 1234,
  //   username: "example",
  //   wallet: "0xYourWalletHere",
  // };
}
