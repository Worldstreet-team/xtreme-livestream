import { describe, expect, it } from "vitest";
import { readLayers } from "../../../lib/scene";
import { formatPrice, formatQuote, marketBase, readTickers } from "../../../lib/market";

/**
 * The market layer as the web app reads it: a price strip off the wire is
 * tidied to real-looking markets (uppercase, each once, five at most) or
 * dropped; chat's tickers are read as far as they make sense; and prices
 * are written at the scale they're read at.
 */

describe("the price strip off the wire", () => {
  it("keeps a good strip as it came", () => {
    expect(readLayers([{ kind: "prices", symbols: ["BTC-USD", "ETH-USD"] }])).toEqual([{ kind: "prices", symbols: ["BTC-USD", "ETH-USD"] }]);
  });

  it("uppercases what was typed in lowercase, and trims it", () => {
    expect(readLayers([{ kind: "prices", symbols: ["btc-usd", " eth-usd "] }])).toEqual([{ kind: "prices", symbols: ["BTC-USD", "ETH-USD"] }]);
  });

  it("shows each market once", () => {
    expect(readLayers([{ kind: "prices", symbols: ["BTC-USD", "btc-usd", "ETH-USD", "BTC-USD"] }])).toEqual([
      { kind: "prices", symbols: ["BTC-USD", "ETH-USD"] },
    ]);
  });

  it("keeps the first five of more", () => {
    const seven = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "ADA-USD", "LTC-USD"];
    expect(readLayers([{ kind: "prices", symbols: seven }])).toEqual([{ kind: "prices", symbols: seven.slice(0, 5) }]);
  });

  it("skips what isn't a market, and drops the strip when nothing's left", () => {
    expect(readLayers([{ kind: "prices", symbols: ["$100", "bitcoin", 42, "BTC", "BTC-US-D", null] }])).toEqual([]);
    expect(readLayers([{ kind: "prices", symbols: "BTC-USD" }])).toEqual([]);
    expect(readLayers([{ kind: "prices" }])).toEqual([]);
    // A bad strip doesn't take the other graphics with it.
    expect(readLayers([{ kind: "prices", symbols: ["nope"] }, { kind: "banner", text: "Giveaway at 100 allies" }])).toEqual([
      { kind: "banner", text: "Giveaway at 100 allies" },
    ]);
    expect(readLayers([{ kind: "prices", symbols: ["sol-usd", "$100"] }, { kind: "banner", text: "Hi" }])).toEqual([
      { kind: "prices", symbols: ["SOL-USD"] },
      { kind: "banner", text: "Hi" },
    ]);
  });
});

describe("chat's tickers off the wire", () => {
  it("reads nothing from bad input", () => {
    expect(readTickers(undefined)).toEqual([]);
    expect(readTickers(null)).toEqual([]);
    expect(readTickers("SOL-USD")).toEqual([]);
    expect(readTickers({ symbol: "SOL-USD", mentions: 3 })).toEqual([]);
    expect(readTickers([1, "SOL-USD", null, { mentions: 4 }])).toEqual([]);
  });

  it("reads what makes sense, uppercased, counts never below zero, five at most", () => {
    expect(readTickers([{ symbol: "sol-usd", mentions: 4 }, { symbol: "BTC-USD", mentions: "2" }, { symbol: "ETH-USD", mentions: -1 }, { symbol: "XRP-USD" }])).toEqual([
      { symbol: "SOL-USD", mentions: 4 },
      { symbol: "BTC-USD", mentions: 2 },
      { symbol: "ETH-USD", mentions: 0 },
      { symbol: "XRP-USD", mentions: 0 },
    ]);
    const many = ["A", "B", "C", "D", "E", "F"].map((s) => ({ symbol: `${s}-USD`, mentions: 1 }));
    expect(readTickers(many)).toHaveLength(5);
  });
});

describe("prices in words", () => {
  it("writes a price at the scale it's read at", () => {
    expect(formatPrice(67201.5)).toBe("67,201.5");
    expect(formatPrice(2713.88)).toBe("2,713.9");
    expect(formatPrice(184.256)).toBe("184.26");
    expect(formatPrice(1)).toBe("1.00");
    expect(formatPrice(0.1734)).toBe("0.1734");
    // Below a cent, significant figures: four decimals would read PEPE as nothing.
    expect(formatPrice(0.00012345)).toBe("0.0001235");
    expect(formatPrice(0.0000112)).toBe("0.0000112");
  });

  it("puts a dollar sign on dollar markets and names any other quote", () => {
    expect(formatQuote("BTC-USD", 67201.5)).toBe("$67,201.5");
    expect(formatQuote("ADA-USDT", 0.4321)).toBe("$0.4321");
    expect(formatQuote("ETH-BTC", 0.0523)).toBe("0.0523 BTC");
    expect(formatQuote("BTC-EUR", 61020.25)).toBe("61,020.3 EUR");
  });

  it("knows the coin in a market", () => {
    expect(marketBase("SOL-USD")).toBe("SOL");
    expect(marketBase("SOL")).toBe("SOL");
  });
});
