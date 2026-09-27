# @xtreme/control-mcp

Xtream's control API as an MCP server: the studio's buttons — scenes,
graphics, sounds, the run of show and your rules — for Claude Code, Claude
Desktop or any MCP client, signed in with a control key. It talks to the
API over plain HTTP, from your machine; nothing here moves money or touches
anyone's account, and the key can only do what its scopes allow.

## Set up

1. In Xtream, make a key under **Settings → Stream Deck & automation** with
   the scopes the assistant should have (scene, sound, show, rules). It's
   shown once.
2. Build the server once, from the repo root (the `dist/` it writes stays
   out of git):

   ```sh
   node_modules/.bin/tsc -p packages/control-mcp/tsconfig.json
   ```

It reads two environment variables:

| Variable             | What it is                                                     |
| -------------------- | -------------------------------------------------------------- |
| `XTREAM_CONTROL_KEY` | The key (`xck_…`). Required; the server exits without it.      |
| `XTREAM_API_URL`     | The API's base. Default `http://localhost:3001/api`.           |

### Claude Code

From the repo root:

```sh
claude mcp add xtream -e XTREAM_CONTROL_KEY=xck_… -- node packages/control-mcp/dist/index.js
```

Add `-e XTREAM_API_URL=https://api.example.com/api` for a deployed API.
Then, in a session: "put up a lower third for Ada K, our guest" or "go to
the next segment".

### Claude Desktop

In `claude_desktop_config.json` (Settings → Developer → Edit Config), with
the absolute path to the built server:

```json
{
  "mcpServers": {
    "xtream": {
      "command": "node",
      "args": ["/path/to/xtreme-livestream/packages/control-mcp/dist/index.js"],
      "env": {
        "XTREAM_CONTROL_KEY": "xck_…",
        "XTREAM_API_URL": "http://localhost:3001/api"
      }
    }
  }
}
```

## Tools

| Tool                 | What it does                                                                                                    | Scope   |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ------- |
| `xtream_state`       | What's on: live or not, the scene, where the run of show is, the rules and their ids. Ask this first.            | any     |
| `xtream_do`          | One to four actions at once, exactly as `POST /control/do` takes them.                                          | scene (sound for a sound) |
| `xtream_show`        | `start`, `next` or `stop` the run of show; `next` puts the segment's cues up.                                    | show    |
| `xtream_fire_rule`   | Do what a show rule does, now, with sample words.                                                                | rules   |
| `xtream_card`        | `starting-soon`, `brb`, `ending`, or `null` to take the card down; optionally for some seconds.                  | scene   |
| `xtream_lower_third` | A name and a line under it, up for 8 seconds unless told otherwise.                                             | scene   |
| `xtream_banner`      | A line of text across the program, up for 15 seconds unless told otherwise.                                     | scene   |
| `xtream_layout`      | `auto`, `solo`, `split`, `trio`, `grid`, `screen-face` or `chart-face`.                                          | scene   |
| `xtream_sound`       | A pad on the audio desk: `airhorn`, `applause`, `drumroll`, `kaching`, `badumtss`, `whoosh`, `levelup`, `sadtrombone`. | sound   |

Every tool answers with the API's JSON. When the API says no — the channel
isn't live, the key lacks a scope, the rule is gone — the tool returns an
error in the API's own words, so the assistant can say why.

## Events

The API also has a feed of what happens on the stream — a scene change, a
rule firing, a gift, a guest coming up — as server-sent events:

```sh
curl -N http://localhost:3001/api/control/events -H "Authorization: Bearer xck_…"
```

That's for scripts that listen; this server is for assistants that act.
