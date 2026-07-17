import { EmailTemplate } from '../types/emailBuilder';

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'aysbc-intro-2026',
    name: 'AYSBC 2026 – Thư giới thiệu phụ huynh',
    subject: '[AYSBC 2026] Biến căn bếp và khu vườn thành phòng thí nghiệm chuẩn Singapore cùng con',
    settings: {
      maxWidth: 650,
      externalBg: '#f8fafc',
      contentBg: '#ffffff',
      fontFamily: 'Arial',
      textColor: '#1e293b',
      contentPadding: 24,
      borderRadius: 16,
      linkColor: '#1473d1',
      btnDefaultBg: '#1473d1',
      btnDefaultTextColor: '#ffffff'
    },
    lastUpdated: Date.now(),
    blocks: [
      {
        id: 'block-1',
        type: 'logo',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 20
        },
        content: {
          url: 'https://fermat.vn/UploadFile/Images/2025/8/18/Hinh_anh_638911101534359159.png',
          alt: 'FermatTech Logo',
          width: 150,
          align: 'center',
          link: 'https://www.fermat.vn'
        }
      },
      {
        id: 'block-2',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 10
        },
        content: {
          html: '<p>Kính gửi {{Danh xưng}} {{Tên phụ huynh}},</p>'
        }
      },
      {
        id: 'block-3',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 15
        },
        content: {
          html: '<p>FermatTech xin gửi tới phụ huynh thông tin cuộc thi và chương trình trải nghiệm khoa học AYSBC 2026 dành cho học sinh.</p>'
        }
      },
      {
        id: 'block-4',
        type: 'heading',
        visible: true,
        styles: {
          marginTop: 20,
          marginBottom: 10
        },
        content: {
          text: 'Đấu trường Khoa học Châu Á AYSBC 2026',
          level: 'h2',
          bold: true,
          color: '#0f3a72',
          fontSize: 20,
          align: 'center'
        }
      },
      {
        id: 'block-5',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 15
        },
        content: {
          html: '<p>Kỳ thi Đấu trường Khoa học Châu Á (Asian Youth Science Badge Competition - AYSBC) được tổ chức bởi Science Centre Singapore. Đây là cơ hội để học sinh thể hiện niềm đam mê khoa học, làm quen với phương pháp thực hành, quan sát thực tế.</p>'
        }
      },
      {
        id: 'block-6',
        type: 'image',
        visible: true,
        styles: {
          marginTop: 15,
          marginBottom: 15
        },
        content: {
          url: 'https://fermat.vn/UploadFile/Images/2025/8/18/Hinh_anh_638911101534359159.png',
          alt: 'AYSBC Banner',
          width: 600,
          align: 'center',
          borderRadius: 8,
          link: 'https://www.fermat.vn'
        }
      },
      {
        id: 'block-7',
        type: 'heading',
        visible: true,
        styles: {
          marginTop: 20,
          marginBottom: 10
        },
        content: {
          text: 'Phương pháp học khoa học qua hệ thống Huy hiệu (Badge system)',
          level: 'h3',
          bold: true,
          color: '#1473d1',
          fontSize: 16,
          align: 'left'
        }
      },
      {
        id: 'block-8',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 15
        },
        content: {
          html: '<p>Học sinh tham gia sẽ thực hiện các thử thách thực hành khoa học ngay tại nhà (trong căn bếp hoặc khu vườn) và quay video báo cáo để tích lũy huy hiệu từ Science Centre Singapore.</p>'
        }
      },
      {
        id: 'block-9',
        type: 'heading',
        visible: true,
        styles: {
          marginTop: 20,
          marginBottom: 10
        },
        content: {
          text: 'Chương trình thử thách theo khối lớp',
          level: 'h3',
          bold: true,
          color: '#1473d1',
          fontSize: 16,
          align: 'left'
        }
      },
      {
        id: 'block-10',
        type: 'bullet-list',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 10
        },
        content: {
          items: [
            'Thử thách "Kitchen Scientist" (Lớp 1–3)',
            'Thử thách "Young Botanist" (Lớp 4–6)'
          ]
        }
      },
      {
        id: 'block-11',
        type: 'bullet-list',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 15
        },
        content: {
          items: [
            'Thử thách "Eco Explorer" (Lớp 7–9)',
            'Thử thách "Physics Investigator" (Lớp 10–12)'
          ]
        }
      },
      {
        id: 'block-12',
        type: 'image',
        visible: true,
        styles: {
          marginTop: 15,
          marginBottom: 15
        },
        content: {
          url: 'https://fermat.vn/UploadFile/Images/2025/8/18/Hinh_anh_638911101534359159.png',
          alt: 'Exam Info Banner',
          width: 600,
          align: 'center',
          borderRadius: 8,
          link: 'https://www.fermat.vn'
        }
      },
      {
        id: 'block-13',
        type: 'highlight-box',
        visible: true,
        styles: {
          marginTop: 15,
          marginBottom: 15
        },
        content: {
          html: '<p><strong>Thông tin kỳ thi cần lưu ý:</strong><br/>• Ngày thi chính thức: {{Ngày thi}}<br/>• Hạn đăng ký: 15/10/2026<br/>• Lệ phí thi: Miễn phí cho học sinh trường đối tác</p>',
          bg: '#eef6ff',
          borderColor: '#1473d1',
          padding: 16
        }
      },
      {
        id: 'block-14',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 20
        },
        content: {
          html: '<p><strong>Phần thưởng ý nghĩa:</strong> Chứng nhận quốc tế từ Science Centre Singapore và cơ hội nhận học bổng tham gia trại hè Khoa học tại Singapore dành cho các thí sinh xuất sắc.</p>'
        }
      },
      {
        id: 'block-15',
        type: 'button-group',
        visible: true,
        styles: {
          marginTop: 15,
          marginBottom: 25
        },
        content: {
          align: 'center',
          gap: 15,
          btn1: {
            text: 'Đăng ký tham gia cho con',
            link: '{{Link đăng ký}}',
            bg: '#1473d1',
            color: '#ffffff',
            radius: 8
          },
          btn2: {
            text: 'Tải tài liệu hướng dẫn',
            link: 'https://www.fermat.vn',
            bg: '#f1f5f9',
            color: '#0f3a72',
            radius: 8
          }
        }
      },
      {
        id: 'block-16',
        type: 'signature',
        visible: true,
        styles: {
          marginTop: 20,
          marginBottom: 10
        },
        content: {
          html: '<p><strong>BAN TỔ CHỨC AYSBC VIỆT NAM</strong><br/>' +
                'Công ty Cổ phần Công nghệ Giáo dục Fermat (FermatTech)<br/>' +
                'Hotline: 0969 627 162<br/>' +
                'Email: contact@fermat.vn<br/>' +
                'Website: <a href="http://www.fermat.vn" target="_blank" style="color: #1473d1; text-decoration: underline;">www.fermat.vn</a></p>'
        }
      }
    ]
  }
];
