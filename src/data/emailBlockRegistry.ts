import { BlockCategory, BlockType, EmailBlock, EmailBlockDefinition } from '../types/emailBuilder';

const V = (a = 'Style 1', b = 'Style 2') => [{ value: 'style-1', label: a }, { value: 'style-2', label: b }];
const CTA = { text: 'Tìm hiểu thêm', link: 'https://www.fermat.vn', bg: '#0F3A72', color: '#ffffff' };
const block = (id: BlockType, category: BlockCategory, label: string, icon: string, defaultContent: Record<string, any>, description = '', variants = V()): EmailBlockDefinition => ({ id, category, label, icon, description, variants, defaultContent });

/** Single source of truth: add a definition here instead of changing core builder logic. */
export const EMAIL_BLOCK_REGISTRY: Record<BlockType, EmailBlockDefinition> = {
  logo: block('logo','brand','Logo','PenTool',{url:'https://fermat.vn/UploadFile/Images/2025/8/18/Hinh_anh_638911101534359159.png',alt:'Logo',width:120,align:'center',link:'https://www.fermat.vn'},'Logo nhận diện'),
  heading: block('heading','content','Tiêu đề','Heading',{text:'Nhấp để sửa tiêu đề mới',level:'h2',fontSize:20,color:'#0F3A72',bold:true,align:'left'},'Tiêu đề chính hoặc phụ'),
  paragraph: block('paragraph','content','Đoạn văn','Type',{html:'<p>Nội dung đoạn văn mới. Nhấp để chỉnh sửa trực quan.</p>',align:'left'},'Nội dung văn bản'),
  image: block('image','media','Ảnh / Banner','Image',{url:'',alt:'Banner hình ảnh',width:600,height:'',aspectLocked:true,naturalRatio:null,align:'center',borderRadius:8,link:''},'Ảnh HTTPS hoặc banner nổi bật'),
  button: block('button','cta','Nút CTA','MousePointerClick',{...CTA,radius:8,align:'center',width:'auto',fontSize:15,paddingX:24,paddingY:12,minWidth:0},'Nút kêu gọi hành động'),
  'button-group': block('button-group','cta','Hai nút cùng hàng','Columns2',{align:'center',gap:12,buttons:[
    {...CTA,text:'Nút bên trái',radius:8,fontSize:14,paddingX:18,paddingY:11,minWidth:0},
    {...CTA,text:'Nút bên phải',bg:'#f1f5f9',color:'#0F3A72',radius:8,fontSize:14,paddingX:18,paddingY:11,minWidth:0}
  ]},'Hai nút có thể chỉnh kích thước độc lập'),
  'button-group-3': block('button-group-3','cta','Ba nút cùng hàng','Columns3',{align:'center',gap:10,buttons:[
    {...CTA,text:'Nút thứ nhất',radius:8,fontSize:13,paddingX:14,paddingY:10,minWidth:0},
    {...CTA,text:'Nút thứ hai',bg:'#1473d1',radius:8,fontSize:13,paddingX:14,paddingY:10,minWidth:0},
    {...CTA,text:'Nút thứ ba',bg:'#f1f5f9',color:'#0F3A72',radius:8,fontSize:13,paddingX:14,paddingY:10,minWidth:0}
  ]},'Ba lựa chọn trên cùng một hàng'),
  'bullet-list': block('bullet-list','content','Danh sách gạch đầu dòng','List',{items:['Mục danh sách thứ nhất','Mục danh sách thứ hai']},'Danh sách không đánh số'),
  'number-list': block('number-list','content','Danh sách số','ListOrdered',{items:['Bước thứ nhất','Bước thứ hai']},'Danh sách theo thứ tự'),
  'highlight-box': block('highlight-box','content','Hộp thông tin','Info',{html:'<p><strong>Lưu ý đặc biệt:</strong> Đây là thông tin quan trọng.</p>',bg:'#eef6ff',borderColor:'#1473d1',padding:16},'Thông tin cần chú ý'),
  divider: {...block('divider','layout','Đường phân cách','Minus',{},'Đường kẻ chia nội dung'),defaultStyles:{thickness:1,color:'#e2e8f0',borderStyle:'solid'}},
  spacer: {...block('spacer','layout','Khoảng trắng','MoveVertical',{},'Tạo nhịp thở dọc'),defaultStyles:{height:20}},
  signature: block('signature','brand','Chữ ký','PenLine',{html:'<p><strong>BAN TỔ CHỨC</strong><br/>Công ty Cổ phần Công nghệ Giáo dục Fermat</p>'},'Thông tin đơn vị gửi'),
  'social-links': block('social-links','brand','Mạng xã hội','Share2',{align:'center',links:[{label:'Facebook',url:'https://facebook.com',visible:true},{label:'Website',url:'https://www.fermat.vn',visible:true}]},'Các liên kết mạng xã hội'),
  section: block('section','layout','Section / Container','SquareDashed',{variant:'style-1',heading:'Nội dung section',body:'Gom phần nội dung có cùng ngữ cảnh.',bg:'#f8fafc',padding:24},'Nền, viền và khoảng đệm'),
  columns: block('columns','layout','Cột linh hoạt','Columns3',{variant:'two',items:[{title:'Cột 1',body:'Nội dung cột thứ nhất'},{title:'Cột 2',body:'Nội dung cột thứ hai'}]},'Bố cục 2–4 cột',[{value:'two',label:'2 cột'},{value:'three',label:'3 cột'},{value:'four',label:'4 cột'}]),
  'image-text': block('image-text','media','Ảnh + Chữ','PanelLeft',{variant:'image-left',imageUrl:'',heading:'Tiêu đề nổi bật',body:'Mô tả ngắn cho hình ảnh.',...CTA},'Ảnh và nội dung hai cột',[{value:'image-left',label:'Ảnh trái'},{value:'image-right',label:'Ảnh phải'}]),
  'data-table': block('data-table','content','Bảng dữ liệu','Table2',{variant:'style-1',heading:'Thông tin chi tiết',rows:[['Hạng mục','Nội dung'],['Thời gian','08:00 - 10:00'],['Địa điểm','Fermat Workspace']]},'Lịch học, điểm số hoặc thông tin'),
  testimonial: block('testimonial','content','Trích dẫn','Quote',{variant:'style-1',quote:'Một trải nghiệm học tập hữu ích và đầy cảm hứng.',author:'Nguyễn Minh Anh',role:'Phụ huynh'},'Nhận xét kèm người chia sẻ'),
  callout: block('callout','content','Callout / Alert','BadgeAlert',{variant:'info',title:'Thông báo',body:'Nội dung thông báo dành cho người nhận.'},'Thông báo nhiều trạng thái',[{value:'info',label:'Thông tin'},{value:'success',label:'Thành công'},{value:'warning',label:'Cảnh báo'},{value:'error',label:'Quan trọng'}]),
  gallery: block('gallery','media','Thư viện ảnh','GalleryHorizontal',{variant:'two',images:['','']},'Lưới ảnh 2 hoặc 3 cột',[{value:'two',label:'2 cột'},{value:'three',label:'3 cột'}]),
  video: block('video','media','Video','PlayCircle',{variant:'style-1',imageUrl:'',title:'Xem video giới thiệu',link:'https://www.youtube.com/'},'Thumbnail dẫn tới video ngoài'),
  'feature-list': block('feature-list','media','Danh sách tính năng','ListChecks',{variant:'style-1',items:[{title:'Dễ sử dụng',body:'Thông tin ngắn gọn, rõ ràng.'},{title:'Cập nhật nhanh',body:'Luôn có thông tin mới nhất.'}]},'Icon, tiêu đề và mô tả'),
  'product-card': block('product-card','commerce','Thẻ sản phẩm','Package',{variant:'style-1',imageUrl:'',name:'Khóa học nổi bật',price:'1.200.000đ',description:'Mô tả ngắn về sản phẩm.',...CTA},'Ảnh, giá và CTA'),
  'product-grid': block('product-grid','commerce','Lưới sản phẩm','LayoutGrid',{variant:'two',products:[{name:'Gói cơ bản',price:'500.000đ'},{name:'Gói nâng cao',price:'1.000.000đ'}]},'2 hoặc 3 sản phẩm một hàng',[{value:'two',label:'2 sản phẩm'},{value:'three',label:'3 sản phẩm'}]),
  'pricing-table': block('pricing-table','commerce','Bảng giá','ReceiptText',{variant:'style-1',plans:[{name:'Cơ bản',price:'500.000đ',features:'Tài liệu;Hỗ trợ email'},{name:'Nâng cao',price:'1.000.000đ',features:'Toàn bộ tài liệu;Hỗ trợ ưu tiên'}]},'So sánh các gói dịch vụ'),
  header: block('header','brand','Header dựng sẵn','PanelTop',{variant:'style-1',logoUrl:'',navigation:'Trang chủ | Khóa học | Liên hệ'},'Logo và điều hướng'),
  footer: block('footer','brand','Footer chuẩn','PanelBottom',{variant:'style-1',company:'FermatTech',address:'Hà Nội, Việt Nam',unsubscribeUrl:'{{unsubscribe_url}}'},'Liên hệ và hủy đăng ký'),
  'merge-tag': block('merge-tag','advanced','Merge tag','Braces',{variant:'style-1',text:'Xin chào {{ho_ten}},'},'Cá nhân hóa dữ liệu người nhận'),
  'custom-html': block('custom-html','advanced','Custom HTML/CSS','Code2',{variant:'style-1',html:'<table role="presentation" width="100%"><tr><td style="padding:16px;background:#eef6ff;color:#0F3A72">Nội dung HTML tùy chỉnh</td></tr></table>'},'Mã HTML an toàn, cô lập preview')
};
export const BLOCK_CATEGORIES: { id: BlockCategory; label: string }[] = [{id:'content',label:'Nội dung'},{id:'layout',label:'Bố cục'},{id:'media',label:'Hình ảnh & media'},{id:'cta',label:'Nút & CTA'},{id:'commerce',label:'Sản phẩm'},{id:'brand',label:'Thương hiệu'},{id:'advanced',label:'Nâng cao'}];
export const getBlockDefinition = (type: BlockType) => EMAIL_BLOCK_REGISTRY[type];
export function createEmailBlock(type: BlockType, id = `${type}-${Date.now()}`): EmailBlock {
  const definition = getBlockDefinition(type);
  const block: EmailBlock = {
    id,
    type,
    content: structuredClone(definition.defaultContent),
    styles: { marginTop: 12, marginBottom: 12, ...structuredClone(definition.defaultStyles || {}) },
    visible: true
  };
  if (type === 'section') block.children = [];
  if (type === 'columns') block.columns = [[], []];
  return block;
}
