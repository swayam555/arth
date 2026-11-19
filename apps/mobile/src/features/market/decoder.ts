import { decodeMsgpack, type ServerFrame } from "@arth/market";
import { decode } from "@msgpack/msgpack";

export type FrameDecoder = (data: ArrayBuffer | Uint8Array) => ServerFrame;

const bytes = (data: ArrayBuffer | Uint8Array) => (data instanceof Uint8Array ? data : new Uint8Array(data));

/** Dependency-free decoder from `@arth/market`; also callable from a worklet runtime. */
export const arthDecoder: FrameDecoder = (data) => decodeMsgpack(bytes(data)) as ServerFrame;

/** Reference implementation, kept for parity tests and benchmarks. */
export const msgpackDecoder: FrameDecoder = (data) => decode(bytes(data)) as ServerFrame;
