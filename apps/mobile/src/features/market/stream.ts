import { config } from "@/config";
import { refreshAccessToken } from "@/data/api";
import { tokens } from "@/features/auth/tokens";
import { arthDecoder } from "./decoder";
import { StreamClient, type SocketLike } from "./streamClient";
import { useTicks } from "./tickStore";

export const stream = new StreamClient({
  url: config.wsUrl,
  createSocket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
  decoder: arthDecoder,
  accessToken: tokens.access,
  refresh: refreshAccessToken,
  sink: {
    quotes: (updates, snapshot) => useTicks.getState().apply(updates, snapshot),
    depth: (d) => useTicks.getState().setDepth(d),
    status: (s) => useTicks.getState().setStatus(s),
  },
});
