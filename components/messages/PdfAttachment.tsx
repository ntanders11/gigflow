"use client";

import { useEffect, useRef, useState } from "react";

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const THUMB_WIDTH = 240;

// Shows the first page of a PDF as a small picture inside the thread,
// with the file name and size underneath. Tapping it opens the full PDF in
// a new tab. If the preview can't be drawn for any reason (an odd or
// password-protected PDF, a blocked download), it quietly falls back to the
// plain file chip that was here before, so a PDF is never unreachable.
//
// The thread re-fetches every 15 seconds and each fetch hands back brand-new
// signed links, so the preview is keyed on the message id, not the link —
// otherwise every poll would redraw it. The latest link is read from a ref
// only when the preview actually has to download the file.
export default function PdfAttachment({
  messageId,
  attachment,
}: {
  messageId: string;
  attachment: { name: string; size: number; url: string };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const urlRef = useRef(attachment.url);
  urlRef.current = attachment.url;
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;

    (async () => {
      try {
        // Loaded only when a PDF message is actually on screen, and only in
        // the browser — the library needs browser-only APIs.
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

        const loadingTask = pdfjs.getDocument({ url: urlRef.current });
        task = loadingTask;
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        if (cancelled) return;

        const base = page.getViewport({ scale: 1 });
        const scale = (THUMB_WIDTH / base.width) * Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${THUMB_WIDTH}px`;
        canvas.style.height = `${Math.round((THUMB_WIDTH / base.width) * base.height)}px`;

        await page.render({ canvas, viewport }).promise;
        if (!cancelled) setState("ready");
      } catch (err) {
        if (!cancelled) {
          console.warn("PdfAttachment: could not draw a preview", err);
          setState("failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      task?.destroy().catch(() => {});
    };
  }, [messageId]);

  if (state === "failed") {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 mb-1 underline"
        style={{ backgroundColor: "rgba(0,0,0,0.15)" }}
      >
        <span>📄</span>
        <span className="truncate">{attachment.name}</span>
        <span className="text-xs opacity-70 shrink-0">{fmtSize(attachment.size)}</span>
      </a>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="block mb-1"
      aria-label={`Open ${attachment.name} (PDF, ${fmtSize(attachment.size)})`}
    >
      <div
        className="rounded-lg overflow-hidden bg-white relative"
        style={{ width: `${THUMB_WIDTH}px`, maxWidth: "100%", minHeight: state === "loading" ? "120px" : undefined }}
      >
        <canvas ref={canvasRef} className="block" style={{ maxWidth: "100%", height: "auto" }} />
        {state === "loading" && (
          <span className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: "#5e5c58" }}>
            Loading preview…
          </span>
        )}
      </div>
      <span className="flex items-center gap-2 mt-1 text-xs">
        <span>📄</span>
        <span className="truncate underline">{attachment.name}</span>
        <span className="opacity-70 shrink-0">{fmtSize(attachment.size)}</span>
      </span>
    </a>
  );
}
