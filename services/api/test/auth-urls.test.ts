import { describe, expect, it } from "vitest";
import { movedHostUrl } from "@/lib/auth-urls";

describe("movedHostUrl: the old host hands its pages to the new one", () => {
  it("keeps the path and query", () => {
    expect(movedHostUrl("xtreme.worldstreetgold.com", "/stream/abc", "?t=90")?.href).toBe(
      "https://xtream.worldstreetgold.com/stream/abc?t=90",
    );
  });

  it("reads the host however the proxy wrote it", () => {
    expect(movedHostUrl("XTREME.worldstreetgold.com:443", "/")?.href).toBe("https://xtream.worldstreetgold.com/");
    expect(movedHostUrl("xtreme.worldstreetgold.com, 10.0.0.2", "/feed")?.href).toBe("https://xtream.worldstreetgold.com/feed");
  });

  it("leaves every other host alone", () => {
    expect(movedHostUrl("xtream.worldstreetgold.com", "/")).toBeNull();
    expect(movedHostUrl("localhost:3010", "/")).toBeNull();
    expect(movedHostUrl("xtreme.worldstreetgold.com.evil.example", "/")).toBeNull();
    expect(movedHostUrl(null, "/")).toBeNull();
  });

  it("never leaves the new host, whatever the path says", () => {
    expect(movedHostUrl("xtreme.worldstreetgold.com", "//evil.example/x")?.host).toBe("xtream.worldstreetgold.com");
    expect(movedHostUrl("xtreme.worldstreetgold.com", "/\\evil.example/x")?.host).toBe("xtream.worldstreetgold.com");
  });
});
