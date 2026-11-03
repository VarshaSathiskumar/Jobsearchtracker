import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isAllowedEmail } from "@/lib/allowlist";

/**
 * Edge gate for pages. Visitors without a valid session for the allowlisted account are redirected to
 * /login before any page code runs. API routes and every server component re-check authorization
 * themselves, so this is defence in depth rather than the only barrier.
 */
export async function proxy(req: NextRequest) {
  const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: secure }).catch(() => null);
  if (!isAllowedEmail(token?.email)) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|icon|login|\\.well-known).*)"],
};
