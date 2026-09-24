/**
 * @worldstreet/messaging-sdk (platform plan, phase 1, 2026-09-24)
 *
 * A typed client for the WorldSpace messaging API, for any WorldStreet
 * platform: threads, messages, media, calls and realtime. Framework-free:
 * plain fetch, a token getter you supply, and Ably handed in rather than
 * bundled, so the same package runs in a browser, in Next.js and in React
 * Native.
 *
 *   import * as Ably from "ably";
 *   const messaging = createMessaging({
 *     baseUrl: "https://social-api.worldstreetgold.com",
 *     platform: "dashboard",
 *     getToken: () => window.Clerk.session.getToken(),
 *   });
 *   const me = await messaging.me();
 *   const inbox = await messaging.conversations.list();
 *   const live = messaging.realtime.connect(Ably, me.id);
 *   live.onEvent((e) => { if (e.type === "message:new") ... });
 *
 * Lifted from the WorldSpace app's own data layer, which already spoke to
 * the gateway this way; the shapes come from @worldstreet/messaging-contracts.
 */
import type {
	CallIncoming,
	CallSignal,
	CallTokenResult,
	ConversationRow,
	CreateGroupInput,
	Identity,
	Message,
	Platform,
	UnreadResult,
	SendMessageInput,
	ThreadContext,
	ThreadSignal,
	ThreadSignalName,
	UpdateGroupInput,
	UserEvent,
} from "@worldstreet/messaging-contracts";
import { channels } from "@worldstreet/messaging-contracts";

export * from "@worldstreet/messaging-contracts";

export interface MessagingOptions {
	/** The gateway origin, no trailing slash. */
	baseUrl: string;
	/** A Clerk session token, fresh each call; null when signed out. */
	getToken: () => Promise<string | null | undefined>;
	/** Which app this is. Scopes the realtime token; `worldspace` by default. */
	platform?: Platform;
	/** Your own fetch when the global one is not the one you want. */
	fetch?: typeof fetch;
	/** Milliseconds before a request is abandoned. 15s by default. */
	timeoutMs?: number;
}

/** What the gateway said when it refused. `status` 0 means it never answered. */
export class MessagingError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly code?: string,
	) {
		super(message);
		this.name = "MessagingError";
	}
}

/** A file for upload: a Blob/File on the web, or a `{ uri, name, type }`
 *  part on React Native (what its FormData accepts). */
export type UploadFile = Blob | { uri: string; name: string; type: string };

