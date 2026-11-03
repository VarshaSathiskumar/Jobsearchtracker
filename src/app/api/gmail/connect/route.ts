import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/allowlist";
import { encryptSecret } from "@/lib/crypto";
import { buildGmailAuthUrl, newPkce } from "@/lib/gmail/oauth";
import { appUrl } from "@/env";

export const dynamic = "force-dynamic";

const OAUTH_COOKIE = "gmail_oauth";

/** Starts the separate, read-only Gmail authorization (PKCE + state). */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!isAllowedEmail(email)) return NextResponse.redirect(new URL("/login", appUrl()));

  const { verifier, challenge, state } = newPkce();
  const url = buildGmailAuthUrl({ state, challenge, loginHint: email! });
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, encryptSecret(JSON.stringify({ state, verifier, email, exp: Date.now() + 10 * 60_000 })), {
    httpOnly: true,
    secure: appUrl().startsWith("https://"),
    sameSite: "lax",
    path: "/api/gmail",
    maxAge: 600,
  });
  return res;
}
