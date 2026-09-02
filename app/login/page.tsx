"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // /api/auth/confirm lands here with ?error=confirmation_failed whenever
  // the one-time confirmation code couldn't be exchanged for a session —
  // most commonly because something (an email client's own link-safety
  // scanner, or a second click on the same link) already used it up before
  // the person got to it. Before this, that failure was completely silent:
  // the visitor just landed on a normal-looking login page with no idea
  // anything had gone wrong, then got a confusing "Email not confirmed"
  // error trying to sign in — discovered via a real beta tester's report
  // 2026-09-02.
  const [confirmationFailed, setConfirmationFailed] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "confirmation_failed") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a post-redirect URL param; hydration-safe since it only runs client-side after mount
      setConfirmationFailed(true);
      window.history.replaceState({}, "", "/login");
    }
  }, []);

  async function resendConfirmation() {
    if (!email.trim()) {
      setResendError("Enter your email above first, then hit Resend.");
      return;
    }
    setResending(true);
    setResendError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
    setResending(false);
    if (error) {
      setResendError(error.message);
    } else {
      setResendSent(true);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#0E0E10" }}
    >
      <div
        className="rounded-xl p-8 w-full max-w-sm"
        style={{
          backgroundColor: "#16181c",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="mb-8">
          <div className="flex justify-center mb-5">
            <Image
              src="/stagereach-logo.png"
              alt="StageReach"
              width={300}
              height={100}
              className="rounded-lg"
              style={{ objectFit: "contain" }}
            />
          </div>
          <p className="text-sm text-center" style={{ color: "#9a9591" }}>
            Sign in to your account
          </p>
        </div>

        {confirmationFailed && (
          <div
            className="rounded-lg px-3 py-3 mb-4 text-sm"
            style={{ backgroundColor: "rgba(212,166,79,0.1)", border: "1px solid rgba(212,166,79,0.25)", color: "#D4A64F" }}
          >
            {resendSent ? (
              <p>New confirmation email sent — check your inbox and click the fresh link.</p>
            ) : (
              <>
                <p className="mb-2">
                  That confirmation link didn&apos;t work — it may have already been opened once (some email
                  apps do this automatically) or expired. Enter your email below and resend it.
                </p>
                <button
                  type="button"
                  onClick={resendConfirmation}
                  disabled={resending}
                  className="text-sm font-semibold underline disabled:opacity-50"
                >
                  {resending ? "Sending…" : "Resend confirmation email"}
                </button>
                {resendError && <p className="mt-1" style={{ color: "#e25c5c" }}>{resendError}</p>}
              </>
            )}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: "#9a9591" }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors"
              style={{
                backgroundColor: "#1e2128",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "#F4E8D2",
              }}
              placeholder="you@example.com"
              onFocus={(e) => {
                (e.target as HTMLInputElement).style.borderColor =
                  "rgba(212,166,79,0.5)";
              }}
              onBlur={(e) => {
                (e.target as HTMLInputElement).style.borderColor =
                  "rgba(255,255,255,0.07)";
              }}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: "#9a9591" }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors"
              style={{
                backgroundColor: "#1e2128",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "#F4E8D2",
              }}
              placeholder="••••••••"
              onFocus={(e) => {
                (e.target as HTMLInputElement).style.borderColor =
                  "rgba(212,166,79,0.5)";
              }}
              onBlur={(e) => {
                (e.target as HTMLInputElement).style.borderColor =
                  "rgba(255,255,255,0.07)";
              }}
            />
          </div>

          {error && (
            <p
              className="text-sm rounded-lg px-3 py-2"
              style={{
                color: "#e25c5c",
                backgroundColor: "rgba(226,92,92,0.1)",
                border: "1px solid rgba(226,92,92,0.2)",
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            style={{
              backgroundColor: "#D4A64F",
              color: "#0E0E10",
            }}
            onMouseEnter={(e) => {
              if (!loading)
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "#c49840";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "#D4A64F";
            }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: "#5e5c58" }}>
          Don&apos;t have an account?{" "}
          <Link href="/signup" style={{ color: "#D4A64F", textDecoration: "underline" }}>
            Create one
          </Link>
        </p>
        <p className="text-center mt-2 text-sm" style={{ color: "#5e5c58" }}>
          Are you a venue?{" "}
          <Link href="/venues" style={{ color: "#D4A64F", textDecoration: "underline" }}>
            Sign up here
          </Link>
        </p>
        <p className="text-center mt-3 text-xs" style={{ color: "#5e5c58" }}>
          <Link href="/terms" style={{ color: "#9a9591", textDecoration: "underline" }}>Terms</Link>
          {" "}·{" "}
          <Link href="/privacy" style={{ color: "#9a9591", textDecoration: "underline" }}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
