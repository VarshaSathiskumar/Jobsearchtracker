import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "@/lib/allowlist";

/**
 * Google sign-in only proves identity (openid, email, profile). Gmail access is a separate,
 * explicit authorization handled by /api/gmail/connect. The allowlist is enforced here at sign-in
 * and again on every server-side request in lib/session.ts.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    async signIn({ profile }) {
      return isAllowedEmail(profile?.email, profile?.email_verified as boolean | undefined);
    },
    async jwt({ token, profile }) {
      if (profile?.email) {
        token.email = profile.email.toLowerCase();
        token.name = profile.name ?? token.name;
        token.picture = (profile.picture as string | undefined) ?? token.picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.email) session.user.email = token.email;
      return session;
    },
  },
}));
