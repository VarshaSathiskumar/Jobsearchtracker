import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/allowlist";
import { getDb } from "@/db";
import { appUrl } from "@/env";
import { decryptSecret } from "@/lib/crypto";
import { GmailClient } from "@/lib/gmail/client";
import { saveConnection } from "@/lib/gmail/connection";
import { exchangeCode } from "@/lib/gmail/oauth";
import { getCurrentUser } from "@/lib/session";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const COOKIE = "gmail_oauth";

function back(status: string) {
  const res = NextResponse.redirect(new URL(`/settings?gmail=${status}`, appUrl()));
  res.cookies.set(COOKIE, "", { path: "/api/gmail", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!isAllowedEmail(session?.user?.email)) return NextResponse.redirect(new URL("/login", appUrl()));
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", appUrl()));

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  const state = params.get("state");
  const cookie = req.cookies.get(COOKIE)?.value;
  if (!code || !state || !cookie) return back("error");

  let saved: { state: string; verifier: string; email: string; exp: number };
  try {
    saved = JSON.parse(decryptSecret(cookie));
  } catch {
    return back("error");
  }
  if (saved.state !== state || saved.exp < Date.now() || saved.email !== user.email) return back("error");

  try {
    const tokens = await exchangeCode(code, saved.verifier);
    const profile = await new GmailClient({ getAccessToken: async () => tokens.accessToken }).getProfile();
    await saveConnection(getDb(), { userId: user.id, googleEmail: profile.emailAddress, refreshToken: tokens.refreshToken, scopes: tokens.scope });
    return back("connected");
  } catch (err) {
    log.error("gmail.connect_failed", {}, err);
    return back("error");
  }
}
