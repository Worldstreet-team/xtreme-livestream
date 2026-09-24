/**
 * The WorldSpace messaging contract (platform plan, phase 1, 2026-09-24).
 *
 * One set of schemas for what the gateway answers and what it accepts, so
 * the web client, the WorldSpace app and every other platform read the same
 * shapes instead of each typing them by hand (they had three copies before
 * this, and they had drifted). Zod, so a client can validate a payload it
 * does not trust and a server can validate a body it does not trust.
 *
 * The rule for changing it: ADD, never rename or remove. Consumers deploy on
 * their own cadence; a renamed field breaks a phone that shipped last month.
 * Same rule the category ids follow.
 */
import { z } from "zod";

/* ---------------- Primitives ---------------- */

export const objectIdSchema = z
	.string()
	.regex(/^[a-f\d]{24}$/i, "Invalid id");
export type ObjectId = z.infer<typeof objectIdSchema>;

/** ISO date string on the wire. */
export const isoDateSchema = z.string();

/** The front doors messaging answers. `worldspace` when a caller says nothing. */
export const PLATFORMS = [
	"worldspace",
	"app",
	"dashboard",
	"academy",
	"shop",
	"xstream",
] as const;
export const platformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof platformSchema>;

/* ---------------- People ---------------- */

export const messageSenderSchema = z.object({
	_id: objectIdSchema,
	username: z.string(),
	firstName: z.string().optional(),
	lastName: z.string().optional(),
	avatar: z.string().optional(),
	userId: z.string().optional(),
});
export type MessageSender = z.infer<typeof messageSenderSchema>;

export const participantSchema = messageSenderSchema.extend({
	lastSeenAt: isoDateSchema.optional(),
	isVerified: z.boolean().optional(),
	verification: z
		.object({ tier: z.enum(["bronze", "silver", "gold"]).optional() })
		.nullable()
		.optional(),
	badges: z
		.array(
			z.object({
				type: z.string(),
				tier: z.string().optional(),
			}),
		)
		.optional(),
});
export type Participant = z.infer<typeof participantSchema>;

/** The caller, as GET /v1/messaging/me answers. `onboarded` is false while
 *  the profile is a first-contact shadow made for another platform. */
export const identitySchema = z.object({
	id: objectIdSchema,
	username: z.string(),
	name: z.string(),
	avatar: z.string(),
	onboarded: z.boolean(),
});
export type Identity = z.infer<typeof identitySchema>;

/* ---------------- Messages ---------------- */

export const MESSAGE_TYPES = [
	"text",
	"image",
	"video",
	"audio",
	"call",
	"payment",
	"system",
	"contact",
] as const;
export const messageTypeSchema = z.enum(MESSAGE_TYPES);
export type MessageType = z.infer<typeof messageTypeSchema>;

export const reactionSchema = z.object({
	profile: objectIdSchema,
	emoji: z.string(),
});
export type Reaction = z.infer<typeof reactionSchema>;

export const replyRefSchema = z.object({
	_id: objectIdSchema,
	content: z.string(),
	type: messageTypeSchema,
	mediaUrl: z.string().optional(),
	durationSec: z.number().optional(),
	sender: messageSenderSchema,
});

/** A thread row, as GET /v1/messaging/:conversationId returns it and as
 *  the `message:new` event carries it. */
