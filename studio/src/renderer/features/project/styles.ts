/** UI-only IDs; the native Mode B style contracts remain authoritative. */
export const visualStyleChoices = ['B1', 'B2', 'B3', 'B4'] as const;
export type VisualStyleId = (typeof visualStyleChoices)[number];
export const visualStyleNames: Record<VisualStyleId, string> = {
  B1: 'Minimal Hand-Drawn',
  B2: 'Colorful Hand-Drawn',
  B3: 'Retro TV',
  B4: 'Survival Thriller'
};
export const visualStyleLabel = (id: VisualStyleId) => `${id} · ${visualStyleNames[id]}`;
