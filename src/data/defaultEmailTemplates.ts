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
      fontFamily: 'Arial, Helvetica, sans-serif',
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
          marginBottom: 15
        },
        content: {
          html: `<p>Kính gửi Quý phụ huynh,</p>
<p>Khi tìm hiểu về một sân chơi học thuật cho con, điều đầu tiên bố mẹ quan tâm thường không phải là giải thưởng, mà là: <em>"Liệu cuộc thi này có thực sự mang lại giá trị thực chất và trải nghiệm bổ ích cho con mình?"</em></p>
<p>Nếu con đã từng thử sức ở các kỳ thi Toán, Khoa học hay Tiếng Anh truyền thống, Ban tổ chức FermatTech trân trọng giới thiệu một hành trình trải nghiệm rất khác biệt:</p>
<p style="font-weight: bold; text-align: center; color: #0f3a72; font-size: 16px; margin: 15px 0;">Cuộc thi Huy hiệu Nhà khoa học Trẻ Châu Á 2026 (AYSBC 2026).</p>
<p>Đây là chương trình giáo dục STEM uy tín được phát triển bởi <strong>Science Centre Singapore Global</strong> (cơ quan trực thuộc Bộ Giáo dục Singapore) với lịch sử hơn 40 năm và hơn 1 triệu huy hiệu đã được trao cho học sinh xuất sắc trong khu vực.</p>`
        }
      },
      {
        id: 'block-3',
        type: 'image',
        visible: true,
        styles: {
          marginTop: 15,
          marginBottom: 20
        },
        content: {
          url: 'https://fermat.vn/UploadFile/Images/2025/8/18/Hinh_anh_638911101534359159.png',
          alt: 'AYSBC 2026 Banner',
          width: 600,
          align: 'center',
          borderRadius: 8,
          link: 'https://www.fermat.vn'
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
          text: 'Phương pháp học qua Huy hiệu được UNESCO và OECD khuyến nghị',
          level: 'h2',
          bold: true,
          color: '#0f3a72',
          fontSize: 18,
          align: 'left'
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
          html: `<p>Thay vì bắt đầu bằng việc luyện đề căng thẳng, AYSBC áp dụng phương pháp tiếp cận tiên tiến: <strong>Học trước khi thi, khám phá trước khi đánh giá</strong>.</p>
<p>Học sinh sẽ từng bước hoàn thành các nhiệm vụ thực hành thực tế để tích lũy 15 ngôi sao (Stars) trên hệ thống trực tuyến trước khi bước vào bài thi chính thức. Phương pháp học tập thông qua khám phá và giải quyết vấn đề này đã được cả UNESCO và OECD khuyến nghị áp dụng nhằm bồi dưỡng năng lực tự học, tư duy chủ động cho học sinh thế kỷ 21.</p>`
        }
      },
      {
        id: 'block-6',
        type: 'heading',
        visible: true,
        styles: {
          marginTop: 20,
          marginBottom: 10
        },
        content: {
          text: 'Đưa khoa học ra khỏi phòng kính – Phù hợp với từng độ tuổi của con',
          level: 'h2',
          bold: true,
          color: '#0f3a72',
          fontSize: 18,
          align: 'left'
        }
      },
      {
        id: 'block-7',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 10
        },
        content: {
          html: `<p>Chương trình được thiết kế cá nhân hóa để đồng hành cùng con từ Lớp 1 đến Lớp 12 thông qua những chủ đề trực quan, gần gũi:</p>
<p><strong>Bảng A - C (Khối Lớp 1 - 6): Khơi mở giác quan và thế giới tự nhiên</strong><br/>
Con tự tay thực hiện các dự án nhỏ ngay tại nhà để chinh phục các huy hiệu danh giá:</p>`
        }
      },
      {
        id: 'block-8',
        type: 'bullet-list',
        visible: true,
        styles: {
          marginTop: 5,
          marginBottom: 15
        },
        content: {
          items: [
            '<strong>Young Entomologist</strong> (Nhà côn trùng học trẻ - quan sát vòng đời côn trùng quanh nhà)',
            '<strong>Young Botanist</strong> (Nhà thực vật học trẻ - khám phá sự kỳ diệu của thực vật)',
            '<strong>Young Food Scientist</strong> (Nhà khoa học thực phẩm trẻ - tìm hiểu phản ứng hóa sinh ngay trong bếp ăn gia đình)'
          ]
        }
      },
      {
        id: 'block-9',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 10
        },
        content: {
          html: `<p><strong>Bảng D - E (Khối Lớp 7 - 12): Tư duy toàn cầu và Kiến tạo hồ sơ học thuật</strong><br/>
Con thử thách bản thân với các bài toán mang tính giải quyết vấn đề (Problem-solving) qua các chủ đề:</p>`
        }
      },
      {
        id: 'block-10',
        type: 'bullet-list',
        visible: true,
        styles: {
          marginTop: 5,
          marginBottom: 10
        },
        content: {
          items: [
            '<strong>Young Mathematician</strong> (Toán học ứng dụng)',
            '<strong>Young Sustainability Champion</strong> (Nhà phát triển bền vững trẻ - nghiên cứu về biến đổi khí hậu, lối sống xanh)'
          ]
        }
      },
      {
        id: 'block-11',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 15
        },
        content: {
          html: `<p>Đây là chủ đề "vàng" rất được ưu ái trong các hồ sơ xét tuyển và săn học bổng du học quốc tế hiện nay.</p>`
        }
      },
      {
        id: 'block-12',
        type: 'image',
        visible: true,
        styles: {
          marginTop: 15,
          marginBottom: 20
        },
        content: {
          url: 'https://fermat.vn/UploadFile/Images/2025/8/18/Hinh_anh_638911101534359159.png',
          alt: 'AYSBC 25-26/07/2026 Exam Info',
          width: 600,
          align: 'center',
          borderRadius: 8,
          link: 'https://www.fermat.vn'
        }
      },
      {
        id: 'block-13',
        type: 'heading',
        visible: true,
        styles: {
          marginTop: 20,
          marginBottom: 10
        },
        content: {
          text: 'Hành trình chinh phục AYSBC 2026 diễn ra như thế nào?',
          level: 'h2',
          bold: true,
          color: '#0f3a72',
          fontSize: 18,
          align: 'left'
        }
      },
      {
        id: 'block-14',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 5
        },
        content: {
          html: `<p><strong>Vòng Quốc gia (Thi trực tuyến):</strong></p>`
        }
      },
      {
        id: 'block-15',
        type: 'bullet-list',
        visible: true,
        styles: {
          marginTop: 5,
          marginBottom: 15
        },
        content: {
          items: [
            '<strong>20% số điểm:</strong> Hoàn thành các nhiệm vụ thực hành thực tế để tích lũy 15 Stars trên hệ thống Young Scientist Badge.',
            '<strong>80% số điểm:</strong> Bài thi trắc nghiệm trực tuyến đánh giá tư duy khoa học (60 phút, 20 câu hỏi) diễn ra vào ngày <strong>25–26/07/2026</strong>.'
          ]
        }
      },
      {
        id: 'block-16',
        type: 'paragraph',
        visible: true,
        styles: {
          marginTop: 10,
          marginBottom: 5
        },
        content: {
          html: `<p><strong>Phần thưởng & Cơ hội giao lưu quốc tế:</strong></p>`
        }
      },
      {
        id: 'block-17',
        type: 'bullet-list',
        visible: true,
        styles: {
          marginTop: 5,
          marginBottom: 15
        },
        content: {
          items: [
            '<strong>100%</strong> học sinh hoàn thành thử thách thực hành đạt chuẩn đều nhận được Chứng chỉ quốc tế cấp bởi Singapore Science Centre Global.',
            'Những học sinh đạt thành tích xuất sắc tại Vòng Quốc gia sẽ nhận được cơ hội tham dự Vòng Khu vực trực tiếp tại Singapore vào tháng <strong>10/2026</strong> (tham gia các workshop STEM chuyên sâu, làm bài thi trực tiếp và giao lưu với bạn bè quốc tế).'
          ]
        }
      },
      {
        id: 'block-18',
        type: 'highlight-box',
        visible: true,
        styles: {
          marginTop: 15,
          marginBottom: 20
        },
        content: {
          html: `<p><strong>Hạn đăng ký Vòng thi quốc gia Đợt 2: Trước ngày 22/07/2026</strong><br/>
Nếu Quý phụ huynh đang tìm kiếm một hoạt động hè vừa bổ ích, vừa giúp con phát triển tư duy khoa học và kỹ năng thực hành một cách tự nhiên, AYSBC là một sân chơi rất đáng để trải nghiệm.</p>`,
          bg: '#eef6ff',
          borderColor: '#1473d1',
          padding: 16
        }
      },
      {
        id: 'block-19',
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
            text: 'Follow page AYSBC Việt Nam',
            link: 'https://facebook.com/aysbcvietnam',
            bg: '#f1f5f9',
            color: '#0f3a72',
            radius: 8
          }
        }
      },
      {
        id: 'block-20',
        type: 'signature',
        visible: true,
        styles: {
          marginTop: 20,
          marginBottom: 10
        },
        content: {
          html: `<p>Trân trọng.<br/>
<strong>BAN TỔ CHỨC AYSBC VIỆT NAM</strong><br/>
Công ty Cổ phần Công nghệ Giáo dục Fermat (FermatTech)<br/>
Hotline: 0969 627 162<br/>
Email: <a href="mailto:contact@fermat.vn" style="color: #1473d1; text-decoration: underline;">contact@fermat.vn</a></p>`
        }
      }
    ]
  }
];
