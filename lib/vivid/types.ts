/**
 * Local copies of the two types the Vivid voice stack needs from the web
 * app's @worldstreet/vivid-voice package. Xtreme deliberately does not take
 * that dependency: the package drags in the trading tools and a server-action
 * function runner that this app doesn't use.
 */

export type VividAgentState =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "processing"
  | "speaking"
  | "error"

export type JSONSchema = {
  type: "object"
  properties: Record<string, unknown>
  required?: string[]
}

export interface VoiceFunctionConfig<P = Record<string, unknown>, R = unknown> {
  name: string
  description: string
  parameters: JSONSchema
  handler: (params: P) => Promise<R> | R
  /** 'client' runs in the browser; 'server' is routed to /api/vivid/function. */
  executionContext?: "client" | "server"
}

/** OpenAI-style function definition — the shape Sira takes on the mint. */
export type VividVoiceTool = {
  type: "function"
  name: string
  description: string
  parameters: Record<string, unknown>
}
