"use client";

import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";

interface Props {
  imageSrc: string;
  fileName: string;
  fileType: string;
  onSave: (croppedFile: File) => void;
  onCancel: () => void;
}

async function getCroppedBlob(
  imageSrc: string,
  croppedAreaPixels: Area,
  fileType: string
): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  const size = Math.min(croppedAreaPixels.width, croppedAreaPixels.height);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Draw circular clip
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  ctx.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    size,
    size
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), fileType || "image/jpeg", 0.92);
  });
}

export default function PhotoCropModal({ imageSrc, fileName, fileType, onSave, onCancel }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  async function handleSave() {
    if (!croppedAreaPixels) return;
    setSaving(true);
    const blob = await getCroppedBlob(imageSrc, croppedAreaPixels, fileType);
    const file = new File([blob], fileName, { type: fileType });
    onSave(file);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
    >
      <div
        className="rounded-xl flex flex-col overflow-hidden"
        style={{
          backgroundColor: "#16181c",
          border: "1px solid rgba(255,255,255,0.07)",
          width: "420px",
          maxWidth: "95vw",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div>
            <div style={{ color: "#f0ede8", fontSize: "14px", fontWeight: 600 }}>
              Adjust your photo
            </div>
            <div style={{ color: "#5e5c58", fontSize: "11px", marginTop: "2px" }}>
              Drag to reposition · Pinch or scroll to zoom
            </div>
          </div>
          <button onClick={onCancel} style={{ color: "#5e5c58", fontSize: "20px" }}>×</button>
        </div>

        {/* Cropper */}
        <div style={{ position: "relative", width: "100%", height: "320px", backgroundColor: "#0e0f11" }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Zoom slider */}
        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ color: "#5e5c58", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
            Zoom
          </div>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-yellow-500"
          />
        </div>

        {/* Footer */}
        <div
          className="flex gap-3 px-5 py-4"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg py-2 text-sm transition-all hover:brightness-125"
            style={{ backgroundColor: "#1e2128", color: "#9a9591" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg py-2 text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-50"
            style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
          >
            {saving ? "Saving…" : "Save Photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
