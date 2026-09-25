import { ChatCircleDots } from "@/components/icons";
import { Empty } from "@/components/app/empty";

/**
 * Messages — the rail has the door (owner, 2026-09-23); direct messages
 * aren't built yet. Until they are, the page says so plainly and points at
 * where conversations happen today: live chat on a stream.
 */
export default function MessagesPage() {
  return (
    <div className="min-h-[70vh] p-4 md:p-6">
      <Empty
        icon={<ChatCircleDots size={40} weight="duotone" className="text-ember-hi" />}
        title="Messages are coming soon"
        body="Soon you'll be able to message creators and friends directly. For now, the conversation happens in live chat."
        goLive={false}
        action={{ label: "Find a live stream", href: "/browse?tab=live" }}
      />
    </div>
  );
}
