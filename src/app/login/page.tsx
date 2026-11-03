import { redirect } from "next/navigation";
import { ShieldCheck, Sparkles } from "lucide-react";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl shadow-indigo-500/5">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-teal-400 text-white">
            <Sparkles className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Job Tracker</h1>
            <p className="text-sm text-muted-foreground">Private dashboard</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            {error === "AccessDenied" ? "That Google account is not authorized to use this app." : "Sign in failed. Please try again."}
          </p>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <Button type="submit" size="lg" className="w-full gap-3 rounded-xl">
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
              <path fill="#fff" d="M21.35 11.1H12v2.98h5.35c-.5 2.4-2.55 3.6-5.35 3.6a5.9 5.9 0 1 1 0-11.8c1.5 0 2.85.55 3.9 1.45l2.1-2.1A8.9 8.9 0 0 0 12 3a9 9 0 1 0 0 18c5.2 0 8.6-3.65 8.6-8.8 0-.4-.05-.75-.15-1.1Z" />
            </svg>
            Sign in with Google
          </Button>
        </form>

        <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-600" aria-hidden />
          Access is limited to one allowlisted Google account. Signing in does not grant access to your mailbox. Gmail is connected separately, read-only.
        </p>
      </div>
    </main>
  );
}