export const messageSchema = z.object({
	_id: objectIdSchema,
	conversationId: objectIdSchema,
	/** Populated on reads; a bare id can appear on some fan-outs. */
	sender: z.union([messageSenderSchema, objectIdSchema]),
	content: z.string(),
	type: messageTypeSchema,
	mediaUrl: z.string().optional(),
	/** Seconds, voice notes and clips. */
	durationSec: z.number().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	thumbhash: z.string().optional(),
	/** Voice-note waveform, 0..1. */
	peaks: z.array(z.number()).optional(),
	/** Pictures sent together share one key and render as one block. */
	groupKey: z.string().optional(),
	transcript: z.string().optional(),
	replyTo: replyRefSchema.nullable().optional(),
	reactions: z.array(reactionSchema).optional(),
	readBy: z.array(objectIdSchema).optional(),
	systemEvent: z
		.object({ kind: z.string(), params: z.record(z.string(), z.unknown()).optional() })
		.optional(),
	/** USD minor units, payment messages only. */
	amountMinor: z.number().optional(),
	payTo: objectIdSchema.optional(),
	payToName: z.string().optional(),
	contact: z
		.object({
			profile: objectIdSchema,
			name: z.string(),
			username: z.string().optional(),
			avatar: z.string().optional(),
		})
		.optional(),
	storyRef: z
		.object({
			story: objectIdSchema,
			thumbnail: z.string().optional(),
			authorUsername: z.string(),
		})
		.optional(),
	/** The sender's own id for the row: the same one comes back, so an
	 *  optimistic row and the stored row are one row. */
	clientKey: z.string().optional(),
	/** Which platform it was sent from; absent on rows older than 2026-09-24.
	 *  Show "via <platform>" when it differs from the one rendering it. */
	source: platformSchema.optional(),
	/** Groups: who this message mentions, by profile id. */
	mentions: z.array(objectIdSchema).optional(),
	/** Groups: an @everyone. */
	mentionAll: z.boolean().optional(),
	/** An admin removed it for everyone: content and media are gone and the
	 *  row stays as a tombstone. Render "Message removed by an admin". */
	removedBy: objectIdSchema.optional(),
	removedAt: isoDateSchema.optional(),
	createdAt: isoDateSchema,
	updatedAt: isoDateSchema.optional(),
});
export type Message = z.infer<typeof messageSchema>;

/** How each platform is named to people. */
export const PLATFORM_LABELS: Record<Platform, string> = {
	worldspace: "WorldSpace",
	app: "WorldSpace",
	dashboard: "Dashboard",
	academy: "Academy",
	shop: "Shop",
	xstream: "Xstream",
};

/** "via Xstream" when a message crossed platforms, otherwise nothing. */
export function viaLabel(source: Platform | undefined, here: Platform): string | null {
	if (!source) return null;
	const same = source === here || (["worldspace", "app"].includes(source) && ["worldspace", "app"].includes(here));
	return same ? null : `via ${PLATFORM_LABELS[source]}`;
}

/* ---------------- Conversations ---------------- */

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const conversationMemberSchema = z.object({
	profile: objectIdSchema,
	role: memberRoleSchema,
	joinedAt: isoDateSchema.optional(),
	leftAt: isoDateSchema.optional(),
	muted: z.boolean().optional(),
	archived: z.boolean().optional(),
	readUpTo: objectIdSchema.optional(),
	readUpToAt: isoDateSchema.optional(),
	theme: z.unknown().optional(),
});
export type ConversationMember = z.infer<typeof conversationMemberSchema>;

export const lastMessageSchema = z.object({
	_id: objectIdSchema.optional(),
	sender: z.union([messageSenderSchema, objectIdSchema]).optional(),
	content: z.string(),
	type: messageTypeSchema,
	mediaUrl: z.string().optional(),
	durationSec: z.number().optional(),
	amountMinor: z.number().optional(),
	systemEvent: z
		.object({ kind: z.string(), params: z.record(z.string(), z.unknown()).optional() })
		.optional(),
	createdAt: isoDateSchema,
});

/** What a thread is about when a platform opened it: an order, a course, a
 *  listing. Set once, by the first platform to open the thread; every
 *  client renders it as a chip that links back. */
export const threadContextSchema = z.object({
	kind: z.string().trim().min(1).max(40),
	id: z.string().trim().min(1).max(120),
	title: z.string().max(120).optional(),
	url: z.string().url().max(500).optional(),
});
export type ThreadContext = z.infer<typeof threadContextSchema>;

