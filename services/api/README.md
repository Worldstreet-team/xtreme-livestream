# Xtreme Worldstreet API

This is the standalone backend for the Xtreme Worldstreet web and React Native
clients. It uses Fastify 5, Clerk, MongoDB, Mongoose, and LiveKit.

## Run locally

From the repository root:

```bash
npm install
copy services\api\.env.example services\api\.env
npm run build:api
npm run dev:api
```

The service validates all required environment variables before opening a
network port. A missing secret causes a clear startup failure.

## Authentication

Protected endpoints accept a Clerk session token:

```http
Authorization: Bearer <clerk-session-token>
```

Clerk's Fastify plugin also recognizes Clerk session cookies, allowing the web
client and mobile client to use the same service. The API provisions the local
MongoDB user profile on the first authenticated request.

In an Expo/React Native client, retrieve a token with Clerk and send it with
each protected request:

```ts
const { getToken } = useAuth();
const token = await getToken();

const response = await fetch(`${API_URL}/v1/user/me`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

Native requests generally do not send an `Origin` header. Browser origins must
be listed in both `CORS_ORIGINS` and, where applicable,
`CLERK_AUTHORIZED_PARTIES`.

## Routes

The canonical prefix is `/v1`. Identical compatibility routes are exposed under
`/api` while the Next.js application is migrated.

| Method | Route | Authentication | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/streams` | Public | List and search streams |
| POST | `/v1/streams` | Required | Start a stream and get a publisher token |
| GET | `/v1/streams/:id` | Public | Get stream details |
| PATCH | `/v1/streams/:id` | Owner | Update a stream |
| GET | `/v1/streams/:id/token` | Required | Get a viewer token |
| POST | `/v1/streams/:id/end` | Owner | End a stream |
| GET | `/v1/streams/:id/chat` | Public | Get chat history |
| POST | `/v1/streams/:id/chat` | Required | Persist a chat message |
| GET | `/v1/user/me` | Required | Get the local user profile |
| PATCH | `/v1/user/me` | Required | Update the local user profile |
| GET | `/v1/user/:username` | Optional | Get a public profile |
| POST | `/v1/user/:username/follow` | Required | Follow a user |
| DELETE | `/v1/user/:username/follow` | Required | Unfollow a user |
| GET | `/v1/dashboard/stats` | Required | Get creator analytics |
| POST | `/v1/webhooks/livekit` | LiveKit signature | Process room events |

Interactive OpenAPI documentation is served at `/docs`.

## Realtime model

REST persists users, streams, follows, settings, analytics, and chat history.
LiveKit transports video, audio, and realtime data messages. A mobile client:

1. Authenticates with Clerk.
2. Starts a stream or requests a viewer token from this API.
3. Connects with LiveKit's React Native SDK using `livekitUrl` and the token.
4. Publishes realtime chat over LiveKit data messages.
5. Persists each chat message through the REST endpoint.

LiveKit webhooks are the primary stream-disconnect signal. API reads also
reconcile older streams against the actual LiveKit room state.

## Deploy on Coolify

Create a Dockerfile-based resource from this repository with:

- Build context: repository root
- Dockerfile: `services/api/Dockerfile`
- Exposed/container port: `3001`
- Health check path: `/health/ready`
- Suggested domain: `https://api.worldstreetgold.com`

Set all variables from `.env.example` in Coolify's environment panel. For a
reverse-proxied production deployment, use:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
TRUST_PROXY=true
CORS_ORIGINS=https://worldstreetgold.com,https://www.worldstreetgold.com
CLERK_AUTHORIZED_PARTIES=https://worldstreetgold.com,https://www.worldstreetgold.com
```

Do not bake any `.env` file into the image. The Docker image runs as a
non-root user and has an internal liveness check.

After deployment:

1. Confirm `https://api.worldstreetgold.com/health/ready` returns HTTP 200.
2. Add `https://api.worldstreetgold.com/v1/webhooks/livekit` to the LiveKit
   project's webhook settings.
3. Add the API domain and web domains to the relevant Clerk allowed-origin and
   satellite-domain settings.
4. Keep MongoDB private to the Coolify network or restrict it to the server.

## Operational notes

- `/health/live` proves the process is accepting requests.
- `/health/ready` returns 503 until MongoDB is connected.
- Request IDs are included in error responses and structured logs.
- Authorization headers, cookies, and `Set-Cookie` values are redacted.
- Global and route-specific rate limits are enabled.
- The server drains requests and disconnects MongoDB on `SIGTERM`, which is
  the shutdown signal Coolify sends during a deployment.
