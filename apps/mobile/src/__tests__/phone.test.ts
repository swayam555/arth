import { formatIndianMobile, normalizeIndianMobile } from "@/features/auth/phone";

describe("normalizeIndianMobile", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
  ])("accepts %s", (input, expected) => expect(normalizeIndianMobile(input)).toBe(expected));

  it.each(["5876543210", "987654321", "98765432101", "", "+1 415 555 0100"])("rejects %s", (input) =>
    expect(normalizeIndianMobile(input)).toBeNull(),
  );

  it("formats for display", () => expect(formatIndianMobile("+919876543210")).toBe("+91 98765 43210"));
});
