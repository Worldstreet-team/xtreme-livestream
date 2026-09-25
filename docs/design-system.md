# Xtream design system · Afterglow 2.0

The live reference is **`/design-system`**: every part on it is the real component, shown with the line that wires it. This file is the long version of its rules.

Afterglow is direction B from the lookbook, locked in by the owner on 2026-09-23: *warm light after dark*. The chili is a light source. Things glow when they're on, burst when something lands, and spring when you touch them. The best of the other two directions is folded in: **On Air**'s broadcast flow (tally, lower third, scoreboard clock, wipes) and **Gold Floor**'s money flow (thin wide numerals, receipts, the lead delta, the pelt board, sheens).

## Where things live

| Layer | Source |
| --- | --- |
| Pigments, roles, shape, light, motion tokens | `app/design-system.css` |
| shadcn/Tailwind roles mapped onto them, the red ramp, surface classes (`.obj`, `.sheet-obj`, `.tabbar-glass`) | `app/globals.css` |
| One import for building a screen | `@/components/xtream` (`components/xtream/index.ts`) |
| Afterglow's signature pieces | `components/xtream/*` |
| Primitives | `components/ui/*` |
| Product composites | `components/app/*` |
| The reference page | `app/design-system/page.tsx`, `components/design-system/*` |

Feature code imports from `@/components/xtream` and uses **roles, never hex**. A component that doesn't exist yet gets added to the reference first.

## Colour: two colours and a ring

