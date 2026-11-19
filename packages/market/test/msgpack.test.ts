import { describe, expect, it } from "vitest";
import { pack } from "msgpackr";
import { decodeMsgpack } from "../src/msgpack.js";

const cases: [string, unknown][] = [
  ["fixint", 7],
  ["negative fixint", -5],
  ["uint8", 200],
  ["uint16", 60_000],
  ["uint32", 4_000_000_000],
  ["int8", -100],
  ["int16", -30_000],
  ["int32", -2_000_000_000],
  ["float64", 1234.55],
  ["large ts", 1_763_539_200_123],
  ["nil", null],
  ["bools", [true, false]],
  ["fixstr", "RELIANCE"],
  ["str8", "x".repeat(200)],
  ["str16", "y".repeat(70_000)],
  ["unicode", "₹ अर्थ 📈"],
  ["map", { RELIANCE: 0, TCS: 1, "M&M": 2 }],
  ["array16", Array.from({ length: 300 }, (_, i) => i)],
  ["delta frame", [1, 42, [[3, 1421.35, 120_394, 1430.1, 1410, 1_763_539_200_123]]]],
];

describe("decodeMsgpack", () => {
  it.each(cases)("round-trips %s", (_name, value) => {
    expect(decodeMsgpack(pack(value))).toEqual(value);
  });

  it("decodes a large map (map16)", () => {
    const value = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`S${i}`, i]));
    expect(decodeMsgpack(pack(value))).toEqual(value);
  });

  it("rejects truncated input", () => {
    const bytes = pack([1, 2, 3]);
    expect(() => decodeMsgpack(bytes.subarray(0, bytes.length - 1))).toThrow(RangeError);
  });

  it("rejects trailing bytes", () => {
    const bytes = new Uint8Array([...pack(1), 0x01]);
    expect(() => decodeMsgpack(bytes)).toThrow(/trailing/);
  });
});