export function createMessaging(options: MessagingOptions) {
	const base = options.baseUrl.replace(/\/+$/, "");
	const platform: Platform = options.platform ?? "worldspace";
	const doFetch = options.fetch ?? fetch;
	const timeoutMs = options.timeoutMs ?? 15_000;

	async function request<T>(
		method: string,
		path: string,
		body?: unknown,
		query?: Record<string, string | number | undefined>,
	): Promise<T> {
		const token = await options.getToken();
		if (!token) throw new MessagingError(401, "Not signed in", "NO_SESSION");
		const url = new URL(base + path);
		for (const [k, v] of Object.entries(query ?? {})) {
			if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
		}
		const isForm = typeof FormData !== "undefined" && body instanceof FormData;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let res: Response;
		try {
			res = await doFetch(url.toString(), {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					// So a thread remembers where it was opened.
					"x-ws-platform": platform,
					...(body !== undefined && !isForm
						? { "Content-Type": "application/json" }
						: {}),
				},
				body:
					body === undefined
						? undefined
						: isForm
							? (body as FormData)
							: JSON.stringify(body),
				signal: controller.signal,
			});
		} catch (err) {
			throw new MessagingError(
				0,
				(err as Error)?.name === "AbortError"
					? "The request timed out"
					: "Could not reach messaging",
				"NETWORK",
			);
		} finally {
			clearTimeout(timer);
		}
		const text = await res.text();
		const data = text ? safeJson(text) : null;
		if (!res.ok) {
			throw new MessagingError(
				res.status,
				(data as any)?.message ?? `Request failed (${res.status})`,
				(data as any)?.code,
			);
		}
		return data as T;
	}

	const get = <T>(path: string, query?: Record<string, string | number | undefined>) =>
		request<T>("GET", path, undefined, query);
	const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
	const patch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {});
	const del = <T>(path: string) => request<T>("DELETE", path);

	return {
		/** Your messaging identity, made on first contact for a platform user. */
		me: () => get<Identity>("/v1/messaging/me"),

		conversations: {
			/** The inbox: every thread you are in, newest activity first. */
			list: () => get<ConversationRow[]>("/v1/messaging/conversations"),
			/** The one thread with a person (a profile id), opened if needed.
			 *  Born as a request when they do not follow you. `context` says
			 *  what it is about (an order, a course); the first opener's sticks. */
			open: (recipientId: string, context?: ThreadContext) =>
				post<{ _id: string }>("/v1/messaging/start", { recipientId, context }),
			/** The badge: threads with something new from someone else. */
			unread: () => get<UnreadResult>("/v1/messaging/unread"),
			accept: (conversationId: string) =>
				post(`/v1/messaging/conversations/${conversationId}/accept`),
			/** For you only; the other side's shelf is their own. */
			archive: (conversationId: string, archived: boolean) =>
				patch(`/v1/messaging/conversations/${conversationId}/archive`, { archived }),
			/** Deletes the thread for BOTH sides. */
			remove: (conversationId: string) =>
				del(`/v1/messaging/conversations/${conversationId}`),
		},

		messages: {
			/** A page of `limit` messages, oldest first; page older with
			 *  `before` = the oldest _id you hold. A full page means more. */
			list: (conversationId: string, opts: { limit?: number; before?: string } = {}) =>
				get<Message[]>(`/v1/messaging/${conversationId}`, {
					limit: opts.limit ?? 50,
					before: opts.before,
				}),
			/** The stored row comes back; sending the same clientKey twice
			 *  answers the original row, so a retry is safe. */
			send: (input: SendMessageInput) => post<Message>("/v1/messaging", input),
			markRead: (conversationId: string, upTo?: string) =>
				post(`/v1/messaging/${conversationId}/read`, { upTo }),
			react: (messageId: string, emoji: string) =>
				post<{ messageId: string; reactions: { profile: string; emoji: string }[] }>(
					`/v1/messaging/message/${messageId}/react`,
					{ emoji },
				),
			unsend: (messageId: string) => del(`/v1/messaging/message/${messageId}`),
		},

		media: {
			/** A picture, clip or voice note, 50MB at most. Store `key` as the
			 *  message's mediaUrl; `url` is a short-lived preview. */
			upload: async (file: UploadFile, conversationId: string) => {
				const form = new FormData();
				form.append("file", file as any);
				form.append("conversationId", conversationId);
				const res = await request<{ key?: string; url: string; type: string }>(
					"POST",
					"/v1/messaging/upload",
					form,
				);
				return { key: res.key ?? res.url, url: res.url, type: res.type };
			},
		},

		groups: {
			create: (input: CreateGroupInput) => post<{ _id: string }>("/v1/messaging/groups", input),
			update: (id: string, input: UpdateGroupInput) =>
				patch(`/v1/messaging/groups/${id}`, input),
			addMembers: (id: string, memberIds: string[]) =>
				post(`/v1/messaging/groups/${id}/members`, { memberIds }),
			removeMember: (id: string, profileId: string) =>
				del(`/v1/messaging/groups/${id}/members/${profileId}`),
			setRole: (id: string, profileId: string, role: "admin" | "member") =>
				patch(`/v1/messaging/groups/${id}/members/${profileId}`, { role }),
		},

		calls: {
			/** A LiveKit token for the thread's room. */
			token: (conversationId: string) =>
				post<CallTokenResult>("/v1/messaging/calls/token", { conversationId }),
			ring: (conversationId: string, video = false) =>
				post("/v1/messaging/calls/ring", { conversationId, video }),
			signal: (conversationId: string, type: CallSignal) =>
				post("/v1/messaging/calls/signal", { conversationId, type }),
			/** The caller logs the finished call into the thread; only the caller. */
			log: (input: {
				conversationId: string;
				outcome: string;
				video?: boolean;
				durationSec?: number;
			}) => post<Message>("/v1/messaging/calls/log", input),
		},

		realtime: {
			/**
			 * Connect to Ably with a token scoped to you and this platform.
			 * Pass the Ably module (`import * as Ably from "ably"`) so the SDK
			 * never decides which build of it your app bundles.
			 */
			connect: (ably: AblyModule, profileId: string) =>
				connectRealtime({
					ably,
					profileId,
					platform,
					baseUrl: base,
					getToken: options.getToken,
					fetch: doFetch,
				}),
		},
	};
}

export type Messaging = ReturnType<typeof createMessaging>;

/* ---------------- Realtime ---------------- */

