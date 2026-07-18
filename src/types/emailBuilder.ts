export type BlockType =
  | 'logo'
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'icon-text'
  | 'button'
  | 'button-group'
  | 'button-group-3'
  | 'bullet-list'
  | 'number-list'
  | 'highlight-box'
  | 'divider'
  | 'spacer'
  | 'signature'
  | 'social-links'
  | 'section' | 'columns' | 'image-text' | 'data-table' | 'testimonial' | 'callout'
  | 'gallery' | 'video' | 'feature-list' | 'product-card' | 'product-grid' | 'pricing-table'
  | 'header' | 'footer' | 'merge-tag' | 'custom-html';

export type EmailLayoutVerticalAlign = 'top' | 'middle' | 'bottom';

export interface EmailLayoutCell {
  id: string;
  background: string;
  color: string;
  padding: number;
  minHeight: number;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  verticalAlign: EmailLayoutVerticalAlign;
}

export interface EmailLayoutColumn {
  id: string;
  /** Relative width weight from 1 to 6. */
  width: number;
  /** A column can be divided vertically into up to four independent drop cells. */
  cells: EmailLayoutCell[];
}

export interface EmailBlock {
  id: string;
  type: BlockType;
  content: Record<string, any>;
  styles: Record<string, any>;
  visible: boolean;
  /** Linear child blocks used by Section containers. */
  children?: EmailBlock[];
  /** Flattened child slots used by every cell in a flexible layout. */
  columns?: EmailBlock[][];
}

export interface EmailSettings {
  maxWidth: number;
  externalBg: string;
  contentBg: string;
  fontFamily: string;
  textColor: string;
  contentPadding: number;
  borderRadius: number;
  linkColor: string;
  btnDefaultBg: string;
  btnDefaultTextColor: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  blocks: EmailBlock[];
  settings: EmailSettings;
  lastUpdated: number;
}

export interface EmailVariable {
  key: string;      // e.g. "Tên phụ huynh"
  label: string;    // Display label
  defaultValue: string; // Mock data value for preview e.g. "Anh Minh"
}

export type BlockCategory = 'layout' | 'content' | 'icons' | 'media' | 'cta' | 'commerce' | 'brand' | 'advanced';
export interface BlockProperty { key: string; type: 'text' | 'textarea' | 'url' | 'number' | 'color' | 'select'; label: string; options?: { value: string; label: string }[]; }
export interface EmailBlockDefinition { id: BlockType; category: BlockCategory; label: string; description: string; icon: string; variants: { value: string; label: string }[]; defaultContent: Record<string, any>; defaultStyles?: Record<string, any>; propertiesSchema?: BlockProperty[]; }
