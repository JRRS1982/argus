import { describe, it, expect } from "vitest";
import { mulberry32, pick, intBetween } from "@/lib/demo/random";

describe("mulberry32", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces a different sequence for a different seed", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it("stays within [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      const n = r();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe("intBetween", () => {
  it("stays within the inclusive bounds", () => {
    const r = mulberry32(3);
    for (let i = 0; i < 500; i += 1) {
      const n = intBetween(r, 2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("returns the bound when min equals max", () => {
    expect(intBetween(mulberry32(1), 4, 4)).toBe(4);
  });
});

describe("pick", () => {
  it("always returns a member of the list", () => {
    const r = mulberry32(9);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i += 1) {
      expect(items).toContain(pick(r, items));
    }
  });
});