| Role | Token / utility | Use it for | Never |
| --- | --- | --- | --- |
| **Chili** | `bg-chili` (#E3122A, white text 4.8:1), `text-chili-hi` (#FF5A66, 6.6:1 on ground), `chili-lo` pressed | Live and action: LIVE, Go live once on air, recording, counts that need you now | Selection, decoration |
| **Ember** | `bg-ember` (#F85810) with `text-on-ember` ink (5.9:1), `text-ember-hi` (#FF8A4C, 8.6:1), `ring-ember` | Energy and choice: the focus ring, selected/switched on, progress, links, streaks, the ×2 window | White text on an Ember fill |
| **White** | `bg-white text-[#0b0708]`, `shadow-glow-white` | The one neutral primary on a surface; whatever is *on* in chips and tabs | Two white primaries in one decision |
| **Heat** | `bg-heat`, `text-heat`, `shadow-glow-heat` | **Two homes only**: rings (live/story avatars, the ally burst) and gift moments (the burst, a picked/sent gift, the combo). Go live is solid Chili (owner, 2026-09-24) | Backgrounds, cards, headings, dividers, ordinary buttons, Go live |
| **Value (gold)** | `text-value` (#F5C76E), `<Money>` | Money: amounts, prices, the wallet | Anything that isn't a currency amount |
| **Foil** | `bg-foil`, `text-foil` | The Wolf's pelt and rank #1, and nothing else. At most once per screen | Anywhere else |

Chili and Ember are the two brand colours, used as **solid** fills everywhere; the Heat gradient is only for its three homes. Don't put them on one control — with one exception: a battle's two sides are Chili (host) and Ember (challenger), split by the white seam. No other gradients: no violet, sky or amber washes, and no coloured radial glows behind cards.

**Neutrals are warm**: `bg-ground` #0B0708 (the page), `bg-surface`/`bg-card` #141011, `bg-surface-raised`/`bg-popover` #1C1617, `bg-control` #261E1F (quiet buttons, chips, icon buttons), `hover:bg-control-hover` #30272A, and `border-hairline`. Supporting text is `text-muted-foreground` #A89F9A (7:1 on a card). The old cool greys (#26262D, `oklch(… 285)`) are gone. Don't reintroduce them.

Semantic: success #95D477, warning #FFC16E, info #A3BAFF, danger #FF939D. Every status has a word, not just a colour. Ended and offline are neutral, because a stream finishing isn't a failure.

## Icons

Solar (480 Design), drawn from Iconify data through `@/components/icons` — never import an icon package directly. The names are the ones the app has always used (`HouseLine`, `MagnifyingGlass`, `SealCheck`…), and `weight` picks the Solar style: `regular` → Linear (the default, 1.5px), `bold` → Outline (small glyphs, carets, checks), `fill` → Bold (active nav, LIVE, verified), `duotone` → Bold Duotone (launchers and product tiles). Solar is CC BY 4.0: the credit "Icons: Solar by 480 Design" has to appear in the app's about or legal page before launch.

## Type

| Role | Utility | Face |
| --- | --- | --- |
| Display | `ds-display text-display` | Archivo 118% · 700 · −0.04em |
| Title | `ds-display text-title` | Archivo 118% · 700 |
| Heading | `text-heading font-semibold` | DM Sans 600 |
| Body / label / caption | `text-body` / `text-label` / `text-caption` | DM Sans |
| Wide accent | `font-wide` | Archivo 118% |
| **Money** | `<Money>` or `font-money` | Archivo 125% · 300 · tabular: Gold Floor's watch-dial numerals |
| Time, codes | `font-mono tabular-nums` | Geist Mono |
| Small caps label | `caps` + size | +0.16em tracking |

Archivo is loaded as the variable font with its width axis (`app/layout.tsx`: `axes: ["wdth"]`). The width axis *is* the voice, so keep it. Keep reading measures at 65ch or less. Values that update use tabular numerals.

## Shape

Corners are tight and quiet (the owner asked for smaller radii on 2026-09-23):

| Surface | Radius | Utility |
| --- | --- | --- |
| Fields | 10px | `rounded-control` |
| Cards, thumbnails (the app's card radius) | 10px | `rounded-sm` (driven by `--radius: 0.625rem`) |
| Panels | 12px | `rounded-panel` |
| Media heroes | 12px | `rounded-xl` |
| Sheets, dialogs | 20px | `rounded-overlay` |
| Buttons, chips, badges, avatars | pill / circle | `rounded-full` |

Nothing has a square corner.

## Light

- **On a picture**, anything you touch wears the object language: `.obj` (black 55%, hairline, lit top edge, lift). The one control that's on is `.obj-on` (white with a glow). Never blur on a picture; it has to read on any frame.
- **Off the picture**, quiet controls are `bg-control` with a lit top edge (`shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]`).
- **Glows** light the colour a thing already is: `shadow-glow-chili`, `-ember`, `-white`, `-heat`.
- **Glass is for navigation only**: the tab bar (`.tabbar-glass`) and sticky headers.
- **Sheets** use `.sheet-obj`: a lit top edge and a deep shadow.

## Motion

Springs for people, sheens for money, wipes for broadcast. Nothing moves unless something happened.

| Motion | Curve / keyframes | For |
| --- | --- | --- |
| Spring | `var(--ease-spring)` · `xt-spring-in`, `xt-pop` | Presses (scale .94), chips, tabs, sheets, alerts landing |
| Burst | `xt-ring-burst`, `xt-sparks` | The moment: allied, a gift landed |
| Sheen | `xt-sheen` · `var(--ease-out)` | Value: receipts, money, the pelt |
| Wipe | `xt-wipe` | Broadcast graphics (straps) |
| Breathe | `xt-breathe` | On air, sparingly |

Wrap decorative motion in `motion-safe:`. With reduced motion, everything lands instantly and the state still reads.

## Components (`@/components/xtream`)

| Need | Reach for |
| --- | --- |
| A button | `Pill` / `PillLink` (product), `Button` (Radix `asChild`, `loading`). Variants: `primary` white · `live` Chili (also Go live) · `heat` (gifts only) · `ember` · `glass` · `soft` + tone · `ghost`. Sizes sm 32 / md 36 / lg 44 / xl 52 |
| Go live | `GoLiveLink` / `Button variant="live"` — solid Chili, a pulsing dot once `user.isLive` |
| Follow | `FollowButton`: white, then quiet with an Ember check, and a heat ring bursts on the follow |
| A label on a picture | `LiveBadge` (the tally), `Badge` `glass · dark · live · ember · value · muted` |
| A state off the picture | `StatusBadge` (live · ember · value · success · warning · info · neutral), `Notice` |
| A face | `UserAvatar` with `ring="live" \| "story" \| "seen"`; `AvatarRingsRow` |
| Who's on stage | `LowerThird` (from On Air) |
| A stream | `StreamCard` (`standard · large · compact`), `CategoryCard` |
| Filters | `Chip` / `ChipRow`; `PillTabs` for panels |
| Gifts | `GiftToken` (`rest · picked · sending · landed`, combo), `GiftAlert` (`small · big`), `GiftReceipt` (from Gold Floor) |
| Money | `Money` (`cents`, `size`, `compact`); `formatUsd` |
| Battles, rankings | `BattleBar` (Chili vs Ember, white seam, clock chip, lead delta); `PeltBoard` (from Gold Floor) |
| Chat | `ChatBubble` (`message · host · gift · system`, `onPicture`) |
| Forms | `TextField`, `Textarea`, `SelectField` (searchable past 12), `SwitchField`, `CheckboxField`, `RadioCards` |
| Surfaces | `DragSheet` (detents, `collapsible`), `Dialog` / `DialogContent variant="sheet"`, `Tooltip`, `Empty` |

## Fields

No outlined inputs (the owner rejected the grey-bordered box). A field is a soft warm fill (`bg-white/[0.06]`) with a hairline, 14px corners, and an Ember line drawn inside on focus. Invalid swaps the line for the danger tone. The field's edge sits below 3:1 against the card by choice, so **the visible label is mandatory**: a placeholder is an example, never the label. `TextField` owns the label, hint and error, and keeps the user's input on failure.

## Access

- Targets are 44px by default. 36px is only for dense pointer tools, and those need extra hit area on touch.
- Focus is always a visible Ember ring (`:focus-visible` outline in `app/design-system.css`, `focus-visible:ring-ember` on controls).
- Measured pairs: white on Chili 4.8:1, ink on Ember 5.9:1, Chili-hi on ground 6.6:1, Ember-hi on ground 8.6:1, gold on ground 12.6:1, muted text on a card 7.1:1. Check any new pair against 4.5:1 (text) and 3:1 (large text, control boundaries).
- Icon-only buttons need an `aria-label`. Decorative glyphs are `aria-hidden`.
- Dialogs trap focus, close on Escape and return focus. Sheets can also be dragged, but that's never the only way out.

## Spacing and layout

4px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 (`--space-*`). Label to field is 8, related rows 16, groups 24, sections 32 on a phone and 48 on desktop. Page gutters are 16px below 768 and 32px above. Test at 375, 768 and 1440 wide, and at 200% zoom. Horizontal scrolling stays inside explicit rails (chips, shelves, the gift ladder). Sticky phone chrome respects safe areas.

## Wiring a screen

1. Import from `@/components/xtream`. Never copy a component's classes.
2. Use roles, not hex (`bg-control`, `text-chili-hi`, `text-value`). Don't bulk-replace reds: a LIVE badge and a destructive action mean different things.
3. If it lives on a picture, put it on one, and check it over a busy frame.
4. Design every state: empty, loading, error, pressed, and the moment itself.
5. Check 375, 768 and 1440, and reduced motion. Then run `npx tsc --noEmit` and `npx eslint`.

## Adoption so far (2026-09-23)

The tokens are global, so every screen now sits on the warm ground with rounder cards, Chili live badges and Ember focus. These are on Afterglow directly:

- Pill, Button, Badge, LiveBadge, PillTabs, UserAvatar rings, Input, Textarea, SelectField, and the switch, checkbox and radio controls.
- StatusBadge, ProgressBar, the Empty state and Go live (top bar, empty states, studio sheet and confirm), FollowButton.
- AvatarRingsRow (heat rings), BattleBar, GiftOverlay (via `GiftAlert`), and the gift keyboard (via `GiftToken`, with a heat send and a gold balance).

Next, adopt route by route: Explore's chip row → `Chip`, the wallet balance → `Money`, and stage tiles → `LowerThird`. Replace any remaining hand-rolled chat rows with `ChatBubble`, and put Wolf race boards on `PeltBoard`.
