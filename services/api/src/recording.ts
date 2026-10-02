import { randomBytes } from "node:crypto";
import type { Types } from "mongoose";
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  S3Upload,
  type EgressInfo,
} from "livekit-server-sdk";
import type { ReplayView } from "@xtreme/contracts";
import { config } from "./config.js";
import { Stream, type IStream, type IStreamRecording, type IStreamRecordingPart } from "./models.js";

/**
 * Stream recording: a broadcast the host chose to record on go-live is
 * recorded as the program viewers saw — LiveKit's room-composite egress
 * opens the web app's recording page (app/record/[id], the same
 * SceneRenderer the watch page draws: layouts, guests, graphics, cards),
 * records it at 720p, the most a browser feed sends, and writes an MP4
 * straight to the R2 bucket. The replay plays from the bucket's public URL.
 *
 * Lifecycle:
 *  - starts when the stream's feed joins its room (the webhook) — not at
 *    go-live, when the room may not exist yet;
 *  - stops when the stream ends (markStreamEnded); the room closing stops
 *    it too;
 *  - a room that closed during a reconnect hold and came back starts a
 *    second part, and the replay plays the parts in order;
 *  - each part's fate (written, failed) arrives as egress webhooks.
 *
 * Off entirely unless every R2 value is configured.
 */

