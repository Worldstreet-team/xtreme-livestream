# @worldstreet/messaging-sdk

A typed client for the WorldSpace messaging API: threads, messages, media,
calls and realtime, for any WorldStreet platform. Plain `fetch`, a token
getter you supply, Ably handed in rather than bundled, so the one package
runs in a browser, in Next.js and in React Native.

## Use

```ts
import * as Ably from "ably";
import { createMessaging } from "@worldstreet/messaging-sdk";

const messaging = createMessaging({
  baseUrl: "https://social-api.worldstreetgold.com",
  platform: "dashboard", // worldspace | app | dashboard | academy | shop | xstream
  getToken: () => window.Clerk.session.getToken(),
});

// Who am I here (made on first contact for a platform user)
const me = await messaging.me();

// Inbox and a thread
const inbox = await messaging.conversations.list();
const thread = await messaging.conversations.open(sellerProfileId);
const page = await messaging.messages.list(thread._id, { limit: 50 });
await messaging.messages.send({
  conversationId: thread._id,
  content: "Is this still in stock?",
  clientKey: crypto.randomUUID(), // makes a retry safe
});

// Media: store `key` as mediaUrl, `url` is a short-lived preview
const { key } = await messaging.media.upload(file, thread._id);

// Realtime
const live = messaging.realtime.connect(Ably, me.id);
const stop = live.onEvent((event) => {
  if (event.type === "message:new") inbox.bump(event.message);
});
const signals = live.thread(thread._id);
signals.onSignal((name, s) => { if (name === "typing") showTyping(s.from); });
signals.send("typing");
```

Every method throws `MessagingError` with the gateway's `status`, `message`
and `code` when a request is refused; `status` 0 means it never answered.

## Rules the API enforces, whichever platform calls

- A thread opened with someone who does not follow you is born a request on
  their side: listed apart, silent, until they reply or accept.
- Blocks are absolute. "Who can message me" settings apply everywhere.
- Real messages arrive only through `onEvent` (`user:<id>` on Ably). The
  thread channel carries typing, receipts and reactions between clients and
  is never a source of messages.
- The realtime token names the threads you are in. A thread newer than your
  token is picked up automatically (one re-auth with a hint).

## Build

```bash
cd packages/messaging-contracts && npm install && npm run build
cd ../messaging-sdk && npm install && npm run build
```

Publish both to the GitHub Packages registry once the shapes settle; until
then consume through a local path or `npm pack`.

## What is not in the SDK

- UI. Each platform renders threads in its own design language.
- Encryption. End-to-end encryption is designed and will live here, so every
  platform shares one implementation.
