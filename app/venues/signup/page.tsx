"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VenueMatchCandidate } from "@/types";

type Step = 1 | 2 | 3 | 4;

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#F4E8D2",
};
const labelStyle = { color: "#9a9591" };

function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {[1, 2, 3, 4].map((s) => (
        <div
          key={s}
          className="h-1 flex-1 rounded-full transition-colors duration-300"
          style={{ backgroundColor: s <= step ? "#D4A64F" : "#262b33" }}
        />
      ))}
      <span className="text-xs ml-3 shrink-0" style={{ color: "#9a9591" }}>
        Step {step} of 4
      </span>
    </div>
  );
}

export default function VenueSignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // Step 1
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2 (search)
  const [searchName, setSearchName] = useState("");
  const [searchCity, setSearchCity] = useState("");
  const [candidates, setCandidates] = useState<VenueMatchCandidate[]>([]);
  const [searched, setSearched] = useState(false);

  // Step 3/4 (profile form — pre-filled if claiming, blank if fresh)
  const [venueName, setVenueName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [venueType, setVenueType] = useState("");
  const [description, setDescription] = useState("");
  const [genres, setGenres] = useState("");
  const [stageEquipment, setStageEquipment] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // If a venue already created their account (step 1) but never finished
  // the wizard, proxy.ts will route them back here on their next visit.
  // Re-running signUp() for an already-registered email would just error
  // with no way forward, so check for an existing blank venue_profiles
  // row on mount and skip straight to step 2 if one exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/venue-profile");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && !data?.venue_name) {
            setStep(2);
          }
        }
      } catch {
        // No connectivity to check — fall back to showing step 1 as normal.
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const supabase = createClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/venues/signup` },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      const res = await fetch("/api/venue-profile", { method: "POST" });
      if (!res.ok) {
        setError("Something went wrong setting up your account — please try again.");
        return;
      }

      setStep(2);
    } catch {
      setError("Something went wrong — please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!searchName.trim()) return;

    setSaving(true);
    try {
      const params = new URLSearchParams({ name: searchName.trim() });
      if (searchCity.trim()) params.append("city", searchCity.trim());

      const res = await fetch(`/api/venues/search-existing?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't search right now — please try again.");
        return;
      }

      const data = await res.json();
      setCandidates(data.candidates ?? []);
      setSearched(true);
    } catch {
      setError("Couldn't search right now — please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function claimCandidate(candidate: VenueMatchCandidate) {
    setVenueName(candidate.name);
    setCity(candidate.city ?? "");
    setAddress(candidate.address ?? "");
    setVenueType(candidate.venue_type ?? "");
    setStep(4);
  }

  function startFresh() {
    setVenueName(searchName);
    setCity(searchCity);
    setStep(4);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!venueName.trim()) {
      setError("Venue name is required.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/venue-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_name: venueName.trim(),
          city: city.trim() || null,
          address: address.trim() || null,
          venue_type: venueType.trim() || null,
          description: description.trim() || null,
          genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
          stage_equipment: stageEquipment.trim() || null,
          contact_email: contactEmail.trim() || null,
          contact_phone: contactPhone.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't save your profile — please try again.");
        return;
      }

      router.push("/venue/profile");
    } catch {
      setError("Couldn't save your profile — please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ backgroundColor: "#0E0E10" }}>
        <p className="text-sm" style={labelStyle}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-md w-full">
        <ProgressBar step={step} />

        {error && (
          <p className="text-sm mb-4 px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(226,92,92,0.1)", color: "#e25c5c" }}>
            {error}
          </p>
        )}

        {step === 1 && (
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <h1 className="text-xl font-bold mb-1" style={{ color: "#F4E8D2" }}>Set up your venue</h1>
            <p className="text-sm mb-4" style={labelStyle}>No invite code needed — just create a login.</p>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Password</label>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <button type="submit" disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Creating account…" : "Continue"}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleSearch} className="space-y-4">
            <h1 className="text-xl font-bold mb-1" style={{ color: "#F4E8D2" }}>Is your venue already here?</h1>
            <p className="text-sm mb-4" style={labelStyle}>
              Artists may have already added your venue. Search to check before creating a new listing.
            </p>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Venue name</label>
              <input required minLength={2} value={searchName} onChange={(e) => setSearchName(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>City (optional)</label>
              <input value={searchCity} onChange={(e) => setSearchCity(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <button type="submit" disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Searching…" : "Search"}
            </button>

            {searched && (
              <div className="pt-2 space-y-2">
                {candidates.filter((c) => c.status === "claimable").length === 0 && (
                  <p className="text-xs" style={labelStyle}>No matches found.</p>
                )}
                {candidates.map((c) => (
                  <div key={`${c.name}-${c.city}`} className="rounded-lg px-3 py-2.5 flex items-center justify-between gap-2"
                    style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="min-w-0">
                      <p className="text-sm truncate" style={{ color: "#F4E8D2" }}>{c.name}</p>
                      <p className="text-xs truncate" style={labelStyle}>{[c.venue_type, c.city].filter(Boolean).join(" · ")}</p>
                    </div>
                    {c.status === "claimable" ? (
                      <button type="button" onClick={() => claimCandidate(c)}
                        className="text-xs px-2.5 py-1 rounded font-semibold shrink-0 transition-all hover:brightness-110"
                        style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}>
                        This is me
                      </button>
                    ) : (
                      <span className="text-xs shrink-0" style={{ color: "#5e5c58" }}>Already claimed</span>
                    )}
                  </div>
                ))}
                <button type="button" onClick={startFresh}
                  className="w-full py-2 rounded-lg text-xs font-medium transition-all hover:brightness-110 mt-2"
                  style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "#9a9591" }}>
                  None of these are me — create a new listing
                </button>
              </div>
            )}
          </form>
        )}

        {step === 4 && (
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <h1 className="text-xl font-bold mb-1" style={{ color: "#F4E8D2" }}>Tell artists about your venue</h1>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Venue name</label>
              <input required value={venueName} onChange={(e) => setVenueName(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1.5" style={labelStyle}>City</label>
                <input value={city} onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={labelStyle}>Venue type</label>
                <input value={venueType} onChange={(e) => setVenueType(e.target.value)} placeholder="Bar, brewery, winery…"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Description</label>
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Genres you book (comma-separated)</label>
              <input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="rock, jazz, acoustic"
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Stage & equipment</label>
              <textarea rows={2} value={stageEquipment} onChange={(e) => setStageEquipment(e.target.value)} placeholder="PA system, stage size, backline…"
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1.5" style={labelStyle}>Contact email</label>
                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={labelStyle}>Contact phone</label>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
            </div>
            <button type="submit" disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : "Finish Setup"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
