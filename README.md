# Xtreme Worldstreet

Xtreme Worldstreet is a livestreaming platform with a Next.js web client and a
standalone Fastify API designed to serve both web and React Native clients.

## Repository layout

```text
app/                  Next.js web application
components/           Web UI
lib/                  Legacy/in-process Next.js backend helpers
packages/contracts/   Shared validation schemas and TypeScript contracts
services/api/         Standalone Fastify service
```

The existing Next.js route handlers remain available during migration. New
clients should use the standalone service's `/v1` API. The service also exposes
the old route shape under `/api`, which lets the web client migrate without
changing every path at once.

## Web application

```bash
npm install
npm run dev
```

The web application runs on `http://localhost:3000`.

## API service

Copy `services/api/.env.example` to `services/api/.env`, fill in the values,
then run:

```bash
npm run build:api
npm run dev:api
```

The API defaults to `http://localhost:3001`:

- API: `http://localhost:3001/v1`
- OpenAPI UI: `http://localhost:3001/docs`
- Liveness: `http://localhost:3001/health/live`
- Readiness: `http://localhost:3001/health/ready`

See [services/api/README.md](services/api/README.md) for authentication,
endpoint, mobile-client, and Coolify deployment details.

## Checks

```bash
npm run build:api
npm run test:api
npm run lint
```
