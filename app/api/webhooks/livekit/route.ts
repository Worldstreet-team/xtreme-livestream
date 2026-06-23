import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream } from "@/lib/models";
import { webhookReceiver } from "@/lib/livekit";
import { markStreamEnded } from "@/lib/stream-service";

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
 *   - participant_left: if the leaver is the broadcaster, end the stream now.
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
        if (stream && stream.streamerId.toString() === identity) {
          await markStreamEnded(stream);
        }
      }
    }
  } catch {
    // Don't make LiveKit retry on our internal errors indefinitely; the
    // reconciliation safety net will still catch a missed cleanup.
  }

  return NextResponse.json({ success: true });
}
