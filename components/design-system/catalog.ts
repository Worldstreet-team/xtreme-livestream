/** The reference's chapters, in the order a screen gets built. */
export const chapters = [
  { id: "colour", label: "Colour", group: "Foundations" },
  { id: "themes", label: "Light & dark", group: "Foundations" },
  { id: "type", label: "Type", group: "Foundations" },
  { id: "shape", label: "Shape", group: "Foundations" },
  { id: "light", label: "Light", group: "Foundations" },
  { id: "motion", label: "Motion", group: "Foundations" },
  { id: "actions", label: "Actions", group: "Components" },
  { id: "status", label: "Status", group: "Components" },
  { id: "people", label: "People", group: "Components" },
  { id: "discovery", label: "Discovery", group: "Components" },
  { id: "giving", label: "Giving", group: "Components" },
  { id: "competing", label: "Competing", group: "Components" },
  { id: "talking", label: "Talking", group: "Components" },
  { id: "forms", label: "Forms", group: "Components" },
  { id: "surfaces", label: "Surfaces", group: "Components" },
  { id: "rules", label: "Rules", group: "Appendix" },
] as const;

export const sources = [
  { title: "Carbon · Spacing", href: "https://carbondesignsystem.com/elements/spacing/overview/", decision: "A repeatable spacing scale with meaning assigned to relationships, not arbitrary margins." },
  { title: "Atlassian · Tokens", href: "https://atlassian.design/tokens", decision: "Primitive values feed semantic roles; component styles consume roles." },
  { title: "GOV.UK · Components & patterns", href: "https://design-system.service.gov.uk/patterns/", decision: "Document task patterns and usage guidance alongside component examples." },
  { title: "GOV.UK · Error summary", href: "https://design-system.service.gov.uk/components/error-summary/", decision: "A failed multi-field submission needs a summary linked to the affected fields." },
  { title: "WAI-ARIA · Interaction patterns", href: "https://www.w3.org/WAI/ARIA/apg/patterns/", decision: "Keyboard and semantic contracts differ for tabs, menus, dialogs and switches." },
  { title: "WCAG 2.2 · Target size", href: "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html", decision: "The AA criterion is 24px with exceptions. Xtream adopts a more generous 44px default for touch." },
  { title: "Carbon · Loading", href: "https://carbondesignsystem.com/patterns/loading-pattern/", decision: "Skeletons describe incoming content; inline loaders describe pending actions." },
  { title: "Apple · Loading", href: "https://developer.apple.com/design/human-interface-guidelines/loading", decision: "Show useful content early and keep unrelated work available." },
  { title: "Phosphor · Icon family", href: "https://github.com/phosphor-icons/react", decision: "One icon family, consistent sizes, regular at rest and filled for selection." },
  { title: "Radix · Dialog & tabs", href: "https://www.radix-ui.com/primitives/docs/components/dialog", decision: "Use existing accessible primitives for overlays and keyboard-driven components." },
  { title: "web.dev · Animation performance", href: "https://web.dev/articles/animations-guide", decision: "Prefer transform and opacity for motion; profile on actual target devices." },
  { title: "TikTok · Accessibility", href: "https://newsroom.tiktok.com/creating-an-accessible-and-inclusive-tiktok?lang=en-150", decision: "Media polish includes captions, readable text, contrast and control over animation." },
];
