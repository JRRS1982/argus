import { describeProviderContract } from "./contract";
import { createFixtureProvider } from "./fixture";

// Pinned clock: the demo's dates are relative to it, so a fixed instant keeps the run
// reproducible whatever day it executes.
describeProviderContract("fixture", () => createFixtureProvider(42, "2026-10-01T00:00:00.000Z"));
