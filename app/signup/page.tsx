// app/signup/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import CaptchaBox, { captchaRequired } from "@/components/auth/CaptchaBox";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    // emailRedirectTo points at /api/auth/confirm, which exchanges the
    // confirmation link's code for a real session server-side before
    // continuing on to /onboarding — the code in the link isn't usable on
    // its own, it has to be exchanged first (see that route for why).
    // Also needs Site URL set in the Supabase dashboard (Authentication →
    // URL Configuration → stagereach.app), so the link always points to
    // the correct production URL, not localhost.
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/confirm?next=/onboarding`,
        captchaToken: captchaToken ?? undefined,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    router.push("/onboarding");
  }

  const inputStyle = {
    background: "#1e2128",
    border: "1px solid rgba(255,255,255,0.07)",
    color: "#F4E8D2",
  };
  const focusBorder = "rgba(212,166,79,0.5)";

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#0E0E10" }}
    >
      <div
        className="rounded-xl p-8 w-full max-w-sm"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="mb-8">
          <Image
            src="/stagereach-logo.png"
            alt="StageReach"
            width={220}
            height={73}
            style={{ objectFit: "contain", objectPosition: "left", height: "48px", width: "auto" }}
          />
          <p className="mt-2 text-sm" style={{ color: "#9a9591" }}>Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#9a9591" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = focusBorder)}
              onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.07)")}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#9a9591" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              minLength={6}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = focusBorder)}
              onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.07)")}
            />
          </div>

          <CaptchaBox onToken={setCaptchaToken} />

          {error && (
            <p className="text-sm rounded-lg px-3 py-2" style={{ color: "#e25c5c", backgroundColor: "rgba(226,92,92,0.1)", border: "1px solid rgba(226,92,92,0.2)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || (captchaRequired && !captchaToken)}
            className="w-full rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
          >
            {loading ? "Creating account…" : "Create Account →"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: "#5e5c58" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "#D4A64F", textDecoration: "underline" }}>
            Sign in
          </Link>
        </p>
        <p className="text-center mt-3 text-xs" style={{ color: "#5e5c58" }}>
          By creating an account, you agree to our{" "}
          <Link href="/terms" style={{ color: "#9a9591", textDecoration: "underline" }}>Terms</Link>
          {" "}and{" "}
          <Link href="/privacy" style={{ color: "#9a9591", textDecoration: "underline" }}>Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