/** An inbox row from GET /v1/messaging/conversations: a bare array, sorted
 *  newest activity first by the server. */
/** A group call in progress: from the first ring to the starter's hang-up,
 *  reconciled against the live room whenever the group is read. */
export const groupCallSchema = z.object({
	startedBy: objectIdSchema,
	startedAt: isoDateSchema,
	video: z.boolean(),
	/** Who is in the room right now; only on GroupInfo. */
	participants: z.array(z.string()).optional(),
});
export type GroupCall = z.infer<typeof groupCallSchema>;

export const conversationRowSchema = z.object({
	_id: objectIdSchema,
	participants: z.array(participantSchema),
	kind: z.enum(["dm", "group"]),
	name: z.string().optional(),
	avatar: z.string().optional(),
	adminsOnly: z.boolean().optional(),
	/** A thread opened by someone the recipient does not follow is born a
	 *  request: listed apart, silent, until they reply or accept. */
	status: z.enum(["accepted", "request"]),
	initiator: objectIdSchema.optional(),
	/** Which platform opened it; absent on threads older than 2026-09-24. */
	source: platformSchema.optional(),
	context: threadContextSchema.optional(),
	lastMessage: lastMessageSchema.optional(),
	members: z.array(conversationMemberSchema).optional(),
	/** Archived BY THE CALLER; the other side's shelf is their own. */
	archived: z.boolean(),
	lastMessageAt: isoDateSchema.optional(),
	/** DMs only. Groups render from kind, name, avatar and memberCount. */
	otherParticipant: participantSchema.optional(),
	/** A group invite for the caller, listed with the requests. */
	isInvite: z.boolean().optional(),
	invite: z
		.object({
			by: z.union([messageSenderSchema, objectIdSchema]),
			at: isoDateSchema,
			expiresAt: isoDateSchema,
		})
		.optional(),
	myRole: memberRoleSchema.optional(),
	memberCount: z.number().optional(),
	/** Groups, admins' rows only: people asking to join. */
	requestCount: z.number().optional(),
	/** Groups: a call in progress, so the row can offer Join. */
	call: groupCallSchema.optional(),
	unreadCount: z.number(),
	isRequestForMe: z.boolean(),
	createdAt: isoDateSchema.optional(),
	updatedAt: isoDateSchema.optional(),
});
export type ConversationRow = z.infer<typeof conversationRowSchema>;

/* ---------------- Request bodies ---------------- */

