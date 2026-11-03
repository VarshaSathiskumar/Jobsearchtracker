/** Single-user allowlist. Pure so it can be used from edge, server and tests. */
export function isAllowedEmail(email: string | null | undefined, verified?: boolean | null): boolean {
  const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!allowed || !email) return false;
  if (verified === false) return false;
  return email.trim().toLowerCase() === allowed;
}
