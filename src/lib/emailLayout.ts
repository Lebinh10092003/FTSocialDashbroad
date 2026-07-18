import { EmailBlock, EmailLayoutCell, EmailLayoutColumn } from '../types/emailBuilder';

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

export const createLayoutCell = (id = `cell-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`): EmailLayoutCell => ({
  id,
  background: '#ffffff',
  heightMode: 'auto',
  height: 96,
  maxHeight: 0,
  color: '',
  padding: 12,
  minHeight: 0,
  borderColor: '#e2e8f0',
  borderWidth: 0,
  borderRadius: 0,
  verticalAlign: 'top'
});

export const createLayoutColumn = (index = 0): EmailLayoutColumn => ({
  id: `column-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
  width: 1,
  minWidth: 0,
  maxWidth: 0,
  cells: [createLayoutCell()]
});

const variantForCount = (count: number) => count === 4 ? 'four' : count === 3 ? 'three' : count === 1 ? 'one' : 'two';

export function normalizeEmailLayout(block: EmailBlock): { layout: EmailLayoutColumn[]; slots: EmailBlock[][] } {
  const rawLayout = Array.isArray(block.content.layoutColumns) ? block.content.layoutColumns : [];
  const legacyCount = block.content.variant === 'four' ? 4 : block.content.variant === 'three' ? 3 : Math.max(2, block.columns?.length || 2);
  const source = rawLayout.length ? rawLayout : Array.from({ length: legacyCount }, (_, index) => createLayoutColumn(index));
  const layout = source.slice(0, 4).map((column: any, columnIndex: number) => ({
    id: String(column?.id || `column-${columnIndex}`),
    width: clamp(column?.width, 0.25, 12, 1),
    minWidth: clamp(column?.minWidth, 0, 1200, 0),
    maxWidth: clamp(column?.maxWidth, 0, 1200, 0),
    cells: (Array.isArray(column?.cells) && column.cells.length ? column.cells : [createLayoutCell()]).slice(0, 4).map((cell: any, cellIndex: number) => ({
      id: String(cell?.id || `cell-${columnIndex}-${cellIndex}`),
      background: String(cell?.background || '#ffffff'),
      color: String(cell?.color || ''),
      padding: clamp(cell?.padding, 0, 64, 12),
      minHeight: cell?.heightMode ? clamp(cell?.minHeight, 0, 600, 0) : Number(cell?.minHeight) === 96 ? 0 : clamp(cell?.minHeight, 0, 600, 0),
      borderColor: String(cell?.borderColor || '#e2e8f0'),
      heightMode: cell?.heightMode === 'fixed' ? 'fixed' : 'auto',
      height: clamp(cell?.height, 24, 1200, clamp(cell?.minHeight, 24, 1200, 96)),
      maxHeight: clamp(cell?.maxHeight, 0, 1600, 0),
      borderWidth: clamp(cell?.borderWidth, 0, 12, 0),
      borderRadius: clamp(cell?.borderRadius, 0, 80, 0),
      verticalAlign: ['top', 'middle', 'bottom'].includes(cell?.verticalAlign) ? cell.verticalAlign : 'top'
    }))
  }));
  const slotCount = layout.reduce((total, column) => total + column.cells.length, 0);
  const slots = Array.from({ length: slotCount }, (_, index) => block.columns?.[index] || []);
  return { layout, slots };
}

export function getLayoutSlotIndex(layout: EmailLayoutColumn[], columnIndex: number, cellIndex: number) {
  return layout.slice(0, columnIndex).reduce((total, column) => total + column.cells.length, 0) + cellIndex;
}

export function getEmailLayoutColumnWidths(layout: EmailLayoutColumn[], availableWidth: number, gap: number): number[] {
  const usableWidth = Math.max(1, availableWidth - Math.max(0, layout.length - 1) * Math.max(0, gap));
  const widths = Array(layout.length).fill(0) as number[];
  let unresolved = layout.map((_, index) => index);
  let remainingWidth = usableWidth;

  for (let pass = 0; pass < layout.length + 1 && unresolved.length; pass += 1) {
    const totalWeight = unresolved.reduce((total, index) => total + Math.max(0.01, Number(layout[index].width) || 1), 0);
    let constrained = false;
    for (const index of [...unresolved]) {
      const column = layout[index];
      const proposed = remainingWidth * Math.max(0.01, Number(column.width) || 1) / totalWeight;
      const minimum = Math.max(0, Number(column.minWidth) || 0);
      const maximum = Math.max(0, Number(column.maxWidth) || 0);
      const constrainedWidth = minimum && proposed < minimum ? minimum : maximum && proposed > maximum ? maximum : 0;
      if (!constrainedWidth) continue;
      widths[index] = constrainedWidth;
      remainingWidth -= constrainedWidth;
      unresolved = unresolved.filter(item => item !== index);
      constrained = true;
    }
    if (constrained) continue;
    unresolved.forEach(index => {
      widths[index] = Math.max(0, remainingWidth) * Math.max(0.01, Number(layout[index].width) || 1) / totalWeight;
    });
    unresolved = [];
  }

  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total > usableWidth && total > 0) return widths.map(width => width * usableWidth / total);
  return widths;
}
export function applyEmailLayout(block: EmailBlock, layout: EmailLayoutColumn[], slots: EmailBlock[][]): EmailBlock {
  const safeLayout = layout.slice(0, 4).map(column => ({ ...column, cells: column.cells.slice(0, 4) }));

  const slotCount = safeLayout.reduce((total, column) => total + column.cells.length, 0);
  return {
    ...block,
    content: {
      ...block.content,
      variant: variantForCount(safeLayout.length),
      horizontalGap: clamp(block.content.horizontalGap, 0, 48, 12),
      verticalGap: clamp(block.content.verticalGap, 0, 48, 12),
      layoutColumns: safeLayout
    },
    columns: Array.from({ length: slotCount }, (_, index) => slots[index] || [])
  };
}

export function resizeEmailLayout(block: EmailBlock, requestedCount: number): EmailBlock {
  const count = Math.max(1, Math.min(4, requestedCount));
  const { layout, slots } = normalizeEmailLayout(block);
  if (count === layout.length) return applyEmailLayout(block, layout, slots);
  if (count > layout.length) {
    const nextLayout = [...layout];
    const nextSlots = [...slots];
    while (nextLayout.length < count) { nextLayout.push(createLayoutColumn(nextLayout.length)); nextSlots.push([]); }
    return applyEmailLayout(block, nextLayout, nextSlots);
  }
  const retainedLayout = layout.slice(0, count);
  const retainedSlots = slots.slice(0, retainedLayout.reduce((total, column) => total + column.cells.length, 0));
  return applyEmailLayout(block, retainedLayout, retainedSlots);
}

export function addEmailLayoutCell(block: EmailBlock, columnIndex: number): EmailBlock {
  const { layout, slots } = normalizeEmailLayout(block);
  const column = layout[columnIndex];
  if (!column || column.cells.length >= 4) return applyEmailLayout(block, layout, slots);
  const insertAt = getLayoutSlotIndex(layout, columnIndex, column.cells.length);
  const nextLayout = layout.map((item, index) => index === columnIndex ? { ...item, cells: [...item.cells, createLayoutCell()] } : item);
  const nextSlots = [...slots]; nextSlots.splice(insertAt, 0, []);
  return applyEmailLayout(block, nextLayout, nextSlots);
}

export function removeEmailLayoutCell(block: EmailBlock, columnIndex: number, cellIndex: number): EmailBlock {
  const { layout, slots } = normalizeEmailLayout(block);
  const column = layout[columnIndex];
  if (!column || column.cells.length <= 1) return applyEmailLayout(block, layout, slots);
  const removeAt = getLayoutSlotIndex(layout, columnIndex, cellIndex);
  const nextLayout = layout.map((item, index) => index === columnIndex ? { ...item, cells: item.cells.filter((_, index) => index !== cellIndex) } : item);
  const nextSlots = [...slots]; nextSlots.splice(removeAt, 1);
  return applyEmailLayout(block, nextLayout, nextSlots);
}

export function updateEmailLayoutColumn(block: EmailBlock, columnIndex: number, patch: Partial<EmailLayoutColumn>): EmailBlock {
  const { layout, slots } = normalizeEmailLayout(block);
  const nextLayout = layout.map((column, index) => index === columnIndex ? { ...column, ...patch, cells: column.cells } : column);
  return applyEmailLayout(block, nextLayout, slots);
}

export function updateEmailLayoutCell(block: EmailBlock, columnIndex: number, cellIndex: number, patch: Partial<EmailLayoutCell>): EmailBlock {
  const { layout, slots } = normalizeEmailLayout(block);
  const nextLayout = layout.map((column, index) => index === columnIndex ? {
    ...column,
    cells: column.cells.map((cell, index) => index === cellIndex ? { ...cell, ...patch } : cell)
  } : column);
  return applyEmailLayout(block, nextLayout, slots);
}