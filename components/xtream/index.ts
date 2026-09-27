/**
 * Xtream · Afterglow — the one import for building a screen.
 *
 *   import { Pill, LiveBadge, UserAvatar, GiftToken, Money } from "@/components/xtream";
 *
 * Everything the /design-system page documents is exported from here: the
 * primitives (components/ui), the product composites (components/app) and
 * Afterglow's signature pieces (this folder). Each keeps its own file — this
 * is a map, not a copy — so an import from the file itself still works.
 *
 * The rules that decide which to reach for live in docs/design-system.md;
 * the short version is in app/design-system.css.
 */

/* ---- actions ---------------------------------------------------------- */
export { Pill, PillLink, pillClass, PILL_ICON } from "@/components/ui/pill";
export type { PillVariant, PillTone, PillSize } from "@/components/ui/pill";
export { Button, buttonVariants } from "@/components/ui/button";
export { IconButton } from "@/components/ui/icon-button";
export { GoLiveButton, Empty } from "@/components/app/empty";
export type { EmptyAction, EmptyScene } from "@/components/app/empty";
export { EmptySceneArt, EMPTY_SCENES } from "@/components/app/empty-scenes";
export { FollowButton } from "@/components/app/follow-button";

/* ---- status ----------------------------------------------------------- */
export { Badge, LiveBadge } from "@/components/ui/badge";
export type { BadgeVariant, BadgeSize } from "@/components/ui/badge";
export { StatusBadge } from "@/components/ui/status-badge";
export { Notice, Spinner, LoadingStatus, Skeleton, ProgressBar } from "@/components/ui/feedback";

/* ---- people ----------------------------------------------------------- */
export { UserAvatar } from "@/components/ui/user-avatar";
export type { AvatarRing } from "@/components/ui/user-avatar";
export { AvatarRingsRow } from "@/components/app/avatar-rings-row";
export { LowerThird } from "./lower-third";

/* ---- discovery -------------------------------------------------------- */
export { StreamCard } from "@/components/app/stream-card";
export { CategoryCard } from "@/components/app/category-card";
export { Chip, ChipRow } from "./chip";
export { PillTabs } from "@/components/ui/tabs";

/* ---- giving and money -------------------------------------------------- */
export { GiftArt } from "@/components/app/gift-art";
export { GiftToken } from "./gift-token";
export type { GiftTokenState } from "./gift-token";
export { GiftAlert } from "./gift-alert";
export { GiftReceipt } from "./gift-receipt";
export { Money, formatUsd } from "./money";

/* ---- competing -------------------------------------------------------- */
export { BattleBar } from "@/components/app/battle-bar";
export { PeltBoard } from "./pelt-board";
export type { PeltRow } from "./pelt-board";

/* ---- talking ---------------------------------------------------------- */
export { ChatBubble } from "./chat-bubble";
export type { ChatKind } from "./chat-bubble";

/* ---- forms ------------------------------------------------------------ */
export { Input, fieldClass } from "@/components/ui/input";
export { Textarea } from "@/components/ui/textarea";
export { TextField } from "@/components/ui/text-field";
export { SelectField } from "@/components/ui/select-field";
export type { SelectOption, SelectOptionGroup } from "@/components/ui/select-field";
export { SwitchField, CheckboxField, RadioCards } from "@/components/ui/selection-controls";

/* ---- surfaces --------------------------------------------------------- */
export { DragSheet } from "@/components/app/drag-sheet";
export { Dialog, DialogTrigger, DialogClose, DialogContent } from "@/components/ui/dialog";
export { Tooltip } from "@/components/ui/tooltip";
export { Stack, Cluster, Surface, SectionHeader } from "@/components/ui/layout";
export { BrandMark, BrandLockup } from "@/components/ui/brand-mark";
