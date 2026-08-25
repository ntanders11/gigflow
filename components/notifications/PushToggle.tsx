"use client";

import { useState, useEffect } from "react";

type Status = "checking" | "unsupported" | "denied" | "off" | "on";

// Return type is deliberately Uint8Array<ArrayBuffer>, not the bare
// Uint8Array TypeScript would otherwise infer (which widens to
// ArrayBufferLike) — since TS 5.7, pushManager.subscribe()'s
// applicationServerKey option requires ArrayBufferView<ArrayBuffer>
// specifically, and the wider type fails tsc. Confirmed against this
// project's actual TypeScript version.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        setStatus(existing ? "on" : "off");
      } catch {
        setStatus("off");
      }
    })();
  }, []);

  async function handleEnable() {
    setBusy(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      // Wait for the worker to actually become active before subscribing
      // — on a first-ever enable it's still "installing" immediately
      // after register(), and pushManager.subscribe() throws
      // InvalidStateError on a non-active registration in Chrome/Firefox.
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = subscription.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) {
        setError("Couldn't save your device — please try again.");
        return;
      }
      setStatus("on");
    } catch {
      setError("Couldn't enable notifications — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setStatus("off");
    } catch {
      setError("Couldn't disable notifications — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") return null;

  return (
    <div
      className="rounded-lg px-3 py-2 mt-2"
      style={{ backgroundColor: "#1e2128" }}
    >
      <div className="flex items-center justify-between">
        <div style={{ color: "#F4E8D2", fontSize: "12px", fontWeight: 500 }}>Phone notifications</div>
        {status === "unsupported" && <span style={{ color: "#5e5c58", fontSize: "10px" }}>Not available</span>}
        {status === "denied" && <span style={{ color: "#5e5c58", fontSize: "10px" }}>Blocked</span>}
        {(status === "off" || status === "on") && (
          <button
            onClick={status === "on" ? handleDisable : handleEnable}
            disabled={busy}
            className="text-xs px-2.5 py-1 rounded font-semibold transition-all hover:brightness-110"
            style={{
              backgroundColor: status === "on" ? "rgba(255,255,255,0.04)" : "#D4A64F",
              color: status === "on" ? "#9a9591" : "#0E0E10",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "…" : status === "on" ? "Disable" : "Enable"}
          </button>
        )}
      </div>
      {status === "unsupported" && (
        <p style={{ color: "#5e5c58", fontSize: "10px", marginTop: "4px" }}>
          Not available in this browser. On iPhone: add StageReach to your home screen first (Share → Add to Home Screen), then try again from there.
        </p>
      )}
      {status === "denied" && (
        <p style={{ color: "#5e5c58", fontSize: "10px", marginTop: "4px" }}>
          Notifications were blocked. Check your phone or browser&apos;s notification settings for StageReach to turn them back on.
        </p>
      )}
      {error && <p style={{ color: "#e25c5c", fontSize: "10px", marginTop: "4px" }}>{error}</p>}
    </div>
  );
}