/** The bit of Ably the SDK touches, so any 2.x build satisfies it. */
export interface AblyModule {
	Realtime: new (options: Record<string, unknown>) => AblyRealtimeLike;
}
interface AblyRealtimeLike {
	channels: { get(name: string): AblyChannelLike };
	auth: { authorize(): Promise<unknown> };
	connection: { close(): void };
}
interface AblyChannelLike {
	attach(): Promise<unknown>;
	subscribe(nameOrHandler: string | ((m: any) => void), handler?: (m: any) => void): Promise<unknown>;
	unsubscribe(handler?: (m: any) => void): void;
	publish(name: string, data: unknown): Promise<unknown>;
	presence: {
		enter(data?: unknown): Promise<unknown>;
		leave(): Promise<unknown>;
		get(): Promise<{ clientId?: string }[]>;
		subscribe(events: string[] | string, handler: () => void): Promise<unknown>;
		unsubscribe(): void;
	};
}

function connectRealtime(args: {
	ably: AblyModule;
	profileId: string;
	platform: Platform;
	baseUrl: string;
	getToken: MessagingOptions["getToken"];
	fetch: typeof fetch;
}) {
	// A thread newer than the token is refused with 40160; the next token
	// request carries it as a hint the gateway honours for a member.
	let wantedConversation: string | null = null;

	const client = new args.ably.Realtime({
		authCallback: async (_params: unknown, callback: (err: unknown, token: unknown) => void) => {
			try {
				const token = await args.getToken();
				const url = new URL(`${args.baseUrl}/v1/messaging/realtime/token`);
				url.searchParams.set("platform", args.platform);
				if (wantedConversation) {
					url.searchParams.set("conversation", wantedConversation);
					wantedConversation = null;
				}
				const res = await args.fetch(url.toString(), {
					headers: { Authorization: `Bearer ${token ?? ""}` },
				});
				if (!res.ok) throw new Error(`Realtime token refused (${res.status})`);
				callback(null, await res.json());
			} catch (err) {
				callback(err, null);
			}
		},
	});

	const userChannel = client.channels.get(channels.user(args.profileId));
	const callsChannel = client.channels.get(channels.calls(args.profileId));

	return {
		client,
		/** Everything the gateway tells you: new messages, read marks, unsends,
		 *  threads leaving your inbox. */
		onEvent(handler: (event: UserEvent) => void) {
			const wrapped = (m: any) => handler(m?.data as UserEvent);
			void userChannel.subscribe("event", wrapped).catch(() => {});
			return () => userChannel.unsubscribe(wrapped);
		},
		/** An incoming call, then every signal about it. */
		onCall(handler: (name: "call:incoming" | CallSignal, payload: CallIncoming | Record<string, unknown>) => void) {
			const wrapped = (m: any) => handler(m?.name, m?.data);
			void callsChannel.subscribe(wrapped).catch(() => {});
			return () => callsChannel.unsubscribe(wrapped);
		},
		/**
		 * The client-to-client channel of one thread: typing, recording,
		 * reactions, delivered and read. Attaches, retrying once with a fresh
		 * token when the thread is newer than the current one.
		 */
		thread(conversationId: string) {
			const channel = client.channels.get(channels.conversation(conversationId));
			const ready = channel.attach().catch(async (err: any) => {
				if (err?.code !== 40160) throw err;
				wantedConversation = conversationId;
				await client.auth.authorize();
				await channel.attach();
			});
			return {
				ready,
				onSignal(handler: (name: ThreadSignalName, signal: ThreadSignal) => void) {
					const wrapped = (m: any) => {
						if (m?.data?.from === args.profileId) return;
						handler(m?.name, m?.data);
					};
					void ready.then(() => channel.subscribe(wrapped)).catch(() => {});
					return () => channel.unsubscribe(wrapped);
				},
				send(name: ThreadSignalName, data: Partial<ThreadSignal> = {}) {
					const signal: ThreadSignal = { v: 1, from: args.profileId, at: Date.now(), ...data };
					return channel.publish(name, signal).catch(() => {});
				},
				/** Be counted as "in this thread" (the peer's online dot). */
				enter: () => ready.then(() => channel.presence.enter({})).catch(() => {}),
				leave: () => channel.presence.leave().catch(() => {}),
				/** Whether anyone else is in the thread right now. */
				peerPresent: async () => {
					try {
						const members = await channel.presence.get();
						return members.some((m) => m.clientId && m.clientId !== args.profileId);
					} catch {
						return false;
					}
				},
				onPresence(handler: () => void) {
					void ready
						.then(() => channel.presence.subscribe(["enter", "leave", "present"], handler))
						.catch(() => {});
					return () => channel.presence.unsubscribe();
				},
			};
		},
		close() {
			client.connection.close();
		},
	};
}

export type MessagingRealtime = ReturnType<typeof connectRealtime>;

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return { message: text };
	}
}