export const sendMessageInputSchema = z.object({
	conversationId: objectIdSchema,
	content: z.string().max(4000).optional(),
	type: z.enum(["text", "image", "video", "audio", "contact"]).optional(),
	/** The `key` from an upload, never the short-lived `url`. */
	mediaUrl: z.string().optional(),
	durationSec: z.number().nonnegative().optional(),
	replyTo: objectIdSchema.optional(),
	/** Required in practice: it makes a resend safe. */
	clientKey: z.string().min(1).max(64),
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	thumbhash: z.string().optional(),
	peaks: z.array(z.number()).max(256).optional(),
	groupKey: z.string().optional(),
	contact: z.object({ profile: objectIdSchema }).optional(),
	/** Groups: the profile ids the text mentions. The gateway keeps the
	 *  ones on the roster and notifies them; a typed @handle with no id
	 *  still works, this is the sure way. */
	mentions: z.array(objectIdSchema).max(50).optional(),
	/** Groups: @everyone. Allowed by the group's mentionAll setting up to
	 *  32 members, admins only above that. Pushes through a mute. */
	mentionAll: z.boolean().optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const startConversationInputSchema = z.object({
	/** A profile id. */
	recipientId: objectIdSchema,
	context: threadContextSchema.optional(),
});

/** GET /v1/messaging/unread: the badge. */
export const unreadResultSchema = z.object({
	threads: z.number().int().nonnegative(),
	/** Unread messages that mention you (or @everyone), across groups. */
	mentions: z.number().int().nonnegative().optional(),
});
export type UnreadResult = z.infer<typeof unreadResultSchema>;
export type StartConversationInput = z.infer<typeof startConversationInputSchema>;

/* ---------------- Groups ---------------- */

/** Who may do what: "everyone" or "admins" per action. Owner and admins
 *  may always. `send: "admins"` is the announcement-style lock. */
export const groupPermissionSchema = z.enum(["everyone", "admins"]);
export const GROUP_SETTING_KEYS = [
	"send",
	"media",
	"addMembers",
	"editInfo",
	"pin",
	"calls",
	"mentionAll",
	"money",
] as const;
export const groupSettingsSchema = z.object(
	Object.fromEntries(GROUP_SETTING_KEYS.map((k) => [k, groupPermissionSchema.optional()])) as Record<
		(typeof GROUP_SETTING_KEYS)[number],
		z.ZodOptional<typeof groupPermissionSchema>
	>,
);
export type GroupSettings = z.infer<typeof groupSettingsSchema>;

/** A person's own rule for being put into groups: their privacy setting
 *  `privacy.groupAdd`. Anyone the rule does not admit gets an invite. */
export const GROUP_ADD_RULES = ["everyone", "following", "allies", "nobody"] as const;
export const groupAddRuleSchema = z.enum(GROUP_ADD_RULES);
export type GroupAddRule = z.infer<typeof groupAddRuleSchema>;

export const createGroupInputSchema = z.object({
	name: z.string().trim().min(1).max(80),
	memberIds: z.array(objectIdSchema).min(1),
	/** A key from an upload, never a URL of your own. */
	avatar: z.string().optional(),
	description: z.string().max(500).optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupInputSchema>;

export const updateGroupInputSchema = z.object({
	name: z.string().trim().min(1).max(80).optional(),
	avatar: z.string().optional(),
	description: z.string().max(500).optional(),
	settings: groupSettingsSchema.optional(),
	/** Whether people added later read what came before they joined. */
	historyVisible: z.boolean().optional(),
	/** Approve new members: link joins and members' adds wait for an admin. */
	joinApproval: z.boolean().optional(),
	/** Legacy: the same as settings.send = "admins". */
	adminsOnly: z.boolean().optional(),
});
export type UpdateGroupInput = z.infer<typeof updateGroupInputSchema>;

/** What happened to each person you tried to add. */
export const ADD_OUTCOMES = ["added", "invited", "already", "pending", "blocked", "banned", "full", "unknown"] as const;
export const addOutcomeSchema = z.enum(ADD_OUTCOMES);
export type AddOutcome = z.infer<typeof addOutcomeSchema>;
export const addResultSchema = z.object({ id: objectIdSchema, status: addOutcomeSchema });
export const addMembersResultSchema = z.object({
	success: z.boolean(),
	added: z.number(),
	invited: z.number().optional(),
	results: z.array(addResultSchema),
});
export type AddMembersResult = z.infer<typeof addMembersResultSchema>;

/** GET /v1/messaging/groups/:id */
export const groupInfoSchema = z.object({
	id: objectIdSchema,
	name: z.string().optional(),
	description: z.string(),
	avatar: z.string().optional(),
	createdAt: isoDateSchema.optional(),
	createdBy: objectIdSchema.optional(),
	source: platformSchema.optional(),
	context: threadContextSchema.optional(),
	memberCount: z.number(),
	adminCount: z.number(),
	/** Admins only. */
	pendingCount: z.number().optional(),
	settings: groupSettingsSchema,
	historyVisible: z.boolean(),
	joinApproval: z.boolean(),
	call: groupCallSchema.nullable(),
	me: z.object({
		role: memberRoleSchema.nullable(),
		joinedAt: isoDateSchema.optional(),
		leftAt: isoDateSchema.optional(),
		muted: z.boolean(),
		mutedUntil: isoDateSchema.optional(),
		archived: z.boolean(),
		invited: z.object({ by: objectIdSchema, expiresAt: isoDateSchema }).optional(),
		/** Every action, true or false, so no client re-implements the policy. */
		permissions: z.record(z.string(), z.boolean()),
	}),
});
export type GroupInfo = z.infer<typeof groupInfoSchema>;

/** GET /v1/messaging/groups/:id/members */
export const groupRosterSchema = z.object({
	total: z.number(),
	offset: z.number(),
	members: z.array(
		z.object({
			profile: participantSchema,
			role: memberRoleSchema,
			joinedAt: isoDateSchema.optional(),
		}),
	),
});
export type GroupRoster = z.infer<typeof groupRosterSchema>;

/** Someone on the way in: an invite from a member, or a request to join. */
export const groupPendingSchema = z.object({
	profile: z.union([participantSchema, objectIdSchema]),
	kind: z.enum(["invite", "request"]),
	by: z.union([messageSenderSchema, objectIdSchema]),
	at: isoDateSchema,
	expiresAt: isoDateSchema,
});
export type GroupPending = z.infer<typeof groupPendingSchema>;

/** POST /v1/messaging/groups/:id/links */
export const createGroupLinkInputSchema = z.object({
	title: z.string().trim().max(60).optional(),
	/** No expiry when absent. */
	expiresIn: z.enum(["1d", "7d", "30d"]).optional(),
	/** No limit when absent. */
	maxUses: z.number().int().positive().optional(),
	/** Joining through this link waits for an admin. */
	approval: z.boolean().optional(),
});
export type CreateGroupLinkInput = z.infer<typeof createGroupLinkInputSchema>;

export const groupLinkSchema = z.object({
	code: z.string(),
	by: z.union([messageSenderSchema, objectIdSchema]),
	at: isoDateSchema,
	title: z.string().optional(),
	expiresAt: isoDateSchema.optional(),
	maxUses: z.number().optional(),
	uses: z.number(),
	approval: z.boolean().optional(),
	revokedAt: isoDateSchema.optional(),
});
export type GroupLink = z.infer<typeof groupLinkSchema>;

/** Where a link opens: `/join/<code>` on every platform. */
export const groupLinkPath = (code: string) => `/join/${code}`;

/** GET /v1/messaging/groups/links/:code, safe to show before joining. */
export const LINK_STATES = ["NOT_FOUND", "REVOKED", "EXPIRED", "USED_UP"] as const;
export const groupLinkPreviewSchema = z.object({
	id: objectIdSchema,
	name: z.string().optional(),
	avatar: z.string().optional(),
	description: z.string(),
	memberCount: z.number(),
	faces: z.array(
		z.object({
			_id: objectIdSchema,
			firstName: z.string().optional(),
			username: z.string(),
			avatar: z.string().optional(),
		}),
	),
	/** Joining will wait for an admin. */
	approval: z.boolean(),
	/** false with `why` when the link no longer works. */
	open: z.boolean(),
	why: z.enum(LINK_STATES).nullable(),
	alreadyIn: z.boolean(),
});
export type GroupLinkPreview = z.infer<typeof groupLinkPreviewSchema>;

/** POST /v1/messaging/groups/links/:code/join */
export const joinByLinkResultSchema = z.object({
	success: z.boolean(),
	conversationId: objectIdSchema.optional(),
	/** Already a member. */
	already: z.boolean().optional(),
	/** Waiting for an admin (HTTP 202). */
	requested: z.boolean().optional(),
});
export type JoinByLinkResult = z.infer<typeof joinByLinkResultSchema>;

export const groupBanSchema = z.object({
	profile: z.union([participantSchema, objectIdSchema]),
	by: z.union([messageSenderSchema, objectIdSchema]),
	at: isoDateSchema,
	/** Absent: for good. */
	until: isoDateSchema.optional(),
});
export type GroupBan = z.infer<typeof groupBanSchema>;

export const pastMemberSchema = z.object({
	profile: participantSchema,
	leftAt: isoDateSchema,
});
export type PastMember = z.infer<typeof pastMemberSchema>;

/** GET /v1/messaging/message/:id/receipts, the sender only. */
export const messageReceiptsSchema = z.object({
	readBy: z.array(z.object({ profile: messageSenderSchema, readAt: isoDateSchema })),
	/** Everyone who could have read it. */
	total: z.number(),
});
export type MessageReceipts = z.infer<typeof messageReceiptsSchema>;

export const muteInputSchema = z.object({
	/** null unmutes. */
	until: z.enum(["8h", "1w", "forever"]).nullable(),
});
export type MuteInput = z.infer<typeof muteInputSchema>;

/** Codes a group refusal can carry, beside its message. */
export const GROUP_ERROR_CODES = [
	"NOT_MEMBER",
	"NOT_ADMIN",
	"NOT_OWNER",
	"ADMINS_ONLY",
	"MEDIA_ADMINS_ONLY",
	"GROUP_FULL",
	"INVITE_EXPIRED",
	"NOBODY_ADDABLE",
	"BAD_AVATAR",
	"UNDELETABLE",
	"BANNED",
	"NOT_FOUND",
	"REVOKED",
	"EXPIRED",
	"USED_UP",
] as const;

export const markReadInputSchema = z.object({
	/** The newest message id read; the server takes "now" when absent. */
	upTo: objectIdSchema.optional(),
});
export type MarkReadInput = z.infer<typeof markReadInputSchema>;

export const reactInputSchema = z.object({ emoji: z.string().min(1).max(16) });
export type ReactInput = z.infer<typeof reactInputSchema>;

export const archiveInputSchema = z.object({ archived: z.boolean() });

export const uploadResultSchema = z.object({
	/** Store this as `mediaUrl`. */
	key: z.string(),
	/** A short-lived read for the sender's own preview. */
	url: z.string(),
	type: z.string(),
});
export type UploadResult = z.infer<typeof uploadResultSchema>;

/* ---------------- Calls ---------------- */

export const CALL_SIGNALS = [
	"call:accept",
	"call:decline",
	"call:end",
	"call:busy",
	"call:cancel",
] as const;
export const callSignalSchema = z.enum(CALL_SIGNALS);
export type CallSignal = z.infer<typeof callSignalSchema>;

export const callTokenInputSchema = z.object({ conversationId: objectIdSchema });
export const callTokenResultSchema = z.object({
	token: z.string(),
	url: z.string(),
	room: z.string(),
});
export type CallTokenResult = z.infer<typeof callTokenResultSchema>;

export const ringInputSchema = z.object({
	conversationId: objectIdSchema,
	video: z.boolean().optional(),
});
export const signalInputSchema = z.object({
	conversationId: objectIdSchema,
	type: callSignalSchema,
});
export const logCallInputSchema = z.object({
	conversationId: objectIdSchema,
	outcome: z.string(),
	video: z.boolean().optional(),
	durationSec: z.number().nonnegative().optional(),
});

/** What rings on `calls:<profileId>` as `call:incoming`. The caller card is
 *  built by the server from the database, never from the request. */
export const callIncomingSchema = z.object({
	conversationId: objectIdSchema,
	room: z.string(),
	caller: z.object({
		id: objectIdSchema,
		name: z.string(),
		username: z.string().optional(),
		avatar: z.string().optional(),
	}),
	isVideo: z.boolean(),
	startedAt: z.number(),
	kind: z.enum(["dm", "group"]),
	group: z
		.object({ name: z.string(), memberCount: z.number() })
		.optional(),
});
export type CallIncoming = z.infer<typeof callIncomingSchema>;

/* ---------------- Realtime ---------------- */

/**
 * Events the gateway publishes on `user:<profileId>` under the name
 * "event". Everything a client needs to keep an inbox and an open thread
 * current; real messages ONLY ever arrive this way, never client to client.
 */
export const userEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("message:new"),
		message: messageSchema,
		conversationId: objectIdSchema,
	}),
	z.object({
		type: z.literal("message:read"),
		conversationId: objectIdSchema,
		readerId: objectIdSchema,
		readUpTo: objectIdSchema,
		readAt: z.number(),
	}),
	z.object({
		type: z.literal("message:unsent"),
		conversationId: objectIdSchema,
		messageId: objectIdSchema,
	}),
	z.object({
		type: z.literal("conversation:removed"),
		conversationId: objectIdSchema,
		/** true when the caller left, false when they were removed. */
		left: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("conversation:deleted"),
		conversationId: objectIdSchema,
	}),
	z.object({ type: z.literal("theme:updated") }),
	// Groups (audit G150): structured, beside the system rows.
	z.object({
		type: z.literal("invite:received"),
		conversationId: objectIdSchema,
		name: z.string(),
		by: objectIdSchema,
		expiresAt: isoDateSchema,
	}),
	z.object({
		type: z.literal("group:updated"),
		conversationId: objectIdSchema,
		patch: z.record(z.string(), z.unknown()),
	}),
	z.object({
		type: z.literal("member:joined"),
		conversationId: objectIdSchema,
		profileIds: z.array(objectIdSchema),
		by: objectIdSchema,
	}),
	z.object({
		type: z.literal("member:left"),
		conversationId: objectIdSchema,
		profileId: objectIdSchema,
		by: objectIdSchema,
		/** Admins only hear this one; no row was posted. */
		quiet: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("member:removed"),
		conversationId: objectIdSchema,
		profileId: objectIdSchema,
		by: objectIdSchema,
		banned: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("member:role"),
		conversationId: objectIdSchema,
		profileId: objectIdSchema,
		role: memberRoleSchema,
	}),
	/** An admin removed a message for everyone; render the tombstone. */
	z.object({
		type: z.literal("message:removed"),
		conversationId: objectIdSchema,
		messageId: objectIdSchema,
		by: objectIdSchema,
	}),
	/** Admins: people asking to join. */
	z.object({
		type: z.literal("request:received"),
		conversationId: objectIdSchema,
		count: z.number(),
	}),
	z.object({
		type: z.literal("call:started"),
		conversationId: objectIdSchema,
		by: objectIdSchema,
		video: z.boolean(),
	}),
	z.object({
		type: z.literal("call:ended"),
		conversationId: objectIdSchema,
	}),
]);
export type UserEvent = z.infer<typeof userEventSchema>;
export type UserEventType = UserEvent["type"];

