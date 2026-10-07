import { describe, it, expect } from "vitest";
import { normaliseKey, findLinkTarget } from "@/lib/analytics/linking";

describe("normaliseKey", () => {
  it("lower-cases and strips separators", () => {
    expect(normaliseKey("Chameleon-Gateway")).toBe("chameleongateway");
    expect(normaliseKey("minimise_renders_poc")).toBe("minimiserenderspoc");
    expect(normaliseKey("  Repo A  ")).toBe("repoa");
  });
});

describe("findLinkTarget", () => {
  const services = [
    { id: 1, name: "benchmarkmeapp" },
    { id: 2, name: "chameleon-gateway" },
    { id: 3, name: "chameleon-qa" },
  ];

  it("links on an exact normalised match", () => {
    expect(findLinkTarget(services, "Chameleon_Gateway")?.id).toBe(2);
  });

  it("returns null when nothing matches", () => {
    // chameleon-acceptance-tests is a DIFFERENT repo from chameleon-qa, confirmed by
    // the repo owner. Fuzzy matching would wrongly merge them, so there is none.
    expect(findLinkTarget(services, "chameleon-acceptance-tests")).toBeNull();
  });

  it("does not link a rename — that is the manual merge control's job", () => {
    // benchmarkme vs benchmarkmeapp differ by a suffix. Guessing here risks merging
    // two genuinely different services; the Team tab offers the link instead.
    expect(findLinkTarget(services, "benchmarkme")).toBeNull();
  });

  it("is case-insensitive and separator-insensitive both ways", () => {
    expect(findLinkTarget([{ id: 9, name: "MVF_Data_Stories" }], "mvf-data-stories")?.id).toBe(9);
  });

  it("refuses to pick when two candidates match equally", () => {
    // foo-bar and foo_bar are distinct names that normalise alike. Choosing the first
    // would be a coin-flip merge; a missed link is cheap, a wrong one fuses histories.
    const twins = [{ id: 1, name: "foo-bar" }, { id: 2, name: "foo_bar" }];
    expect(findLinkTarget(twins, "foobar")).toBeNull();
  });

  it("never links on a name that normalises to nothing", () => {
    expect(findLinkTarget([{ id: 1, name: "-" }], "_")).toBeNull();
  });
});
