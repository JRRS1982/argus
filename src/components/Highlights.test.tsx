// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import Highlights from "@/components/Highlights";

// Without this, renders accumulate in the same document and text queries match across tests.
afterEach(cleanup);

describe("Highlights", () => {
  // Regression coverage for the crash a failed /api/insights fetch used to cause:
  // Dashboard used to store the error body (`{ error: "..." }`) as if it were an
  // InsightsResponse, and this component would dereference `insights.prsCreated`
  // on it. With the fetch guard in Dashboard.tsx, a failed fetch now leaves
  // `insights` null instead — this asserts that null renders nothing, never throws.
  it("renders nothing when insights is null, instead of throwing", () => {
    const { container } = render(<Highlights insights={null} />);
    expect(container.firstChild).toBeNull();
  });
});
