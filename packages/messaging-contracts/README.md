# @worldstreet/messaging-contracts

The shapes of the WorldSpace messaging API as zod schemas and TypeScript
types: messages, inbox rows, request bodies, realtime events, call signals.
The gateway answers in these shapes; the web client, the WorldSpace app and
any other platform read them from here instead of typing them by hand.

```ts
import { messageSchema, type ConversationRow } from "@worldstreet/messaging-contracts";

const message = messageSchema.parse(payload); // throws on a shape you do not expect
```

## Rules

- Add fields, never rename or remove them. Consumers deploy on their own
  cadence; a renamed field breaks a phone that shipped last month.
- A new route in the gateway's `message.routes.ts` gets its body and its
  answer described here, and a line in `src/docs/messaging-openapi.ts`.
- Optional on the wire means optional here. Do not tighten a field because
  the current gateway always sends it.

## Build

```bash
cd packages/messaging-contracts
npm install
npm run build
```

Consumed by `@worldstreet/messaging-sdk` through `file:../messaging-contracts`
for now; publish both to the GitHub Packages registry once the shapes settle
(npm cannot install a subdirectory of a git repository).
