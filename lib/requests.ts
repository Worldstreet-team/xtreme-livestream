"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import type { RequestItem, RequestOrderView, RequestStatus } from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";

/**
 * Paid requests (Phase 2), on the client: the host's menu, the viewer's own
 * requests, and the host's queue. The money itself never moves here — the
 * API holds it in the treasury until the host says done, and refunds it
 * when they skip or the stream ends first.
 *
 * Both sides keep themselves current off the room: `requests_menu` (the menu
 * opened, closed or changed), `request` (host and moderators: a new one) and
 * `request_update` (a viewer: theirs was done or refunded).
 */

export type { RequestItem, RequestOrderView as RequestOrder, RequestStatus };
export { MAX_REQUEST_ITEMS, REQUEST_PRICE_MAX_MINOR, REQUEST_PRICE_MIN_MINOR } from "@xtreme/contracts";

export interface RequestsMenu {
  open: boolean;
  items: RequestItem[];
}

const STATUSES: RequestStatus[] = ["pending", "done", "skipped", "expired"];

export function readItem(raw: unknown): RequestItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string" || typeof r.priceUsdMinor !== "number") return null;
  return { id: r.id, title: r.title.slice(0, 40), priceUsdMinor: r.priceUsdMinor, prompt: typeof r.prompt === "string" ? r.prompt.slice(0, 60) : "" };
}

export function readMenu(raw: unknown): RequestsMenu | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items.map(readItem).filter((i): i is RequestItem => i !== null) : [];
  return { open: r.open === true && items.length > 0, items };
}

export function readOrder(raw: unknown): RequestOrderView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const v = (r.viewer ?? {}) as Record<string, unknown>;
  if (typeof r.id !== "string" || !STATUSES.includes(r.status as RequestStatus)) return null;
  return {
    id: r.id,
    itemId: String(r.itemId ?? ""),
    title: String(r.title ?? ""),
    note: String(r.note ?? ""),
    priceUsdMinor: Number(r.priceUsdMinor) || 0,
    status: r.status as RequestStatus,
    refunded: r.refunded === true,
    viewer: { userId: String(v.userId ?? ""), username: String(v.username ?? ""), avatar: String(v.avatar ?? "") },
    createdAt: String(r.createdAt ?? new Date().toISOString()),
    decidedAt: typeof r.decidedAt === "string" ? r.decidedAt : null,
  };
}

/** Waiting ones first come, first served; decided ones newest first — a decision moves a row across. */
export function placeOrder(lists: { pending: RequestOrderView[]; decided: RequestOrderView[] }, order: RequestOrderView) {
  const pending = lists.pending.filter((o) => o.id !== order.id);
  const decided = lists.decided.filter((o) => o.id !== order.id);
  if (order.status === "pending") {
    pending.push(order);
    pending.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  } else {
    decided.unshift(order);
    decided.sort((a, b) => Date.parse(b.decidedAt ?? b.createdAt) - Date.parse(a.decidedAt ?? a.createdAt));
  }
  return { pending, decided: decided.slice(0, 20) };
}

