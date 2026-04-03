"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      style={{ backgroundColor: "#0e0f11" }}
    >
      <div
        className="rounded-xl p-8 w-full max-w-sm"
        style={{
          backgroundColor: "#16181c",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="mb-8">
          <h1
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: "1.75rem",
              color: "#d4a853",
              lineHeight: 1.2,
            }}
          >
            GigFlow
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#9a9591" }}>
            Sign in to your account
          </p>
        </div>

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
                color: "#f0ede8",
              }}
              placeholder="you@example.com"
              onFocus={(e) => {
                (e.target as HTMLInputElement).style.borderColor =
                  "rgba(212,168,83,0.5)";
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
                color: "#f0ede8",
              }}
              placeholder="••••••••"
              onFocus={(e) => {
                (e.target as HTMLInputElement).style.borderColor =
                  "rgba(212,168,83,0.5)";
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
              backgroundColor: "#d4a853",
              color: "#0e0f11",
            }}
            onMouseEnter={(e) => {
              if (!loading)
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "#c49840";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "#d4a853";
            }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
