export type BlockType =
  | 'logo'
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'button'
  | 'button-group'
  | 'bullet-list'
  | 'number-list'
  | 'highlight-box'
  | 'divider'
  | 'spacer'
  | 'signature'
  | 'social-links';

export interface EmailBlock {
  id: string;
  type: BlockType;
  content: Record<string, any>;
  styles: Record<string, any>;
  visible: boolean;
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
