import { BlockType } from '../types/emailBuilder';

export type EmailRenderFidelity = 'shared-presentation' | 'native-parity' | 'isolated-html' | 'needs-unification';

export interface EmailRenderContract {
  canvas: 'interactive-react' | 'sandboxed-html';
  preview: 'canonical-email-html';
  copy: 'canonical-email-html';
  fidelity: EmailRenderFidelity;
  note: string;
}

const shared = (note: string): EmailRenderContract => ({
  canvas: 'interactive-react',
  preview: 'canonical-email-html',
  copy: 'canonical-email-html',
  fidelity: 'shared-presentation',
  note,
});

const native = (note: string): EmailRenderContract => ({
  canvas: 'interactive-react',
  preview: 'canonical-email-html',
  copy: 'canonical-email-html',
  fidelity: 'native-parity',
  note,
});

const pending = (note: string): EmailRenderContract => ({
  canvas: 'interactive-react',
  preview: 'canonical-email-html',
  copy: 'canonical-email-html',
  fidelity: 'needs-unification',
  note,
});

/**
 * Exhaustive renderer contract. TypeScript fails the build whenever a new
 * BlockType is added without an explicit Canvas / Preview / Copy counterpart.
 */
export const EMAIL_RENDER_CONTRACTS: Record<BlockType, EmailRenderContract> = {
  logo: native('Ảnh logo dùng cùng URL, kích thước và căn lề.'),
  heading: shared('Typography lấy từ presentation contract dùng chung.'),
  paragraph: shared('Typography và rich text lấy từ presentation contract dùng chung.'),
  image: native('Ảnh dùng cùng URL, kích thước, bo góc và căn lề.'),
  'icon-text': native('Icon được raster hóa khi gửi; bố cục và typography giữ nguyên.'),
  button: native('Canvas và email dùng cùng nội dung, màu, padding và kích thước.'),
  'button-group': native('Nhóm nút có cùng dữ liệu trình bày; mobile được xếp dọc trong email.'),
  'button-group-3': native('Nhóm nút có cùng dữ liệu trình bày; mobile được xếp dọc trong email.'),
  'bullet-list': native('Danh sách giữ cùng nội dung, màu, cỡ chữ và line-height.'),
  'number-list': native('Danh sách giữ cùng nội dung, màu, cỡ chữ và line-height.'),
  'highlight-box': native('Hộp thông tin giữ cùng nền, viền, padding và typography.'),
  divider: native('Đường phân cách giữ cùng độ dày, kiểu nét và màu.'),
  spacer: native('Khoảng trắng giữ cùng chiều cao.'),
  signature: native('Chữ ký giữ cùng rich text và typography.'),
  'signature-builder': native('Trình tạo chữ ký dùng cùng logo, thông tin, liên kết và kích thước trong canvas và email.'),
  'social-links': native('Liên kết giữ cùng nhãn, URL và căn lề.'),
  section: shared('Nền, màu tương phản, padding, viền và typography dùng chung.'),
  columns: shared('Kích thước ô, gap, nền, viền và màu tương phản dùng chung.'),
  'data-table': shared('Padding ô, màu, cỡ chữ, nền header và đường viền dùng chung.'),
  'custom-html': {
    canvas: 'sandboxed-html',
    preview: 'canonical-email-html',
    copy: 'canonical-email-html',
    fidelity: 'isolated-html',
    note: 'Cùng HTML đã sanitize; canvas cô lập bằng iframe để bảo vệ trình biên tập.',
  },
  'image-text': pending('Canvas đang có bố cục riêng nhưng email vẫn dùng fallback tổng quát.'),
  testimonial: pending('Cần renderer email chuyên biệt cho trích dẫn và người chia sẻ.'),
  callout: pending('Cần đồng bộ đầy đủ các biến thể info/success/warning/error.'),
  gallery: pending('Cần renderer table email chuyên biệt cho lưới 2/3 ảnh.'),
  video: pending('Cần đồng bộ thumbnail, nút play và liên kết.'),
  'feature-list': pending('Cần renderer email chuyên biệt cho danh sách tính năng.'),
  'product-card': pending('Cần renderer email chuyên biệt cho ảnh, giá và CTA.'),
  'product-grid': pending('Cần renderer table email chuyên biệt cho lưới sản phẩm.'),
  'pricing-table': pending('Cần renderer email chuyên biệt cho gói và danh sách tính năng.'),
  header: pending('Cần renderer email chuyên biệt cho logo và điều hướng.'),
  footer: pending('Cần renderer email chuyên biệt cho liên hệ và hủy đăng ký.'),
  'merge-tag': pending('Cần renderer email chuyên biệt thay vì hộp fallback.'),
};

export const HTML_IMPORT_PARITY_BLOCKS: BlockType[] = ['heading', 'paragraph', 'section', 'columns', 'data-table'];
