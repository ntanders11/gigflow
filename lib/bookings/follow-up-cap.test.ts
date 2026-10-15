import { describe, it, expect } from "vitest";
import { pickDailyBatch } from "./follow-up-cap";

const mk = (user_id: string, n: number) => ({
  user_id,
  id: `${user_id}-${n}`,
  last_contacted_at: `2026-09-${String(n).padStart(2, "0")}T00:00:00Z`,
});

describe("pickDailyBatch", () => {
  it("caps each artist separately", () => {
    const venues = [
      ...Array.from({ length: 15 }, (_, i) => mk("a", i + 1)),
      ...Array.from({ length: 3 }, (_, i) => mk("b", i + 1)),
    ];
    const batch = pickDailyBatch(venues, 10);
    expect(batch.filter((v) => v.user_id === "a")).toHaveLength(10);
    expect(batch.filter((v) => v.user_id === "b")).toHaveLength(3);
  });
  it("takes the longest-waiting venues first", () => {
    const venues = [mk("a", 9), mk("a", 2), mk("a", 5)];
    expect(pickDailyBatch(venues, 2).map((v) => v.id)).toEqual(["a-2", "a-5"]);
  });
  it("handles an empty list", () => {
    expect(pickDailyBatch([])).toEqual([]);
  });
});
