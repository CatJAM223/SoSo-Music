interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export function positionPopover(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 12;
  const gap = 10;
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const above = Math.max(0, anchor.top - gap - margin);
  const opensAbove = size.height > below && above > below;
  const maxHeight = Math.min(viewport.height - 2 * margin, opensAbove ? above : below);
  const height = Math.min(size.height, Math.max(0, maxHeight));
  const width = Math.min(size.width, viewport.width - 2 * margin);
  return {
    left: Math.max(
      margin,
      Math.min(anchor.left + anchor.width / 2 - width / 2, viewport.width - width - margin),
    ),
    top: opensAbove
      ? Math.max(margin, anchor.top - gap - height)
      : Math.min(anchor.bottom + gap, viewport.height - height - margin),
    maxHeight: Math.max(0, maxHeight),
  };
}
