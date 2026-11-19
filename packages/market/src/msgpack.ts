/**
 * Minimal msgpack decoder with no dependencies and no TextDecoder, so it can run on a
 * Reanimated/worklets runtime as well as on the JS thread. Supports the full type set
 * except extension types (which the gateway never emits).
 */
export function decodeMsgpack(buf: Uint8Array): unknown {
  "worklet";
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;

  const str = (len: number): string => {
    let out = "";
    const end = pos + len;
    while (pos < end) {
      const b = buf[pos++]!;
      if (b < 0x80) out += String.fromCharCode(b);
      else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (buf[pos++]! & 0x3f));
      else if (b < 0xf0) {
        out += String.fromCharCode(((b & 0x0f) << 12) | ((buf[pos++]! & 0x3f) << 6) | (buf[pos++]! & 0x3f));
      } else {
        const cp =
          (((b & 0x07) << 18) | ((buf[pos++]! & 0x3f) << 12) | ((buf[pos++]! & 0x3f) << 6) | (buf[pos++]! & 0x3f)) -
          0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return out;
  };

  const read = (): unknown => {
    const t = buf[pos++];
    if (t === undefined) throw new RangeError("msgpack: unexpected end of buffer");
    if (t < 0x80) return t;
    if (t < 0x90) return map(t & 0x0f);
    if (t < 0xa0) return arr(t & 0x0f);
    if (t < 0xc0) return str(t & 0x1f);
    if (t >= 0xe0) return t - 0x100;
    let v: number;
    switch (t) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: v = buf[pos]!; pos += 1; return bin(v);
      case 0xc5: v = view.getUint16(pos); pos += 2; return bin(v);
      case 0xc6: v = view.getUint32(pos); pos += 4; return bin(v);
      case 0xca: v = view.getFloat32(pos); pos += 4; return v;
      case 0xcb: v = view.getFloat64(pos); pos += 8; return v;
      case 0xcc: return buf[pos++]!;
      case 0xcd: v = view.getUint16(pos); pos += 2; return v;
      case 0xce: v = view.getUint32(pos); pos += 4; return v;
      case 0xcf: v = view.getUint32(pos) * 4294967296 + view.getUint32(pos + 4); pos += 8; return v;
      case 0xd0: v = view.getInt8(pos); pos += 1; return v;
      case 0xd1: v = view.getInt16(pos); pos += 2; return v;
      case 0xd2: v = view.getInt32(pos); pos += 4; return v;
      case 0xd3: v = view.getInt32(pos) * 4294967296 + view.getUint32(pos + 4); pos += 8; return v;
      case 0xd9: v = buf[pos]!; pos += 1; return str(v);
      case 0xda: v = view.getUint16(pos); pos += 2; return str(v);
      case 0xdb: v = view.getUint32(pos); pos += 4; return str(v);
      case 0xdc: v = view.getUint16(pos); pos += 2; return arr(v);
      case 0xdd: v = view.getUint32(pos); pos += 4; return arr(v);
      case 0xde: v = view.getUint16(pos); pos += 2; return map(v);
      case 0xdf: v = view.getUint32(pos); pos += 4; return map(v);
      default: throw new TypeError(`msgpack: unsupported type 0x${t.toString(16)}`);
    }
  };

  const bin = (len: number): Uint8Array => {
    const out = buf.slice(pos, pos + len);
    pos += len;
    return out;
  };

  const arr = (len: number): unknown[] => {
    const out = new Array<unknown>(len);
    for (let i = 0; i < len; i++) out[i] = read();
    return out;
  };

  const map = (len: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < len; i++) {
      const k = read();
      out[String(k)] = read();
    }
    return out;
  };

  const value = read();
  if (pos !== buf.length) throw new RangeError(`msgpack: ${buf.length - pos} trailing bytes`);
  return value;
}
