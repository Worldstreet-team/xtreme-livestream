/**
 * Wolf of WorldStreet — the same faceted mascot the socials app draws
 * (worldstreetsocialmedia-client/src/assets/icons/WolfIcon.tsx), copied
 * verbatim so the competition reads as one brand across both apps.
 *
 * Gold is used here even though gold is normally reserved: this is a brand
 * moment by definition, and it stays at badge size.
 */
export function WolfIcon({
  size = 16,
  tier,
  title = "Wolf of WorldStreet",
}: {
  size?: number;
  tier?: "champion" | "finalist" | "contender";
  title?: string;
}) {
  const light = tier === "contender" ? "#A8A29E" : tier === "finalist" ? "#D6B76B" : "#F5CE4E";
  const mid = tier === "contender" ? "#78716C" : tier === "finalist" ? "#B08D3C" : "#EAB308";
  const dark = tier === "contender" ? "#57534E" : tier === "finalist" ? "#7A5F22" : "#A9770A";

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label={title} className="shrink-0">
      <title>{title}</title>
      <path d="M4.4 2.6 L8.9 6.2 L6.2 9.9 L3.3 6.6 Z" fill={mid} />
      <path d="M19.6 2.6 L15.1 6.2 L17.8 9.9 L20.7 6.6 Z" fill={dark} />
      <path d="M5.3 4.6 L7.9 6.7 L6.5 8.6 Z" fill={light} />
      <path d="M18.7 4.6 L16.1 6.7 L17.5 8.6 Z" fill={mid} />
      <path d="M12 4.9 L18.4 8.4 L19.4 14.1 L12 16.6 Z" fill={dark} />
      <path d="M12 4.9 L5.6 8.4 L4.6 14.1 L12 16.6 Z" fill={mid} />
      <path d="M12 6.4 L16.8 9.1 L12 10.7 Z" fill={mid} />
      <path d="M12 6.4 L7.2 9.1 L12 10.7 Z" fill={light} />
      <path d="M12 16.6 L15.9 14.4 L14.6 19.3 L12 21.4 Z" fill={mid} />
      <path d="M12 16.6 L8.1 14.4 L9.4 19.3 L12 21.4 Z" fill={light} />
      <path d="M12 18.2 L13.6 19.5 L12 21.4 L10.4 19.5 Z" fill={dark} />
      <path d="M8.4 10.6 L10.6 11.5 L8.9 12.6 L7.7 11.6 Z" fill="#1C1917" />
      <path d="M15.6 10.6 L13.4 11.5 L15.1 12.6 L16.3 11.6 Z" fill="#1C1917" />
    </svg>
  );
}
