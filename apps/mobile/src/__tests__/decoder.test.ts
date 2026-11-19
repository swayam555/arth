import { MsgType } from "@arth/market";
import { encode } from "@msgpack/msgpack";
import { arthDecoder, msgpackDecoder } from "@/features/market/decoder";

const frames = [
  [MsgType.SubAck, 1, { TCS: 0, INFY: 1, "M&M": 2 }],
  [MsgType.Snapshot, 2, [[0, 4012.35, 1_234_567, 4050, 3990.1, 1_763_500_000_000, 3998.4, 4001]]],
  [MsgType.Delta, 3, Array.from({ length: 50 }, (_, i) => [i, 100 + i * 0.05, 10_000 + i, 120, 80, 1_763_500_000_250 + i])],
  [MsgType.Depth, 4, [0, [[4012.3, 120], [4012.25, 80]], [[4012.4, 50]], 1_763_500_000_300]],
  [MsgType.Pong, 5, 1_763_500_000_000],
  [MsgType.Error, 6, { code: "unknown_symbols", message: "NOPE" }],
  [MsgType.Delta, 7, [[0, -1.5, 0, 0, 0, 0], [65_535, 2 ** 40, 2 ** 31, 0.1, -0.1, 2 ** 53 - 1]]],
];

describe("frame decoder", () => {
  it.each(frames.map((f) => [f[0], f] as const))("matches @msgpack/msgpack for type %i", (_, frame) => {
    const bytes = encode(frame);
    expect(arthDecoder(bytes)).toEqual(msgpackDecoder(bytes));
    expect(arthDecoder(bytes.slice().buffer)).toEqual(frame);
  });

  it("decodes a 50-row delta frame fast enough for the JS thread", () => {
    const bytes = encode(frames[2]);
    const time = (fn: () => void, n: number) => {
      for (let i = 0; i < 500; i++) fn();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) fn();
      return ((performance.now() - t0) / n) * 1_000;
    };
    const ours = time(() => arthDecoder(bytes), 20_000);
    const ref = time(() => msgpackDecoder(bytes), 20_000);
    console.log(`50-row delta (${bytes.length} B): arthDecoder ${ours.toFixed(1)} µs, @msgpack/msgpack ${ref.toFixed(1)} µs (jest/node)`);
    expect(ours).toBeLessThan(1_000);
  });
});
