"use client";

import { use } from "react";
import { ProducerConsole } from "@/components/app/producer-console";

/** Producer mode: a channel's console, for the host's second device and their producers (see ProducerConsole). */
export default function ProducePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  return <ProducerConsole username={decodeURIComponent(username)} />;
}
