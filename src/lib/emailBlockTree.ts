import { EmailBlock } from '../types/emailBuilder';

export const findEmailBlock = (blocks: EmailBlock[], id: string): EmailBlock | undefined => {
  for (const block of blocks) {
    if (block.id === id) return block;
    const child = findEmailBlock(block.children || [], id);
    if (child) return child;
    for (const column of block.columns || []) {
      const nested = findEmailBlock(column, id);
      if (nested) return nested;
    }
  }
};

const findList = (blocks: EmailBlock[], id: string): EmailBlock[] | undefined => {
  if (blocks.some(block => block.id === id)) return blocks;
  for (const block of blocks) {
    const childList = findList(block.children || [], id);
    if (childList) return childList;
    for (const column of block.columns || []) {
      const columnList = findList(column, id);
      if (columnList) return columnList;
    }
  }
};

export const updateEmailBlock = (blocks: EmailBlock[], id: string, update: (block: EmailBlock) => EmailBlock): EmailBlock[] =>
  blocks.map(block => block.id === id
    ? update(block)
    : {
        ...block,
        children: block.children ? updateEmailBlock(block.children, id, update) : undefined,
        columns: block.columns ? block.columns.map(column => updateEmailBlock(column, id, update)) : undefined
      });

export const removeEmailBlock = (blocks: EmailBlock[], id: string): EmailBlock[] =>
  blocks.filter(block => block.id !== id).map(block => ({
    ...block,
    children: block.children ? removeEmailBlock(block.children, id) : undefined,
    columns: block.columns ? block.columns.map(column => removeEmailBlock(column, id)) : undefined
  }));

export const moveEmailBlock = (blocks: EmailBlock[], sourceId: string, targetId: string, slotIndex?: number, position: 'before' | 'after' = 'after'): EmailBlock[] => {
  if (sourceId === targetId) return blocks;
  const next = structuredClone(blocks) as EmailBlock[];
  const source = findEmailBlock(next, sourceId);
  const sourceList = findList(next, sourceId);
  if (!source || !sourceList) return blocks;
  sourceList.splice(sourceList.findIndex(block => block.id === sourceId), 1);

  const target = findEmailBlock(next, targetId);
  const targetList = findList(next, targetId);
  if (!target || !targetList) return blocks;
  if (target.type === 'columns' && slotIndex !== undefined) {
    const columns = target.columns || [[], []];
    columns[slotIndex] = [...(columns[slotIndex] || []), source];
    target.columns = columns;
  } else if (target.type === 'section') {
    target.children = [...(target.children || []), source];
  } else {
    const targetIndex = targetList.findIndex(block => block.id === targetId);
    targetList.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source);
  }
  return next;
};

export const addEmailBlock = (blocks: EmailBlock[], block: EmailBlock, parentId?: string, slotIndex?: number): EmailBlock[] => {
  if (!parentId) return [...blocks, block];
  return updateEmailBlock(blocks, parentId, parent => {
    if (parent.type === 'columns' && slotIndex !== undefined) {
      const columns = parent.columns || [[], []];
      columns[slotIndex] = [...(columns[slotIndex] || []), block];
      return { ...parent, columns };
    }
    return parent.type === 'section'
      ? { ...parent, children: [...(parent.children || []), block] }
      : parent;
  });
};

export const addEmailBlockRelative = (blocks: EmailBlock[], block: EmailBlock, targetId: string, position: 'before' | 'after'): EmailBlock[] => {
  const next = structuredClone(blocks) as EmailBlock[];
  const targetList = findList(next, targetId);
  if (!targetList) return blocks;
  const targetIndex = targetList.findIndex(item => item.id === targetId);
  if (targetIndex < 0) return blocks;
  targetList.splice(targetIndex + (position === 'after' ? 1 : 0), 0, block);
  return next;
};

export const moveEmailBlockByDirection = (blocks: EmailBlock[], id: string, direction: 'up' | 'down'): EmailBlock[] => {
  const next = structuredClone(blocks) as EmailBlock[];
  const list = findList(next, id);
  if (!list) return blocks;
  const index = list.findIndex(block => block.id === id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= list.length) return blocks;
  [list[index], list[target]] = [list[target], list[index]];
  return next;
};

const cloneWithIds = (block: EmailBlock, suffix: string): EmailBlock => ({
  ...structuredClone(block),
  id: `${block.type}-${suffix}`,
  children: block.children?.map((child, index) => cloneWithIds(child, `${suffix}-${index}`)),
  columns: block.columns?.map((column, columnIndex) => column.map((child, index) => cloneWithIds(child, `${suffix}-${columnIndex}-${index}`)))
});

export const duplicateEmailBlock = (blocks: EmailBlock[], id: string, suffix = String(Date.now())): { blocks: EmailBlock[]; cloneId?: string } => {
  const next = structuredClone(blocks) as EmailBlock[];
  const source = findEmailBlock(next, id);
  const list = findList(next, id);
  if (!source || !list) return { blocks };
  const clone = cloneWithIds(source, suffix);
  list.splice(list.findIndex(block => block.id === id) + 1, 0, clone);
  return { blocks: next, cloneId: clone.id };
};