let egress: EgressClient | null = null;
function egressClient() {
  const host = config.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  egress ??= new EgressClient(host, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  return egress;
}

let s3: S3Client | null = null;
function bucket() {
  s3 ??= new S3Client({
    region: "auto",
    endpoint: r2Endpoint(),
    credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return s3;
}

const r2Endpoint = () => `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

/** Where a part's file is played from. */
export function replayUrlFor(key: string) {
  return `${config.R2_PUBLIC_URL.replace(/\/+$/, "")}/${key}`;
}

/**
 * The recorder in a room — the egress's headless browser — is a hidden
 * participant, but the server's roster lists it: never a viewer, never a
 * watch session. LiveKit marks it EGRESS; its identity is the egress id.
 */
export function isRecorderParticipant(p: { identity: string; kind?: number }) {
  return p.kind === 2 || p.identity.startsWith("EG_");
}

const LIVE_PART: ReadonlyArray<IStreamRecordingPart["status"]> = ["starting", "active"];

/**
 * The replay as anyone may see it (null: not recorded, or deleted). See
 * `ReplayView` in @xtreme/contracts for what each status means.
 */
export function replayView(
  recording: IStreamRecording | null | undefined,
  isLive: boolean,
): ReplayView | null {
  if (!recording?.requested || recording.deletedAt) return null;
  const parts = recording.parts ?? [];
  const written = parts.filter((p) => p.status === "complete" && p.key);
  const pending = parts.some((p) => LIVE_PART.includes(p.status));
  const durationMs = written.reduce((sum, p) => sum + (p.durationMs || 0), 0);
  const files = written.map((p) => ({ url: replayUrlFor(p.key), durationMs: p.durationMs || 0 }));
  if (isLive) return { status: "recording", durationMs, parts: files };
  if (pending) return { status: "processing", durationMs, parts: files };
  // Asked for, but the feed never arrived to start one: nothing was recorded.
  if (parts.length === 0) return null;
  return { status: written.length > 0 ? "ready" : "failed", durationMs, parts: files };
}

/** A stream's recording, read on its own (the field stays out of every other read). */
export async function recordingOf(streamId: Types.ObjectId | string): Promise<IStreamRecording | null> {
  const row = await Stream.findById(streamId).select("+recording").lean();
  return (row?.recording as IStreamRecording | null | undefined) ?? null;
}

/** What one egress update says about its part. */
export function partPatch(info: Pick<EgressInfo, "status" | "error" | "fileResults">): Partial<IStreamRecordingPart> {
  const file = info.fileResults?.[0];
  switch (info.status) {
    case 0: // EGRESS_STARTING
      return { status: "starting" };
    case 1: // EGRESS_ACTIVE
    case 2: // EGRESS_ENDING
      return { status: "active" };
    case 3: // EGRESS_COMPLETE
    case 6: {
      // EGRESS_LIMIT_REACHED: stopped at LiveKit's cap, but what it had is written.
      const sizeBytes = file ? Number(file.size) : 0;
      return sizeBytes > 0
        ? {
            status: "complete",
            durationMs: Math.round(Number(file!.duration) / 1e6),
            sizeBytes,
            endedAt: new Date(),
            error: info.status === 6 ? "Stopped at the recording length limit" : "",
          }
        : { status: "failed", endedAt: new Date(), error: info.error || "Nothing was written" };
    }
    default:
      // EGRESS_FAILED, EGRESS_ABORTED (the page never said START_RECORDING, say).
      return { status: "failed", endedAt: new Date(), error: info.error || "The recording failed" };
  }
}

/**
 * Start recording a stream whose feed just arrived, if its host asked for
 * that and no recording is already running. The part is claimed in one
 * atomic update before LiveKit is asked, so two joins in quick succession
 * (a reload, a device handover) can't start two egresses.
 */
export async function startRecordingIfWanted(stream: Pick<IStream, "_id" | "isLive" | "practice" | "livekitRoomName">) {
  if (!config.recordingEnabled || !stream.isLive || stream.practice) return;
  const id = randomBytes(6).toString("hex");
  const key = `xtream/replays/${String(stream._id)}/${Date.now()}-${id}.mp4`;
  const claimed = await Stream.updateOne(
    {
      _id: stream._id,
      isLive: true,
      "recording.requested": true,
      "recording.parts": { $not: { $elemMatch: { status: { $in: LIVE_PART } } } },
    },
    { $push: { "recording.parts": { id, egressId: "", key, status: "starting", startedAt: new Date() } } },
  );
  if (claimed.modifiedCount !== 1) return;

  try {
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: key,
      disableManifest: true,
      output: {
        case: "s3",
        value: new S3Upload({
          accessKey: config.R2_ACCESS_KEY_ID,
          secret: config.R2_SECRET_ACCESS_KEY,
          bucket: config.R2_BUCKET_NAME,
          region: "auto",
          endpoint: r2Endpoint(),
          forcePathStyle: true,
        }),
      },
    });
    const info = await egressClient().startRoomCompositeEgress(stream.livekitRoomName, output, {
      customBaseUrl: `${config.RECORDING_TEMPLATE_URL.replace(/\/+$/, "")}/${String(stream._id)}`,
      encodingOptions: EncodingOptionsPreset.H264_720P_30,
    });
    await Stream.updateOne(
      { _id: stream._id, "recording.parts.id": id },
      { $set: { "recording.parts.$.egressId": info.egressId, "recording.parts.$.status": "active" } },
    );
  } catch (error) {
    console.error("recording start failed:", error);
    await Stream.updateOne(
      { _id: stream._id, "recording.parts.id": id },
      {
        $set: {
          "recording.parts.$.status": "failed",
          "recording.parts.$.endedAt": new Date(),
          "recording.parts.$.error": error instanceof Error ? error.message.slice(0, 300) : "Couldn't start",
        },
      },
    ).catch(() => {});
  }
}

/** The stream ended: stop whatever is still recording. Its files land via the webhook. */
export async function stopRecording(streamId: Types.ObjectId | string) {
  if (!config.recordingEnabled) return;
  const recording = await recordingOf(streamId);
  const running = (recording?.parts ?? []).filter((p) => LIVE_PART.includes(p.status) && p.egressId);
  await Promise.all(
    running.map((p) =>
      egressClient()
        .stopEgress(p.egressId)
        // Already ending — the room closed first, say. Its webhook settles the part.
        .catch(() => {}),
    ),
  );
}

/** An egress webhook (egress_started / _updated / _ended): bring its part up to date. */
export async function onEgressEvent(info: EgressInfo) {
  if (!info.egressId) return;
  const patch = partPatch(info);
  const $set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`recording.parts.$.${k}`, v]));
  await Stream.updateOne(
    {
      "recording.parts": {
        $elemMatch: {
          egressId: info.egressId,
          // A late "active" must never undo a part already settled.
          ...(patch.status === "complete" || patch.status === "failed" ? {} : { status: { $in: LIVE_PART } }),
        },
      },
    },
    { $set },
  );
}

/**
 * The host deletes a replay: its files leave the bucket, and the stream
 * keeps only that there was one. Not while live — End first.
 */
export async function deleteReplay(streamId: Types.ObjectId | string) {
  const recording = await recordingOf(streamId);
  const keys = (recording?.parts ?? []).map((p) => p.key).filter(Boolean);
  if (keys.length > 0 && config.recordingEnabled) {
    const result = await bucket().send(
      new DeleteObjectsCommand({
        Bucket: config.R2_BUCKET_NAME,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (result.Errors?.length) {
      throw new Error(`Couldn't delete ${result.Errors.length} file(s) from storage`);
    }
  }
  await Stream.updateOne({ _id: streamId }, { $set: { "recording.deletedAt": new Date() } });
}
