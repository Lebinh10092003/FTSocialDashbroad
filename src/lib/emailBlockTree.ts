import { EmailBlock } from '../types/emailBuilder';

export const findEmailBlock = (blocks: EmailBlock[], id: string): EmailBlock | undefined => {
  for (const block of blocks) {
    if (block.id === id) return block;
    const found = findEmailBlock(block.children || [], id);
    if (found) return found;
  }
};

const findList = (blocks: EmailBlock[], id: string): EmailBlock[] | undefined => {
  if (blocks.some(block => block.id === id)) return blocks;
  for (const block of blocks) {
    const found = findList(block.children || [], id);
    if (found) return found;
  }
};

export const updateEmailBlock = (blocks: EmailBlock[], id: string, update: (block: EmailBlock) => EmailBlock): EmailBlock[] =>
  blocks.map(block => block.id === id
    ? update(block)
    : { ...block, children: block.children ? updateEmailBlock(block.children, id, update) : undefined });

export const removeEmailBlock = (blocks: EmailBlock[], id: string): EmailBlock[] =>
  blocks.filter(block => block.id !== id).map(block => ({ ...block, children: block.children ? removeEmailBlock(block.children, id) : undefined }));

export const moveEmailBlock = (blocks: EmailBlock[], sourceId: string, targetId: string): EmailBlock[] => {
  if (sourceId === targetId) return blocks;
  const next = structuredClone(blocks) as EmailBlock[];
  const source = findEmailBlock(next, sourceId);
  const sourceList = findList(next, sourceId);
  if (!source || !sourceList) return blocks;
  sourceList.splice(sourceList.findIndex(block => block.id === sourceId), 1);
  const target = findEmailBlock(next, targetId);
  const targetList = findList(next, targetId);
  if (!target || !targetList) return blocks;
  if (target.type === 'section') target.children = [...(target.children || []), source];
  else targetList.splice(targetList.findIndex(block => block.id === targetId) + 1, 0, source);
  return next;
};

export const addEmailBlock = (blocks: EmailBlock[], block: EmailBlock, parentId?: string): EmailBlock[] => {
  if (!parentId) return [...blocks, block];
  return updateEmailBlock(blocks, parentId, parent => parent.type === 'section'
    ? { ...parent, children: [...(parent.children || []), block] }
    : parent);
};