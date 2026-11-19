import { initialDecisions } from "@/features/consent/purposes";

describe("initialDecisions", () => {
  it("forces core on and optional purposes off for a new user", () => {
    expect(initialDecisions(null)).toEqual({ core: true, ai_copilot: false, push: false, analytics: false });
  });

  it("keeps existing optional grants", () => {
    expect(initialDecisions({ core: false, push: true })).toEqual({ core: true, ai_copilot: false, push: true, analytics: false });
  });
});
