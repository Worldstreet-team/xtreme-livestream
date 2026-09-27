#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CARDS, GRAPHICS, LAYOUTS, PADS, STEPS, calls, failureText, toRequest, type ControlCall } from "./calls.js";

/**
 * Xtream's control API as an MCP server, over stdio: the studio's buttons —
 * scenes, graphics, sounds, the run of show, the rules — for Claude Code,
 * Claude Desktop or any MCP client, signed in with a control key. Nothing
 * here moves money or touches anyone's account; the key's scopes say what
 * it may do, and the API says no in words when it may not.
 */

const base = (process.env.XTREAM_API_URL ?? "http://localhost:3001/api").replace(/\/+$/, "");
const key = process.env.XTREAM_CONTROL_KEY ?? "";
if (!key) {
  // stderr: stdout is the MCP wire.
  console.error("xtream-control-mcp: set XTREAM_CONTROL_KEY to a control key (xck_…) — make one in Xtream under Settings → Stream Deck & automation.");
  process.exit(1);
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const said = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

/** Make the call: the API's answer as text, its refusal as an error the assistant can read out. */
async function run(call: ControlCall): Promise<ToolResult> {
  const { url, method, headers, body } = toRequest(base, key, call);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, ...(body ? { body } : {}) });
  } catch (err) {
    return said(`Couldn't reach the Xtream API at ${base} (${err instanceof Error ? err.message : String(err)}) — is it running, and is XTREAM_API_URL right?`, true);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON — said below as it came.
  }
  if (!res.ok) return said(failureText(call, res.status, json ?? { message: text.slice(0, 200) }), true);
  const data = json && typeof json === "object" && "data" in json ? (json as { data: unknown }).data : json;
  return said(JSON.stringify(data, null, 2));
}

const server = new McpServer({ name: "xtream-control", version: "0.1.0" });

const LAYOUT_WORDS =
  "auto splits by who's on; solo is the host alone; split, trio and grid bring in one, two or three guests; screen-face puts the shared screen up with the host's camera in a corner; chart-face a live market chart with the host's camera in a corner.";
const CARD_WORDS = "starting-soon, brb (Be right back) or ending (Thanks for watching); null takes the card down.";
const seconds = (min: number, max: number, then: string) => z.number().int().min(min).max(max).optional().describe(`${min}–${max}; ${then}`);

/** A show-rule action, as POST /control/do takes it — and as xtream_do passes it on. */
const actionSchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("layout"), layout: z.enum(LAYOUTS).describe(LAYOUT_WORDS) }),
  z.object({ do: z.literal("card"), card: z.enum(CARDS).nullable().describe(CARD_WORDS), seconds: seconds(5, 600, "then taken down again — or leave it out to keep the card up").nullable() }),
  z.object({
    do: z.literal("lower_third"),
    title: z.string().min(1).max(48).describe("A name, usually"),
    subtitle: z.string().max(72).optional().describe("Who they are"),
    seconds: seconds(3, 300, "8 if left out; null keeps it up").nullable(),
  }),
  z.object({ do: z.literal("banner"), text: z.string().min(1).max(100), seconds: seconds(3, 600, "15 if left out; null keeps it up").nullable() }),
  z.object({ do: z.literal("hide"), graphic: z.enum(GRAPHICS).describe("Take this graphic down") }),
  z.object({ do: z.literal("countdown"), minutes: z.number().int().min(1).max(120), label: z.string().max(40).optional() }),
  z.object({ do: z.literal("sound"), pad: z.enum(PADS).describe("A pad on the host's audio desk; it plays in the studio") }),
]);

server.registerTool(
  "xtream_state",
  {
    title: "What's on",
    description:
      "Whether the channel is live, and what's on: the scene (layout, card, which graphics are up), where the run of show is (how many segments, what's on air, what's next) and the show rules with their ids. Ask this first; everything else needs the channel live.",
    annotations: { readOnlyHint: true },
  },
  () => run(calls.state()),
);

server.registerTool(
  "xtream_do",
  {
    title: "Do these, now",
    description:
      "Change the scene, put graphics up or down, play a sound — one to four actions, applied together to the live stream, exactly as POST /control/do takes them (the show rules' actions). The single-action tools (xtream_card, xtream_lower_third, xtream_banner, xtream_layout, xtream_sound) are simpler when one thing will do.",
    inputSchema: { actions: z.array(actionSchema).min(1).max(4) },
  },
  ({ actions }) => run(calls.do(actions)),
);

server.registerTool(
  "xtream_show",
  {
    title: "Run the show",
    description:
      "Move the run of show: start begins it at the first segment, next goes to the following segment and puts its cues up (layout, card, lower third, banner, countdown), stop ends it. Needs a run of show written in the studio. Answers with what's on air and what's next.",
    inputSchema: { step: z.enum(STEPS) },
  },
  ({ step }) => run(calls.show(step)),
);

server.registerTool(
  "xtream_fire_rule",
  {
    title: "Fire a rule",
    description: "Do what a show rule does, now, with sample words where the rule expects a viewer's name or an amount. Rule ids come from xtream_state.",
    inputSchema: { id: z.string().regex(/^[a-f0-9]{24}$/, "A rule id from xtream_state").describe("The rule's id") },
  },
  ({ id }) => run(calls.fireRule(id)),
);

server.registerTool(
  "xtream_card",
  {
    title: "Put a card up",
    description: `A full-frame card over the program: ${CARD_WORDS} With seconds, it comes down by itself; without, it stays until it's taken down.`,
    inputSchema: { card: z.enum(CARDS).nullable(), seconds: seconds(5, 600, "then taken down again") },
  },
  ({ card, seconds }) => run(calls.card(card, seconds)),
);

server.registerTool(
  "xtream_lower_third",
  {
    title: "Put a lower third up",
    description: "A name and a line under it, in the creator's brand colour — for a guest, a caller, the host. Up for 8 seconds unless told otherwise; one lower third at a time (a new one replaces the last).",
    inputSchema: {
      title: z.string().min(1).max(48).describe("The name"),
      subtitle: z.string().max(72).optional().describe("Who they are, or what they're here for"),
      seconds: seconds(3, 300, "8 if left out"),
    },
  },
  ({ title, subtitle, seconds }) => run(calls.lowerThird(title, subtitle, seconds)),
);

server.registerTool(
  "xtream_banner",
  {
    title: "Put a banner up",
    description: "A line of text across the program — a thank-you, a code, a heads-up. Up for 15 seconds unless told otherwise; one banner at a time.",
    inputSchema: { text: z.string().min(1).max(100), seconds: seconds(3, 600, "15 if left out") },
  },
  ({ text, seconds }) => run(calls.banner(text, seconds)),
);

server.registerTool(
  "xtream_layout",
  {
    title: "Change the layout",
    description: `How the program is laid out: ${LAYOUT_WORDS}`,
    inputSchema: { layout: z.enum(LAYOUTS) },
  },
  ({ layout }) => run(calls.layout(layout)),
);

server.registerTool(
  "xtream_sound",
  {
    title: "Play a sound",
    description: "Play a pad on the host's audio desk — airhorn, applause, drumroll, kaching, badumtss, whoosh, levelup, sadtrombone. It plays in the studio and goes out with the stream.",
    inputSchema: { pad: z.enum(PADS) },
  },
  ({ pad }) => run(calls.sound(pad)),
);

await server.connect(new StdioServerTransport());
