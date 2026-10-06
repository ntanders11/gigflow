"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ConversationView, ThreadView } from "@/types";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_LENGTH,
  MESSAGE_BUCKET,
  validateAttachmentDeclaration,
} from "@/lib/messages/rules";

const CARD = { backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function MessagesView({
  role,
  initialConversationId,
}: {
  role: "artist" | "venue";
  initialConversationId?: string;
}) {
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/messages/conversations");
    if (res.ok) setConversations((await res.json()).conversations ?? []);
    setLoadingList(false);
  }, []);

  const latestIdRef = useRef<string | null>(initialConversationId ?? null);

  const loadThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/messages/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    // Ignore responses for a conversation that is no longer the active one.
    if (latestIdRef.current === id) setThread(data);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    latestIdRef.current = activeId;
    setThread(null);
    setDraft("");
    setFile(null);
    setError("");
    setMenuOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (activeId) loadThread(activeId);
  }, [activeId, loadThread]);

  // Simple polling — no realtime connection. Only while the tab is visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadList();
      if (activeId) loadThread(activeId);
    }, 15000);
    return () => clearInterval(t);
  }, [activeId, loadList, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  function pickFile(f: File | null) {
    setError("");
    if (!f) { setFile(null); return; }
    const check = validateAttachmentDeclaration(f.type, f.size);
    if (!check.ok) { setError(check.error); setFile(null); return; }
    setFile(f);
  }

  async function send() {
    if (!activeId || sending) return;
    if (!draft.trim() && !file) return;
    setError("");
    setSending(true);
    try {
      let attachment: { path: string; name: string; type: string; size: number } | null = null;
      if (file) {
        const prep = await fetch(`/api/messages/conversations/${activeId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
        });
        const prepJson = await prep.json();
        if (!prep.ok) throw new Error(prepJson.error ?? "Couldn't upload that file.");
        const { error: upErr } = await createClient()
          .storage.from(MESSAGE_BUCKET)
          .uploadToSignedUrl(prepJson.path, prepJson.token, file, { contentType: file.type });
        if (upErr) throw new Error("Couldn't upload that file. Try again.");
        attachment = { path: prepJson.path, name: file.name, type: file.type, size: file.size };
      }
      const res = await fetch(`/api/messages/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft, attachment }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't send that message.");
      setDraft("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await Promise.all([loadThread(activeId), loadList()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that message.");
    } finally {
      setSending(false);
    }
  }

  async function toggleBlock() {
    if (!activeId || !thread) return;
    setMenuOpen(false);
    const res = await fetch(`/api/messages/conversations/${activeId}/block`, {
      method: thread.blocked_by_me ? "DELETE" : "POST",
    });
    if (!res.ok) { setError((await res.json()).error ?? "Something went wrong."); return; }
    await Promise.all([loadThread(activeId), loadList()]);
  }

  async function report(messageId: string) {
    if (!activeId) return;
    const reason = window.prompt("What's wrong with this message? (optional)") ?? "";
    const res = await fetch(`/api/messages/conversations/${activeId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId, reason }),
    });
    setError(res.ok ? "" : ((await res.json()).error ?? "Couldn't send that report."));
    if (res.ok) window.alert("Thanks — we've been notified and will take a look.");
  }

  const showThread = !!activeId;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 max-w-6xl">
      {/* Conversation list — hidden on mobile while a thread is open */}
      <div className={`${showThread ? "hidden md:block" : "block"} rounded-xl overflow-hidden`} style={CARD}>
        {loadingList ? (
          <p className="p-5 text-sm" style={{ color: "#9a9591" }}>Loading…</p>
        ) : conversations.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: "#F4E8D2" }}>No messages yet</p>
            <p className="text-xs" style={{ color: "#9a9591" }}>
              {role === "venue"
                ? "Open an artist's profile and tap Message to start a conversation."
                : "When a venue messages you, the conversation will show up here."}
            </p>
          </div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 transition-all hover:brightness-125"
              style={{
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                backgroundColor: c.id === activeId ? "rgba(212,166,79,0.08)" : "transparent",
              }}
            >
              <div
                className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold overflow-hidden"
                style={{ backgroundColor: "#1e2128", color: "#D4A64F" }}
              >
                {c.counterpart_photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.counterpart_photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  c.counterpart_name.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm truncate" style={{ color: "#F4E8D2", fontWeight: c.unread_count > 0 ? 700 : 500 }}>
                    {c.counterpart_name}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: "#5e5c58" }}>{fmtTime(c.last_message_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate" style={{ color: "#9a9591" }}>{c.last_message_preview || "No messages yet"}</span>
                  {c.unread_count > 0 && (
                    <span className="shrink-0 rounded-full text-xs font-bold px-1.5" style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}>
                      {c.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Thread */}
      <div className={`${showThread ? "flex" : "hidden md:flex"} flex-col rounded-xl overflow-hidden min-h-[60vh]`} style={CARD}>
        {!thread ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-sm" style={{ color: "#5e5c58" }}>{activeId ? "Loading…" : "Select a conversation"}</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <button onClick={() => setActiveId(null)} className="md:hidden text-sm" style={{ color: "#D4A64F" }} aria-label="Back to conversations">←</button>
              <Link href={thread.conversation.counterpart_href} className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: "#F4E8D2" }}>
                {thread.conversation.counterpart_name}
              </Link>
              <div className="relative">
                <button onClick={() => setMenuOpen((o) => !o)} className="px-2 text-lg" style={{ color: "#9a9591" }} aria-label="Conversation options">⋯</button>
                {menuOpen && (
                  <div className="absolute right-0 mt-1 rounded-lg z-10 py-1 min-w-[160px]" style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <button onClick={toggleBlock} className="w-full text-left px-3 py-2 text-sm" style={{ color: "#e25c5c" }}>
                      {thread.blocked_by_me ? "Unblock" : "Block"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {thread.booking && (
              <div className="px-4 py-2 text-xs" style={{ backgroundColor: "rgba(212,166,79,0.08)", color: "#D4A64F" }}>
                Booking request for {new Date(thread.booking.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {thread.booking.status}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-h-[55vh]">
              {thread.messages.map((m) => (
                <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className="rounded-2xl px-3 py-2 max-w-[80%] text-sm"
                    style={{ backgroundColor: m.mine ? "#D4A64F" : "#1e2128", color: m.mine ? "#0E0E10" : "#F4E8D2" }}
                  >
                    {m.attachment && (
                      m.attachment.type.startsWith("image/") ? (
                        <a href={m.attachment.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.attachment.url} alt={m.attachment.name} className="rounded-lg mb-1 max-h-60" />
                        </a>
                      ) : (
                        <a
                          href={m.attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5 mb-1 underline"
                          style={{ backgroundColor: "rgba(0,0,0,0.15)" }}
                        >
                          <span>📄</span>
                          <span className="truncate">{m.attachment.name}</span>
                          <span className="text-xs opacity-70 shrink-0">{fmtSize(m.attachment.size)}</span>
                        </a>
                      )
                    )}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    <p className="text-[10px] mt-1 opacity-60 flex items-center gap-2">
                      {fmtTime(m.created_at)}
                      {!m.mine && (
                        <button onClick={() => report(m.id)} className="underline" aria-label="Report this message">Report</button>
                      )}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              {error && <p className="text-xs mb-2" style={{ color: "#e25c5c" }}>{error}</p>}
              {thread.conversation.blocked ? (
                <p className="text-xs text-center py-2" style={{ color: "#9a9591" }}>
                  {thread.blocked_by_me ? "You've blocked this conversation. Unblock it from the ⋯ menu to send messages." : "You can't send messages in this conversation."}
                </p>
              ) : (
                <>
                  {file && (
                    <div className="flex items-center gap-2 text-xs mb-2" style={{ color: "#F4E8D2" }}>
                      <span className="truncate">📎 {file.name} ({fmtSize(file.size)})</span>
                      <button onClick={() => { pickFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ color: "#9a9591" }} aria-label="Remove attachment">✕</button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
                      className="hidden"
                      onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="shrink-0 rounded-lg px-3 py-2 text-lg"
                      style={{ backgroundColor: "#1e2128", color: "#9a9591", minHeight: "44px" }}
                      aria-label={`Attach a file (images or PDF, up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`}
                    >
                      📎
                    </button>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      maxLength={MAX_BODY_LENGTH}
                      rows={1}
                      placeholder="Write a message"
                      className="flex-1 rounded-lg px-3 py-2 text-sm resize-none"
                      style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2", minHeight: "44px" }}
                    />
                    <button
                      onClick={send}
                      disabled={sending || (!draft.trim() && !file)}
                      className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
                      style={{ backgroundColor: "#D4A64F", color: "#0E0E10", minHeight: "44px" }}
                    >
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