/**
 * Signals two people in a thread send each other directly on
 * `conversation:<id>`, never through the gateway: a round trip would make
 * a typing indicator slower than the typing it reports. Ephemeral by
 * design; nothing here is stored and nothing here is a message.
 */
export const THREAD_SIGNALS = [
	"typing",
	"typing:stop",
	"recording",
	"reaction",
	"delivered",
	"read",
] as const;
export const threadSignalNameSchema = z.enum(THREAD_SIGNALS);
export type ThreadSignalName = z.infer<typeof threadSignalNameSchema>;

export const threadSignalSchema = z.object({
	/** Payload schema version; bump when the shape changes. */
	v: z.literal(1),
	from: objectIdSchema,
	at: z.number(),
	messageId: objectIdSchema.optional(),
	reactions: z.array(reactionSchema).optional(),
});
export type ThreadSignal = z.infer<typeof threadSignalSchema>;

/** The channels a token grants, by name, so a client never guesses. */
export const channels = {
	user: (profileId: string) => `user:${profileId}`,
	calls: (profileId: string) => `calls:${profileId}`,
	conversation: (conversationId: string) => `conversation:${conversationId}`,
	presence: "presence",
} as const;

/* ---------------- Errors ---------------- */

/** Every error body the gateway sends: `message` always, `code` sometimes. */
export const apiErrorSchema = z.object({
	message: z.string(),
	code: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
