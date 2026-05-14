// app/signup/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type CodeStatus = "idle" | "checking" | "valid" | "invalid";

export default function SignupPage() {
  const router = useRouter();
  const [code, setCode]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [codeStatus, setCodeStatus] = useState<CodeStatus>("idle");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  // Validate invite code on blur
  async function handleCodeBlur() {
    if (!code.trim()) return;
    setCodeStatus("checking");
    try {
      const res = await fetch("/api/auth/validate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      setCodeStatus(data.valid ? "valid" : "invalid");
    } catch {
      setCodeStatus("invalid");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Re-validate code before submitting
    if (codeStatus !== "valid") {
      const res = await fetch("/api/auth/validate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!data.valid) {
        setCodeStatus("invalid");
        setError("Invalid invite code.");
        return;
      }
      setCodeStatus("valid");
    }

    setLoading(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({ email, password });

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
    color: "#f0ede8",
  };
  const focusBorder = "rgba(212,168,83,0.5)";

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#0e0f11" }}
    >
      <div
        className="rounded-xl p-8 w-full max-w-sm"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="mb-8">
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.75rem", color: "#d4a853", lineHeight: 1.2 }}>
            GigFlow
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#9a9591" }}>Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Invite Code */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#9a9591" }}>
              Invite Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeStatus("idle"); }}
              onBlur={handleCodeBlur}
              required
              placeholder="GIGFLOW-BETA-01"
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{
                ...inputStyle,
                borderColor: codeStatus === "valid" ? "rgba(76,175,125,0.5)"
                           : codeStatus === "invalid" ? "rgba(226,92,92,0.5)"
                           : "rgba(255,255,255,0.07)",
                letterSpacing: "0.05em",
              }}
              onFocus={(e) => (e.target.style.borderColor = focusBorder)}
            />
            {codeStatus === "valid" && (
              <p className="text-xs mt-1" style={{ color: "#4caf7d" }}>✓ Valid invite code</p>
            )}
            {codeStatus === "invalid" && (
              <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>Invalid invite code</p>
            )}
          </div>

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

          {error && (
            <p className="text-sm rounded-lg px-3 py-2" style={{ color: "#e25c5c", backgroundColor: "rgba(226,92,92,0.1)", border: "1px solid rgba(226,92,92,0.2)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
          >
            {loading ? "Creating account…" : "Create Account →"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: "#5e5c58" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "#d4a853", textDecoration: "underline" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
