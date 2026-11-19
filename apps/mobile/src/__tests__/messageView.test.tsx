import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MessageView } from "@/features/copilot/MessageView";
import type { ChatMessage } from "@/features/copilot/types";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (to: string) => mockPush(to) } }));
jest.mock("@shopify/react-native-skia", () => {
  const { View } = jest.requireActual("react-native");
  const path: object = new Proxy({}, { get: (_t, key) => (key === "build" ? () => ({}) : () => path) });
  return {
    Canvas: View,
    Path: () => null,
    Skia: { PathBuilder: { Make: () => path }, Path: { Make: () => path }, XYWHRect: () => ({}) },
  };
});

const base: ChatMessage = { id: "a1", role: "assistant", content: "", blocks: [], citations: [], status: "streaming", createdAt: 0 };
const done = { disclaimer: "Not investment advice.", grounded: true, cached: false, refused: false };
const cite = { n: 1, title: "Q2 results", source: "BSE filing", kind: "filing", url: null, publishedAt: null, snippet: "…" };

describe("MessageView", () => {
  beforeEach(() => mockPush.mockReset());

  it("renders the user bubble", async () => {
    await render(<MessageView message={{ ...base, role: "user", content: "How is TCS doing?", status: "done" }} onCite={jest.fn()} />);
    expect(screen.getByTestId("msg-user")).toBeTruthy();
    expect(screen.getByText("How is TCS doing?")).toBeTruthy();
  });

  it("shows thinking, then tool progress, while nothing has streamed", async () => {
    const { rerender } = await render(<MessageView message={base} onCite={jest.fn()} />);
    expect(screen.getByText("Thinking…")).toBeTruthy();
    await rerender(<MessageView message={{ ...base, tools: ["get_quote"] }} onCite={jest.fn()} />);
    expect(screen.getByText("Checking your data…")).toBeTruthy();
  });

  it("renders markdown, citations, blocks and the disclaimer for a finished turn", async () => {
    const onCite = jest.fn();
    const message: ChatMessage = {
      ...base,
      status: "done",
      content: "## Summary\nTCS is **up** today [1].\n- margin `24%`\n1. revenue",
      citations: [cite],
      blocks: [
        { kind: "stock_chips", title: "Mentioned", chips: [{ symbol: "TCS", ltp: 4012.5, changePct: 1.2 }, { symbol: "INFY", ltp: null, changePct: -0.4 }] },
        { kind: "holdings_table", title: "Holdings", rows: [{ symbol: "HDFCBANK", qty: 10, value: 17000, pnlPct: -2.5, weight: 0.4 }] },
        { kind: "allocation_donut", title: "Allocation", slices: [{ key: "IT", weight: 0.6 }, { key: "Banks", weight: 0.4 }] },
        { kind: "line_chart", title: "vs Nifty", series: [{ label: "Portfolio", points: [["2026-11-01", 100], ["2026-11-02", 104]] }] },
      ],
      piiMasked: ["phone"],
      done,
    };
    await render(<MessageView message={message} onCite={onCite} />);
    expect(screen.getByTestId("msg-assistant-done")).toBeTruthy();
    expect(screen.getByText("Summary")).toBeTruthy();
    expect(screen.getByText("up")).toBeTruthy();
    expect(screen.getByText("24%")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Source 1"));
    await fireEvent.press(screen.getByText("[1] BSE filing"));
    expect(onCite).toHaveBeenCalledTimes(2);
    expect(onCite).toHaveBeenCalledWith(1);
    for (const kind of ["stock_chips", "holdings_table", "allocation_donut", "line_chart"]) expect(screen.getByTestId(`block-${kind}`)).toBeTruthy();
    await fireEvent.press(screen.getByText("TCS"));
    await fireEvent.press(screen.getByText("HDFCBANK"));
    expect(mockPush).toHaveBeenCalledWith("/instrument/TCS");
    expect(mockPush).toHaveBeenCalledWith("/instrument/HDFCBANK");
    expect(screen.getByText("Masked before sending: phone")).toBeTruthy();
    expect(screen.getByTestId("disclaimer")).toHaveTextContent("Not investment advice.");
  });

  it("labels cached and ungrounded answers", async () => {
    await render(<MessageView message={{ ...base, status: "done", content: "ok", done: { ...done, cached: true, grounded: false } }} onCite={jest.fn()} />);
    expect(screen.getByText(/Some figures could not be matched/)).toBeTruthy();
    expect(screen.getByTestId("disclaimer")).toHaveTextContent("Cached answer · Not investment advice.");
  });

  it.each([
    [{ code: "offline", message: "offline" }, "Can't reach the copilot. Check your connection."],
    [{ code: "stream_interrupted", message: "stream_interrupted" }, "The answer was cut off."],
    [{ code: "rate_limited", message: "rate_limited" }, "Something went wrong (rate_limited)."],
    [{ code: "advice_refused", message: "I can't give buy/sell advice." }, "I can't give buy/sell advice."],
  ])("maps error %j to a readable line", async (error, text) => {
    await render(<MessageView message={{ ...base, status: "error", error }} onCite={jest.fn()} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("marks a stopped turn", async () => {
    await render(<MessageView message={{ ...base, status: "stopped", content: "partial" }} onCite={jest.fn()} />);
    expect(screen.getByText("Stopped")).toBeTruthy();
  });
});
