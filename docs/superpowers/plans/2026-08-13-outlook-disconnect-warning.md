# Outlook Disconnect Calendar-Sync Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn an artist, before it happens, that disconnecting Outlook on the Connected Accounts card also turns off their gig calendar sync — using the app's existing inline confirm-step pattern, not a new interaction style.

**Architecture:** One new piece of local state (`confirmingDisconnect`) tracks whether the Outlook row is mid-confirmation. The Outlook row's Disconnect button gets a third visual state (mirroring `DeleteInvoiceButton`'s `confirming` pattern exactly) that shows the warning plus Yes/Cancel buttons before actually disconnecting. Gmail's row and the underlying `disconnectAccount` function are untouched.

**Tech Stack:** Next.js App Router, React (client component), TypeScript.

**No automated test suite exists in this project** (confirmed in `CLAUDE.md`). Verification is `npx tsc --noEmit` / `npx eslint <file>`, plus a manual browser check.

---

### Task 1: Add the confirm step to Outlook's Disconnect button

**Files:**
- Modify: `app/(protected)/artist-profile/page.tsx`

- [ ] **Step 1: Add the new state**

Find the existing connection-related state declarations (`connections`, `connectionsLoading`, `connectBanner`) and add one more alongside them:

```typescript
const [confirmingDisconnect, setConfirmingDisconnect] = useState<"outlook" | null>(null);
```

- [ ] **Step 2: Replace the Disconnect/Connect render logic**

Find this existing block, inside the `(["gmail", "outlook"] as const).map((provider) => { ... })` render body (the part that renders either a "Disconnect" button or a "Connect" link for each provider row):

```tsx
                      {connection && connection.status === "active" ? (
                        <button
                          onClick={() => disconnectAccount(provider)}
                          className="text-xs px-2.5 py-1 rounded transition-all hover:brightness-125"
                          style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "#9a9591", cursor: "pointer" }}
                        >
                          Disconnect
                        </button>
                      ) : (
                        // Covers both "never connected" and "needs_reconnect" — in the
                        // latter case, clicking Connect re-runs the OAuth flow and the
                        // callback's upsert resets status back to 'active'.
                        <a
                          href={`/api/auth/${provider}/connect`}
                          className="text-xs px-2.5 py-1 rounded font-semibold transition-all hover:brightness-110 inline-block"
                          style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
                        >
                          Connect
                        </a>
                      )}
```

Replace it with:

```tsx
                      {connection && connection.status === "active" ? (
                        provider === "outlook" && confirmingDisconnect === "outlook" ? (
                          <span className="inline-flex items-center gap-2 flex-wrap justify-end">
                            <span className="text-xs" style={{ color: "#e25c5c" }}>
                              This will also stop syncing your gigs to your Outlook calendar. Disconnect anyway?
                            </span>
                            <button
                              onClick={() => {
                                setConfirmingDisconnect(null);
                                disconnectAccount("outlook");
                              }}
                              className="text-xs font-semibold transition-all hover:brightness-125"
                              style={{ color: "#e25c5c", cursor: "pointer" }}
                            >
                              Yes, disconnect
                            </button>
                            <button
                              onClick={() => setConfirmingDisconnect(null)}
                              className="text-xs transition-all hover:brightness-125"
                              style={{ color: "#9a9591", cursor: "pointer" }}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() =>
                              provider === "outlook"
                                ? setConfirmingDisconnect("outlook")
                                : disconnectAccount(provider)
                            }
                            className="text-xs px-2.5 py-1 rounded transition-all hover:brightness-125"
                            style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "#9a9591", cursor: "pointer" }}
                          >
                            Disconnect
                          </button>
                        )
                      ) : (
                        // Covers both "never connected" and "needs_reconnect" — in the
                        // latter case, clicking Connect re-runs the OAuth flow and the
                        // callback's upsert resets status back to 'active'.
                        <a
                          href={`/api/auth/${provider}/connect`}
                          className="text-xs px-2.5 py-1 rounded font-semibold transition-all hover:brightness-110 inline-block"
                          style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
                        >
                          Connect
                        </a>
                      )}
```

What changed, precisely:
- Gmail's behavior is identical to before: clicking "Disconnect" calls `disconnectAccount(provider)` immediately (the ternary's `false` branch for `provider === "outlook"` is exactly the old code, unchanged).
- Outlook's "Disconnect" button now sets `confirmingDisconnect("outlook")` instead of calling `disconnectAccount` directly.
- When `confirmingDisconnect === "outlook"` (only reachable for the Outlook row, since Gmail never sets this state), that row shows the warning text and Yes/Cancel buttons instead of the Disconnect button.
- "Yes, disconnect" resets the confirm state and calls the existing, unmodified `disconnectAccount("outlook")`.
- "Cancel" just resets the confirm state — no network call, no other side effect.
- The `needs_reconnect` / not-connected "Connect" link branch is completely unchanged.

- [ ] **Step 3: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint "app/(protected)/artist-profile/page.tsx"
```

Expected: no errors. (This file has 2 pre-existing warnings — a missing `supabase.auth` effect dependency and an `<img>` LCP hint — unrelated to this change; don't try to fix those.)

- [ ] **Step 4: Manual verification**

With Outlook connected on your account (it already is, from earlier this session), visit the Artist Profile page and:
1. Click "Disconnect" on the Outlook row. Expected: the button is replaced by the warning text ("This will also stop syncing your gigs to your Outlook calendar. Disconnect anyway?") plus "Yes, disconnect" and "Cancel" buttons — Outlook is still shown as connected, nothing has actually changed yet.
2. Click "Cancel". Expected: reverts back to showing the normal "Disconnect" button, Outlook still connected.
3. Click "Disconnect" again, then "Yes, disconnect". Expected: this behaves exactly as disconnecting did before this change — Outlook shows as "Not connected" with a gold "Connect" button.
4. Reconnect Outlook afterward (click "Connect", go through the real OAuth flow) so the account is left in its normal working state.
5. Separately, confirm Gmail's row is completely unaffected: if Gmail is connected, its "Disconnect" button should still disconnect immediately with no confirm step, exactly as before.

- [ ] **Step 5: Commit**

```bash
git add "app/(protected)/artist-profile/page.tsx"
git commit -m "feat: warn before disconnecting Outlook that calendar sync also stops"
```
