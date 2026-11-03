import { createHash, randomBytes } from "node:crypto";
import { appUrl, googleEnv } from "@/env";
import { GmailAuthError } from "./client";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const ALLOWED_SCOPES = new Set([GMAIL_READONLY_SCOPE, "openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]);

export const GMAIL_REDIRECT_PATH = "/api/gmail/callback";
export const gmailRedirectUri = () => appUrl() + GMAIL_REDIRECT_PATH;

export function newPkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(24).toString("base64url") };
}

export function buildGmailAuthUrl(args: { state: string; challenge: string; loginHint?: string }) {
  const { GOOGLE_CLIENT_ID } = googleEnv();
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  u.searchParams.set("redirect_uri", gmailRedirectUri());
  u.searchParams.set("response_type", "code");
  // Read-only is the only Gmail scope this app ever requests.
  u.searchParams.set("scope", GMAIL_READONLY_SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "false");
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (args.loginHint) u.searchParams.set("login_hint", args.loginHint);
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope: string; error?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = googleEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error_description?: string };
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new GmailAuthError("Google rejected the refresh token (revoked or expired)");
    throw new Error(`Google token endpoint error: ${json.error ?? res.status}`);
  }
  return json;
}

/** Throws if Google granted anything beyond read-only Gmail access. */
export function assertReadOnlyScopes(scope: string) {
  const granted = scope.split(/\s+/).filter(Boolean);
  if (!granted.includes(GMAIL_READONLY_SCOPE)) throw new Error("Gmail read-only access was not granted");
  const extra = granted.filter((s) => !ALLOWED_SCOPES.has(s));
  if (extra.length) throw new Error("Unexpected additional scopes were granted. Refusing to store the credential.");
}

export async function exchangeCode(code: string, verifier: string) {
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: gmailRedirectUri(),
  });
  assertReadOnlyScopes(t.scope);
  if (!t.refresh_token) throw new Error("Google did not return a refresh token. Remove the app from your Google account permissions and reconnect.");
  return { accessToken: t.access_token, refreshToken: t.refresh_token, scope: t.scope };
}

export async function refreshAccessToken(refreshToken: string) {
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  return { accessToken: t.access_token, expiresInSec: t.expires_in };
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    /* best effort, the local credential is deleted regardless */
  }
}
