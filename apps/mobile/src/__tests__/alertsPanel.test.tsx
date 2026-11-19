import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AlertsPanel } from "@/features/alerts/AlertsPanel";
import { tokens } from "@/features/auth/tokens";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const existing = {
  id: "11111111-1111-4111-8111-111111111111",
  symbol: "TCS",
  name: "Tata Consultancy Services",
  kind: "below",
  value: 3500,
  active: true,
  createdAt: "2026-11-01T00:00:00Z",
};

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("AlertsPanel", () => {
  const fetchMock = jest.fn<Promise<Response>, [Request]>();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    tokens.setAccess("a1");
  });

  it("lists this symbol's alerts and blocks a threshold the price is already past", async () => {
    fetchMock.mockImplementation(async () => json(200, [existing, { ...existing, id: "2", symbol: "INFY" }]));
    await render(wrap(<AlertsPanel symbol="TCS" ltp={4000} />));
    expect(await screen.findByText("Price goes below 3,500.00")).toBeTruthy();
    expect(screen.queryByTestId("alert-toggle-2")).toBeNull();

    await fireEvent.changeText(screen.getByTestId("alert-value"), "3990");
    await fireEvent.press(screen.getByTestId("alert-create"));
    expect(await screen.findByText("The price is already above this level")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates an alert and shows the server's limit error", async () => {
    fetchMock.mockImplementation(async (req) =>
      req.method === "POST" ? json(409, { code: "alert_limit", title: "limit" }) : json(200, []),
    );
    await render(wrap(<AlertsPanel symbol="TCS" ltp={4000} />));
    await fireEvent.changeText(screen.getByTestId("alert-value"), "4,200");
    await fireEvent.press(screen.getByTestId("alert-create"));
    await waitFor(() => expect(screen.getByText("You already have 50 active alerts. Turn one off first.")).toBeTruthy());
    const post = fetchMock.mock.calls.map((c) => c[0]).find((r) => r.method === "POST")!;
    expect(post.url).toBe("http://api.test/v1/alerts");
    expect(await post.json()).toEqual({ symbol: "TCS", kind: "above", value: 4200 });
  });
});
