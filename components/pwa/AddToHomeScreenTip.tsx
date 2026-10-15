"use client";

import { useSyncExternalStore } from "react";
import { detectInstallPlatform, InstallPlatform } from "@/lib/pwa/detect-platform";

function subscribe() {
  return () => {};
}

function getSnapshot(): InstallPlatform {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints, standalone);
}

const STEPS: Record<"ios" | "android", string[]> = {
  ios: [
    "Tap the Share button (the square with an arrow pointing up) at the bottom of Safari.",
    "Scroll down and tap \"Add to Home Screen\".",
    "Tap \"Add\". StageReach now shows up on your phone like any other app.",
  ],
  android: [
    "Tap the menu button (three dots) in the top corner of Chrome.",
    "Tap \"Add to Home screen\" (or \"Install app\").",
    "Tap \"Add\" or \"Install\". StageReach now shows up on your phone like any other app.",
  ],
};

// Shown only on phones/tablets that haven't installed the app yet. Renders
// nothing on desktop, and nothing during server render (the snapshot is null
// there), so it can't cause a hydration mismatch.
export default function AddToHomeScreenTip() {
  const platform = useSyncExternalStore(subscribe, getSnapshot, () => null);
  if (!platform) return null;

  return (
    <div
      className="rounded-lg p-4 mt-5 text-left"
      style={{ backgroundColor: "rgba(212,166,79,0.08)", border: "1px solid rgba(212,166,79,0.25)" }}
    >
      <p className="text-sm font-semibold mb-1" style={{ color: "#D4A64F" }}>
        Add StageReach to your phone
      </p>
      <p className="text-xs mb-3" style={{ color: "#9a9591", lineHeight: 1.6 }}>
        It opens full-screen like an app{platform === "ios" ? ", and on iPhone it's the only way to get alerts for new booking requests and messages" : ""}.
      </p>
      <ol className="text-xs space-y-1.5" style={{ color: "#F4E8D2", lineHeight: 1.6, paddingLeft: "18px", listStyle: "decimal" }}>
        {STEPS[platform].map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
