import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import * as lib from "../../lib/obs-websocket";

/**
 * "Set up OBS for me" speaks obs-websocket v5 to OBS on the creator's
 * computer. A fake OBS here checks the handshake (the password challenge
 * answered the way OBS computes it) and the requests the studio sends.
 */

type Msg = { op: number; d: Record<string, any> };
const b64sha = (s: string) => createHash("sha256").update(s).digest("base64");
const PASSWORD = "hunter2";
const EXPECTED = b64sha(b64sha(PASSWORD + "salt-1") + "challenge-1");

const obs = {
  version: "31.1.2",
  requests: [] as Array<{ type: string; data?: Record<string, unknown> }>,
  mode: "Simple",
  videoFails: false,
};

class FakeObs {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(
    public url: string,
    public protocol: string,
  ) {
    setTimeout(() => this.emit({ op: 0, d: { rpcVersion: 1, authentication: { challenge: "challenge-1", salt: "salt-1" } } }));
  }
  send(raw: string) {
    const m = JSON.parse(raw) as Msg;
    if (m.op === 1) {
      if (m.d.authentication === EXPECTED) this.emit({ op: 2, d: { negotiatedRpcVersion: 1 } });
      else this.close(4009);
      return;
    }
    if (m.op === 6) {
      obs.requests.push({ type: m.d.requestType, data: m.d.requestData });
      const fail = m.d.requestType === "SetVideoSettings" && obs.videoFails;
      const data =
        m.d.requestType === "GetVersion"
          ? { obsVersion: obs.version }
          : m.d.requestType === "GetProfileParameter"
            ? { parameterValue: obs.mode }
            : {};
      setTimeout(() =>
        this.emit({
          op: 7,
          d: { requestType: m.d.requestType, requestId: m.d.requestId, requestStatus: { result: !fail, code: fail ? 500 : 100 }, responseData: data },
        }),
      );
    }
  }
  emit(msg: Msg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  close(code = 1000) {
    setTimeout(() => this.onclose?.({ code }));
  }
}
// OBS is only reached when connecting, so the fake can go in after the import.
(globalThis as { WebSocket?: unknown }).WebSocket = FakeObs;

beforeEach(() => {
  lib.disconnectObs();
  obs.requests = [];
  obs.version = "31.1.2";
  obs.mode = "Simple";
  obs.videoFails = false;
});

describe("connecting", () => {
  it("answers OBS's password challenge and learns its version", async () => {
    await lib.connectObs(4455, PASSWORD);
    await expect(lib.sendKeyToObs("rtmp", "rtmps://x.live/x", "key-1")).resolves.toBeUndefined();
    expect(obs.requests.map((r) => r.type)).toEqual(["GetVersion", "SetStreamServiceSettings"]);
  });

  it("says so when the password is wrong", async () => {
    await lib.connectObs(4455, "wrong");
    await expect(lib.sendKeyToObs("rtmp", "s", "k")).rejects.toThrow("Connect to OBS first.");
  });
});

describe("setting OBS up", () => {
  it("sends the RTMP server and key, or the WHIP server and bearer token", async () => {
    await lib.connectObs(4455, PASSWORD);
    await lib.sendKeyToObs("rtmp", "rtmps://x.live/x", "key-1");
    await lib.sendKeyToObs("whip", "https://x.whip/w", "token-1");
    const sets = obs.requests.filter((r) => r.type === "SetStreamServiceSettings").map((r) => r.data);
    expect(sets).toEqual([
      { streamServiceType: "rtmp_custom", streamServiceSettings: { server: "rtmps://x.live/x", key: "key-1", use_auth: false } },
      { streamServiceType: "whip_custom", streamServiceSettings: { server: "https://x.whip/w", bearer_token: "token-1" } },
    ]);
  });

  it("won't send WHIP to an OBS older than 30", async () => {
    obs.version = "29.1.3";
    await lib.connectObs(4455, PASSWORD);
    await expect(lib.sendKeyToObs("whip", "s", "t")).rejects.toThrow("WHIP needs OBS 30 or later");
  });

  it("applies 720p30, and 2,500 kbps in Simple output mode only", async () => {
    await lib.connectObs(4455, PASSWORD);
    await expect(lib.applyXtreamPreset()).resolves.toEqual({ bitrate: true });
    expect(obs.requests.find((r) => r.type === "SetVideoSettings")!.data).toEqual({ fpsNumerator: 30, fpsDenominator: 1, outputWidth: 1280, outputHeight: 720 });
    expect(obs.requests.find((r) => r.type === "SetProfileParameter")!.data).toEqual({ parameterCategory: "SimpleOutput", parameterName: "VBitrate", parameterValue: "2500" });

    obs.requests = [];
    obs.mode = "Advanced";
    await expect(lib.applyXtreamPreset()).resolves.toEqual({ bitrate: false });
    expect(obs.requests.some((r) => r.type === "SetProfileParameter")).toBe(false);
  });

  it("explains why the size can't change mid-stream", async () => {
    obs.videoFails = true;
    await lib.connectObs(4455, PASSWORD);
    await expect(lib.applyXtreamPreset()).rejects.toThrow("Stop streaming and recording in OBS first");
  });
});
