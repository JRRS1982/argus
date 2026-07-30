// A small, fast, seeded PRNG. Demo data must be identical on every render, request
// and deploy, so Math.random is not an option.
export const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

// Inclusive of both bounds.
export const intBetween = (rand: () => number, min: number, max: number): number =>
  min + Math.floor(rand() * (max - min + 1));

export const pick = <T>(rand: () => number, items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)];
