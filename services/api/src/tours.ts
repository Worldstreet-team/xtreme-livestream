import type { IUser } from "./models.js";

/**
 * The walkthrough's record on the account, shared by the web and the app:
 * a tour finished or skipped on one never plays on the other, and "Later"
 * snoozes it on both.
 *
 * Tour ids are the clients' own (lib/tour/story.ts on the web): short
 * kebab-case names. The same record holds the walkthrough's lone tips,
 * as `tip-<tourId>-<stepIndex>`: a client writes the steps a tour played
 * when it ends (POST /user/me/tours/seen) and a tip when it's closed. The record is small by design — a cap keeps a buggy
 * client from growing it without end.
 */

export const TOUR_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
/**
 * More ids than the walkthrough will ever need: every tour, plus a tip id
 * per step (`tip-<tourId>-<stepIndex>`, a step that couldn't play with its
 * tour and comes back later as a lone tooltip).
 */
export const MAX_TOURS = 300;
/** "Later" defaults to a day; a client may ask for anything up to a month. */
export const SNOOZE_HOURS = 24;
export const MAX_SNOOZE_HOURS = 24 * 30;

export interface ToursView {
  /** Tour id → when it was finished or skipped (ISO). */
  seen: Record<string, string>;
  /** Tour id → when "Later" runs out (ISO); only snoozes still running. */
  snoozed: Record<string, string>;
}

function entries(map: Map<string, Date> | Record<string, Date> | undefined): [string, Date][] {
  if (!map) return [];
  return map instanceof Map ? [...map.entries()] : Object.entries(map);
}

/** What the clients read: seen tours, and snoozes that haven't run out. */
export function toursView(tours: IUser["tours"], now = new Date()): ToursView {
  const seen: Record<string, string> = {};
  const snoozed: Record<string, string> = {};
  for (const [id, at] of entries(tours?.seen)) seen[id] = new Date(at).toISOString();
  for (const [id, until] of entries(tours?.snoozed)) {
    if (!seen[id] && new Date(until) > now) snoozed[id] = new Date(until).toISOString();
  }
  return { seen, snoozed };
}

/** Every tour the record holds, seen or snoozed (a Mongoose Map or, lean, a plain object). */
export function tourIds(tours: IUser["tours"]): Set<string> {
  return new Set([...entries(tours?.seen), ...entries(tours?.snoozed)].map(([id]) => id));
}