/** One listener on the room for the request events, parsed. */
function useRequestEvents(room: Room | null, onEvent: (evt: string, data: Record<string, unknown>) => void) {
  useEffect(() => {
    if (!room) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void import("livekit-client").then(({ RoomEvent }) => {
      if (cancelled) return;
      const handle = (payload: Uint8Array, participant?: { identity: string }) => {
        // The API's events only: sent by the server, with no participant.
        if (participant) return;
        try {
          const data = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
          if (data.__evt === "requests_menu" || data.__evt === "request" || data.__evt === "request_update") {
            onEvent(data.__evt, data);
          }
        } catch {
          // Not an event.
        }
      };
      room.on(RoomEvent.DataReceived, handle);
      off = () => room.off(RoomEvent.DataReceived, handle);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [room, onEvent]);
}

/**
 * A viewer's side: what the host takes requests for (and whether they're
 * taking them now), and the requests I've made on this stream.
 */
export function useViewerRequests(
  streamId: string,
  room: Room | null,
  signedIn: boolean,
  /** One of mine was decided — done, or refunded. */
  onNews?: (order: RequestOrderView) => void
) {
  const [menu, setMenu] = useState<RequestsMenu>({ open: false, items: [] });
  const [mine, setMine] = useState<{ pending: RequestOrderView[]; decided: RequestOrderView[] }>({ pending: [], decided: [] });
  const onNewsRef = useRef(onNews);
  useEffect(() => {
    onNewsRef.current = onNews;
  }, [onNews]);

  useEffect(() => {
    if (!streamId) return;
    let cancelled = false;
    apiFetch<{ data: unknown }>(`/api/streams/${streamId}/requests-menu`)
      .then((r) => {
        const next = readMenu(r.data);
        if (!cancelled && next) setMenu(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [streamId]);

  const loadMine = useCallback(async () => {
    if (!streamId || !signedIn) return;
    try {
      const r = await apiFetch<{ data: { pending: unknown[]; decided: unknown[] } }>(`/api/streams/${streamId}/requests`);
      const read = (list: unknown[]) => list.map(readOrder).filter((o): o is RequestOrderView => o !== null);
      setMine({ pending: read(r.data.pending), decided: read(r.data.decided) });
    } catch {
      // Nothing to show is fine.
    }
  }, [streamId, signedIn]);

  const onEvent = useCallback((evt: string, data: Record<string, unknown>) => {
    if (evt === "requests_menu") {
      const next = readMenu(data);
      if (next) setMenu(next);
    } else if (evt === "request_update") {
      const order = readOrder(data.order);
      if (!order) return;
      setMine((lists) => placeOrder(lists, order));
      if (order.status !== "pending") onNewsRef.current?.(order);
    }
  }, []);
  useRequestEvents(room, onEvent);

  const order = useCallback(
    async (itemId: string, note: string) => {
      const r = await apiFetch<{ data: { order: unknown } }>(`/api/streams/${streamId}/requests`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ itemId, note }),
      });
      const placed = readOrder(r.data.order);
      if (placed) setMine((lists) => placeOrder(lists, placed));
      return placed;
    },
    [streamId]
  );

  return { menu, mine, loadMine, order };
}

/**
 * The host's side: the menu they write, whether it's open, and the queue.
 * Moderators see the queue too, but only the host decides.
 */
export function useRequestQueue(streamId: string | null, room: Room | null) {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [open, setOpenState] = useState(false);
  const [lists, setLists] = useState<{ pending: RequestOrderView[]; decided: RequestOrderView[] }>({ pending: [], decided: [] });
  const [loaded, setLoaded] = useState(false);

  // The menu is the account's: it's there before going live, to write ahead.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ data: { items: unknown[] } }>("/api/users/me/requests-menu")
      .then((r) => {
        if (!cancelled) setItems(r.data.items.map(readItem).filter((i): i is RequestItem => i !== null));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!streamId) return;
    let cancelled = false;
    apiFetch<{ data: unknown }>(`/api/streams/${streamId}/requests-menu`)
      .then((r) => {
        const next = readMenu(r.data);
        if (!cancelled && next) setOpenState(next.open);
      })
      .catch(() => {});
    apiFetch<{ data: { pending: unknown[]; decided: unknown[] } }>(`/api/streams/${streamId}/requests`)
      .then((r) => {
        const read = (list: unknown[]) => list.map(readOrder).filter((o): o is RequestOrderView => o !== null);
        if (!cancelled) setLists({ pending: read(r.data.pending), decided: read(r.data.decided) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [streamId]);

  const onEvent = useCallback((evt: string, data: Record<string, unknown>) => {
    if (evt === "request") {
      const order = readOrder(data.order);
      if (order) setLists((l) => placeOrder(l, order));
    } else if (evt === "requests_menu") {
      const next = readMenu(data);
      if (next) setOpenState(next.open);
    }
  }, []);
  useRequestEvents(room, onEvent);

  const saveMenu = useCallback(async (next: RequestItem[] | Array<Omit<RequestItem, "id"> & { id?: string }>) => {
    const r = await apiFetch<{ data: { items: unknown[] } }>("/api/users/me/requests-menu", {
      method: "PUT",
      body: JSON.stringify({ items: next }),
    });
    const saved = r.data.items.map(readItem).filter((i): i is RequestItem => i !== null);
    setItems(saved);
    if (saved.length === 0) setOpenState(false);
    return saved;
  }, []);

  const setOpen = useCallback(
    async (next: boolean) => {
      if (!streamId) return;
      setOpenState(next);
      try {
        await apiFetch(`/api/streams/${streamId}/requests/open`, { method: "POST", body: JSON.stringify({ open: next }) });
      } catch (err) {
        setOpenState(!next);
        throw err;
      }
    },
    [streamId]
  );

  const decide = useCallback(
    async (orderId: string, action: "done" | "skip") => {
      if (!streamId) return;
      const r = await apiFetch<{ data: { order: unknown } }>(`/api/streams/${streamId}/requests/${orderId}/${action}`, { method: "POST" });
      const order = readOrder(r.data.order);
      if (order) setLists((l) => placeOrder(l, order));
    },
    [streamId]
  );

  const feature = useCallback(
    async (orderId: string, on: boolean) => {
      if (!streamId) return null;
      const r = await apiFetch<{ data: { scene: unknown } }>(`/api/streams/${streamId}/requests/${orderId}/feature`, { method: on ? "POST" : "DELETE" });
      return r.data.scene;
    },
    [streamId]
  );

  return { items, loaded, open, pending: lists.pending, decided: lists.decided, saveMenu, setOpen, decide, feature };
}
