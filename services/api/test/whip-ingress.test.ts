import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHIP beside RTMP: each protocol is its own per-account ingress, minted on
 * first ask with the right input type, re-pointed after that, and rotated
 * on its own.
 */

const calls = vi.hoisted(() => ({
  created: [] as Array<{ input: number; name: string; roomName: string }>,
  updated: [] as Array<{ id: string; roomName: string }>,
  deleted: [] as string[],
  n: 0,
}));

vi.mock("livekit-server-sdk", () => {
  const IngressInput = { RTMP_INPUT: 0, WHIP_INPUT: 1, URL_INPUT: 2 };
  class IngressClient {
    async createIngress(input: number, opts: { name: string; roomName: string }) {
      calls.created.push({ input, name: opts.name, roomName: opts.roomName });
      calls.n += 1;
      return input === IngressInput.WHIP_INPUT
        ? { ingressId: `IN_whip${calls.n}`, url: "https://x.whip.livekit.cloud/w", streamKey: `token${calls.n}` }
        : { ingressId: `IN_rtmp${calls.n}`, url: "rtmps://x.rtmp.livekit.cloud/x", streamKey: `key${calls.n}` };
    }
    async updateIngress(id: string, opts: { roomName: string }) {
      calls.updated.push({ id, roomName: opts.roomName });
    }
    async deleteIngress(id: string) {
      calls.deleted.push(id);
    }
  }
  class RoomServiceClient {}
  class WebhookReceiver {}
  class AccessToken {}
  return { IngressClient, IngressInput, RoomServiceClient, WebhookReceiver, AccessToken };
});

const livekit = await import("../src/livekit.js");

function user() {
  const u: Record<string, any> = { _id: { toString: () => "a".repeat(24) }, displayName: "Wole", obsIngress: undefined, whipIngress: undefined };
  u.save = async () => u;
  return u as never;
}

beforeEach(() => {
  calls.created = [];
  calls.updated = [];
  calls.deleted = [];
});

describe("encoder ingresses", () => {
  it("mints WHIP with the WHIP input, kept apart from the RTMP one", async () => {
    const u = user();
    const whip = await livekit.ensureUserIngress(u, undefined, "whip");
    expect(calls.created).toEqual([{ input: 1, name: `obs-${"a".repeat(24)}`, roomName: `standby-${"a".repeat(24)}` }]);
    expect(whip).toMatchObject({ url: "https://x.whip.livekit.cloud/w" });
    expect((u as { whipIngress?: unknown }).whipIngress).toBe(whip);
    expect((u as { obsIngress?: unknown }).obsIngress).toBeUndefined();

    const rtmp = await livekit.ensureUserIngress(u);
    expect(calls.created.at(-1)!.input).toBe(0);
    expect(rtmp.ingressId).not.toBe(whip.ingressId);
  });

  it("re-points an existing key rather than minting, and rotates one protocol only", async () => {
    const u = user();
    const whip = await livekit.ensureUserIngress(u, undefined, "whip");
    const rtmp = await livekit.ensureUserIngress(u);
    await livekit.ensureUserIngress(u, "room-42", "whip");
    expect(calls.updated).toEqual([{ id: whip.ingressId, roomName: "room-42" }]);

    const fresh = await livekit.rotateUserIngress(u, "whip");
    expect(calls.deleted).toEqual([whip.ingressId]);
    expect(fresh.ingressId).not.toBe(whip.ingressId);
    expect((u as { obsIngress?: { ingressId: string } }).obsIngress!.ingressId).toBe(rtmp.ingressId);
  });
});
