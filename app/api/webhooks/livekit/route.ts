import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream, IStream } from "@/lib/models";
import { roomService, webhookReceiver } from "@/lib/livekit";
import { accrueViewerSeconds, markStreamEnded } from "@/lib/stream-service";

/**
 * Refresh a live stream's current/peak viewer counts and bank the viewer-time
 * accrued at the previous count. Viewer count is the room's participant count
 * minus the broadcaster.
 *
 * The room roster is queried rather than trusting the event's
 * `numParticipants`, which is a snapshot taken at event time and is ambiguous
 * for `participant_left` (it may or may not still include the leaver).
 */
async function updateViewerCounts(
  stream: IStream,
  numParticipants: number | undefined
): Promise<void> {
  let participants: number | undefined;

  try {
    const list = await roomService.listParticipants(stream.livekitRoomName);
    participants = list.length;
  } catch {
    participants = numParticipants;
  }

  if (participants === undefined) return;

  accrueViewerSeconds(stream);

  const viewers = Math.max(0, participants - 1);
  stream.viewers = viewers;
  if (viewers > stream.peakViewers) stream.peakViewers = viewers;
  await stream.save();
}

/**
 * POST /api/webhooks/livekit — LiveKit server webhook.
 *
 * Authoritative, real-time signal for ending streams when the broadcaster
 * disconnects (tab close, crash, network drop) or the room closes. Without
 * this, a stream's `isLive` flag would stay `true` in MongoDB forever and
 * keep showing up on Explore with chat enabled.
 *
 * Configure the endpoint URL in your LiveKit Cloud project settings
 * (Settings → Webhooks): https://<your-domain>/api/webhooks/livekit
 *
 * Handled events:
 *   - participant_joined: refresh the stream's viewer counts.
 *   - participant_left: if the leaver is the broadcaster, end the stream now;
 *                       otherwise refresh the viewer counts.
 *   - room_finished:    end the stream when the room closes (empty timeout).
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const authHeader = req.headers.get("Authorization") ?? undefined;

  let event;
  try {
    // Verifies the signature against the LiveKit API secret.
    event = await webhookReceiver.receive(body, authHeader);
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid webhook signature" },
      { status: 401 }
    );
  }

  const roomName = event.room?.name;
  if (!roomName) {
    // Nothing room-scoped to act on (e.g. egress/ingress events).
    return NextResponse.json({ success: true });
  }

  await connectDB();

  try {
    if (event.event === "room_finished") {
      const stream = await Stream.findOne({
        livekitRoomName: roomName,
        isLive: true,
      });
      if (stream) await markStreamEnded(stream);
    } else if (event.event === "participant_joined") {
      const identity = event.participant?.identity;
      const stream = await Stream.findOne({
        livekitRoomName: roomName,
        isLive: true,
      });
      if (stream && identity && stream.streamerId.toString() !== identity) {
        await updateViewerCounts(stream, event.room?.numParticipants);
      }
    } else if (
      event.event === "participant_left" ||
      event.event === "participant_connection_aborted"
    ) {
      const identity = event.participant?.identity;
      if (identity) {
        const stream = await Stream.findOne({
          livekitRoomName: roomName,
          isLive: true,
        });
        // End only when the broadcaster leaves — viewers leaving is normal.
        // The broadcaster's participant identity is their user id, which is
        // also embedded in the room name (`stream-<userId>-<ts>`).
        if (stream) {
          if (stream.streamerId.toString() === identity) {
            await markStreamEnded(stream);
          } else {
            await updateViewerCounts(stream, event.room?.numParticipants);
          }
        }
      }
    }
  } catch {
    // Don't make LiveKit retry on our internal errors indefinitely; the
    // reconciliation safety net will still catch a missed cleanup.
  }

  return NextResponse.json({ success: true });
}
