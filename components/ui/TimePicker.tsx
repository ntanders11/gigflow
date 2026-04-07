"use client";

import { useRef, useEffect, useState } from "react";

const ITEM_H = 44;
const HOURS   = ["1","2","3","4","5","6","7","8","9","10","11","12"];
const MINUTES = ["00","15","30","45"];
const PERIODS = ["AM","PM"];

function ScrollCol({
  items,
  value,
  onChange,
  width = 48,
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const internal = useRef(false);

  const idx = Math.max(0, items.indexOf(value));

  // Init scroll position
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = idx * ITEM_H;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync when parent changes value externally
  useEffect(() => {
    if (internal.current) return;
    ref.current?.scrollTo({ top: idx * ITEM_H, behavior: "smooth" });
  }, [value, idx]);

  function handleScroll() {
    if (!ref.current) return;
    internal.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!ref.current) return;
      const snapped = Math.round(ref.current.scrollTop / ITEM_H);
      const clamped = Math.max(0, Math.min(snapped, items.length - 1));
      // Snap
      ref.current.scrollTo({ top: clamped * ITEM_H, behavior: "smooth" });
      if (items[clamped] !== value) onChange(items[clamped]);
      setTimeout(() => { internal.current = false; }, 200);
    }, 80);
  }

  return (
    <div style={{ position: "relative", width }}>
      {/* Selection highlight */}
      <div
        style={{
          position: "absolute",
          top: ITEM_H * 2,
          left: 2,
          right: 2,
          height: ITEM_H,
          backgroundColor: "rgba(255,255,255,0.07)",
          borderRadius: 8,
          pointerEvents: "none",
          zIndex: 1,
        }}
      />
      {/* Top fade */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: ITEM_H * 1.5,
        background: "linear-gradient(to bottom, #1e2128 30%, transparent)",
        pointerEvents: "none", zIndex: 2,
      }} />
      {/* Bottom fade */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: ITEM_H * 1.5,
        background: "linear-gradient(to top, #1e2128 30%, transparent)",
        pointerEvents: "none", zIndex: 2,
      }} />

      <div
        ref={ref}
        className="time-scroll-col"
        onScroll={handleScroll}
        style={{
          height: ITEM_H * 5,
          overflowY: "scroll",
          scrollSnapType: "y mandatory",
          paddingTop: ITEM_H * 2,
          paddingBottom: ITEM_H * 2,
          scrollbarWidth: "none",
        }}
      >
        {items.map((item) => {
          const selected = item === value;
          return (
            <div
              key={item}
              onClick={() => {
                onChange(item);
                const i = items.indexOf(item);
                ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" });
              }}
              style={{
                height: ITEM_H,
                scrollSnapAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: selected ? "#f0ede8" : "#5e5c58",
                fontSize: selected ? "20px" : "15px",
                fontWeight: selected ? 600 : 400,
                userSelect: "none",
                transition: "color 0.15s, font-size 0.15s",
                position: "relative",
                zIndex: 3,
              }}
            >
              {item}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  value: string;       // HH:MM 24-hour, or ""
  onChange: (v: string) => void;
  onBlur?: () => void;
}

function parse(v: string) {
  if (!v) return { h: "7", m: "00", p: "PM" };
  const [hStr, mStr] = v.split(":");
  const h24 = parseInt(hStr) || 0;
  const raw = parseInt(mStr) || 0;
  // Snap minute to nearest 15
  const snapped = Math.round(raw / 15) * 15;
  const mSnapped = String(snapped % 60).padStart(2, "0");
  const p = h24 >= 12 ? "PM" : "AM";
  const h12 = (h24 % 12) || 12;
  return { h: String(h12), m: mSnapped, p };
}

function toHHMM(h: string, m: string, p: string) {
  let h24 = parseInt(h);
  if (p === "AM" && h24 === 12) h24 = 0;
  if (p === "PM" && h24 !== 12) h24 += 12;
  return `${String(h24).padStart(2, "0")}:${m}`;
}

export default function TimePicker({ value, onChange, onBlur }: Props) {
  const parsed = parse(value);
  const [h, setH] = useState(parsed.h);
  const [m, setM] = useState(parsed.m);
  const [p, setP] = useState(parsed.p);

  function update(newH: string, newM: string, newP: string) {
    onChange(toHHMM(newH, newM, newP));
  }

  return (
    <div
      onBlur={onBlur}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        backgroundColor: "#1e2128",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 12,
        padding: "6px 10px",
        userSelect: "none",
      }}
    >
      <ScrollCol items={HOURS} value={h} onChange={(v) => { setH(v); update(v, m, p); }} width={44} />
      <span style={{ color: "#5e5c58", fontSize: 22, fontWeight: 700, marginBottom: 2 }}>:</span>
      <ScrollCol items={MINUTES} value={m} onChange={(v) => { setM(v); update(h, v, p); }} width={44} />
      <ScrollCol items={PERIODS} value={p} onChange={(v) => { setP(v); update(h, m, v); }} width={44} />
    </div>
  );
}
