import { google } from 'googleapis';
import { adminDb } from './firebase';

/**
 * Hàm helper tự động lấy thông tin xác thực Google Sheets theo thứ tự ưu tiên:
 * 1. Biến môi trường GOOGLE_SERVICE_ACCOUNT_JSON
 * 2. Cấu hình googleServiceAccountJson lưu trong SQLite (systemConfig/main)
 * 3. Fallback: User Access Token tạm thời
 */
export async function getGoogleSheetsAuth(userToken: string | null): Promise<any> {
  // 1. Kiểm tra biến môi trường
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      if (sa.client_email && sa.private_key) {
        console.log('[Sheets] Sử dụng Google Service Account từ biến môi trường GOOGLE_SERVICE_ACCOUNT_JSON.');
        return sa;
      }
    } catch (e: any) {
      console.error('[Sheets] Lỗi parse GOOGLE_SERVICE_ACCOUNT_JSON từ env:', e.message);
    }
  }

  // 2. Kiểm tra tài liệu cấu hình SQLite
  try {
    const configSnap = await adminDb.collection('systemConfig').doc('main').get();
    if (configSnap.exists) {
      const configData = configSnap.data();
      if (configData?.googleServiceAccountJson) {
        try {
          const sa = JSON.parse(configData.googleServiceAccountJson);
          if (sa.client_email && sa.private_key) {
            console.log('[Sheets] Sử dụng Google Service Account từ SQLite systemConfig/main.');
            return sa;
          }
        } catch (e: any) {
          console.error('[Sheets] Lỗi parse googleServiceAccountJson từ SQLite:', e.message);
        }
      }
    }
  } catch (e: any) {
    console.warn('[Sheets] Không thể đọc googleServiceAccountJson từ SQLite:', e.message);
  }

  // 3. Fallback
  if (userToken && userToken.trim() !== '') {
    console.log('[Sheets] Sử dụng OAuth 2.0 User Access Token tạm thời.');
    return userToken;
  }

  return null;
}

export class SheetsService {
  private sheetsClient;
  private spreadsheetId: string;

  constructor(authConfig: string | { client_email: string; private_key: string }, spreadsheetId: string) {
    let auth: any;
    if (typeof authConfig === 'string') {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: authConfig });
      auth = oauth2Client;
    } else {
      auth = new google.auth.JWT({
        email: authConfig.client_email,
        key: authConfig.private_key.replace(/\\n/g, '\n'), // Đảm bảo dòng xuống dòng trong private key được format đúng
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    this.sheetsClient = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = spreadsheetId;
  }

  /**
   * Khởi tạo cấu trúc 5 sheets nếu chưa tồn tại
   */
  async initializeSheetsStructure() {
    try {
      // 1. Lấy thông tin Spreadsheet hiện tại
      const metadata = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const existingSheets = metadata.data.sheets || [];
      const existingSheetNames = existingSheets.map(s => s.properties?.title).filter(Boolean) as string[];

      const requiredSheets = ['DASHBOARD', 'KENH_MXH', 'BAI_DANG', 'DU_LIEU_NGAY', 'NHAT_KY_API'];
      const requests: any[] = [];

      // Tạo các sheet còn thiếu
      for (const sheetName of requiredSheets) {
        if (!existingSheetNames.includes(sheetName)) {
          requests.push({
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: {
                  rowCount: sheetName === 'DASHBOARD' ? 100 : 1000,
                  columnCount: 20,
                },
              },
            },
          });
        }
      }

      if (requests.length > 0) {
        await this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests },
        });
      }

      // 2. Điền tiêu đề và định dạng cho từng sheet
      await this.setupHeaders();
      return { success: true, message: 'Khởi tạo cấu trúc Google Sheets thành công!' };
    } catch (error: any) {
      console.error('Lỗi khi cấu hình Google Sheets:', error);
      throw new Error(`Không thể khởi tạo Google Sheets: ${error.message}`);
    }
  }

  private async setupHeaders() {
    // Định nghĩa tiêu đề cho từng sheet
    const sheetHeaders: { [key: string]: string[] } = {
      KENH_MXH: [
        'channel_id', 'platform', 'channel_name', 'external_id', 'channel_url',
        'status', 'timezone', 'created_at', 'updated_at', 'last_sync_at',
        'last_sync_status', 'total_posts', 'reactions', 'comments', 'shares', 'total_engagement'
      ],
      BAI_DANG: [
        'post_key', 'platform', 'channel_id', 'external_post_id', 'post_url',
        'post_type', 'message', 'published_at', 'imported_at', 'updated_at',
        'is_deleted', 'reactions', 'likes', 'comments', 'shares', 'views', 'reach',
        'total_engagement', 'engagement_rate'
      ],
      DU_LIEU_NGAY: [
        'snapshot_key', 'snapshot_date', 'platform', 'channel_id', 'post_key',
        'reactions', 'likes', 'comments', 'shares', 'views', 'reach',
        'impressions', 'clicks', 'total_engagement', 'engagement_rate', 'fetched_at'
      ],
      NHAT_KY_API: [
        'log_id', 'started_at', 'ended_at', 'platform', 'action', 'channel_id',
        'status', 'records_received', 'records_inserted', 'records_updated',
        'error_code', 'error_message', 'request_id'
      ],
    };

    for (const [sheetName, headers] of Object.entries(sheetHeaders)) {
      // Đọc hàng đầu tiên để kiểm tra tiêu đề đã tồn tại chưa
      const response = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A1:Z1`,
      });

      const currentHeaders = response.data.values?.[0] || [];
      if (currentHeaders.length === 0) {
        // Ghi tiêu đề mới
        await this.sheetsClient.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [headers],
          },
        });

        // Định dạng header: Freeze dòng 1, in đậm, đổi màu nền nhẹ
        await this.formatHeader(sheetName, headers.length);
      }
    }

    // Thiết lập và định dạng Dashboard
    const metadata = await this.sheetsClient.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });
    const dbSheet = metadata.data.sheets?.find(s => s.properties?.title === 'DASHBOARD');
    const dbSheetId = dbSheet?.properties?.sheetId;

    const dashboardValues = [
      ['FT SOCIAL ANALYTICS - BẢO CÁO TỔNG QUAN', ''],
      ['Thời điểm cập nhật:', new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' })],
      ['', ''],
      ['Số liệu KPI tổng hợp (Tự động cập nhật qua sync)', ''],
      ['Chỉ số', 'Giá trị'],
      ['Tổng số bài viết', '=COUNTA(BAI_DANG!A2:A)'],
      ['Tổng lượt tương tác (Engagement)', '=SUM(DU_LIEU_NGAY!N2:N)'],
      ['Tổng lượt tiếp cận (Reach)', '=SUM(DU_LIEU_NGAY!K2:K)'],
      ['Lượt xem (Views)', '=SUM(DU_LIEU_NGAY!J2:J)'],
      ['Phản hồi (Reactions)', '=SUM(DU_LIEU_NGAY!F2:F)'],
      ['Bình luận (Comments)', '=SUM(DU_LIEU_NGAY!H2:H)'],
      ['Chia sẻ (Shares)', '=SUM(DU_LIEU_NGAY!I2:I)'],
      ['', ''],
      ['Lưu ý:', 'Đây là bảng tổng hợp công thức từ các tab chi tiết.'],
      ['', ''],
      ['Thống kê tương tác theo Kênh', ''],
      ['Tên Kênh', 'Tổng tương tác'],
      ['=IFERROR(INDEX(KENH_MXH!C2:C, 1), "")', '=IF(A18="","",SUMIF(DU_LIEU_NGAY!D:D, INDEX(KENH_MXH!A2:A, 1), DU_LIEU_NGAY!N:N))'],
      ['=IFERROR(INDEX(KENH_MXH!C3:C, 1), "")', '=IF(A19="","",SUMIF(DU_LIEU_NGAY!D:D, INDEX(KENH_MXH!A3:A, 1), DU_LIEU_NGAY!N:N))'],
      ['=IFERROR(INDEX(KENH_MXH!C4:C, 1), "")', '=IF(A20="","",SUMIF(DU_LIEU_NGAY!D:D, INDEX(KENH_MXH!A4:A, 1), DU_LIEU_NGAY!N:N))'],
      ['=IFERROR(INDEX(KENH_MXH!C5:C, 1), "")', '=IF(A21="","",SUMIF(DU_LIEU_NGAY!D:D, INDEX(KENH_MXH!A5:A, 1), DU_LIEU_NGAY!N:N))'],
      ['=IFERROR(INDEX(KENH_MXH!C6:C, 1), "")', '=IF(A22="","",SUMIF(DU_LIEU_NGAY!D:D, INDEX(KENH_MXH!A6:A, 1), DU_LIEU_NGAY!N:N))'],
      ['=IFERROR(INDEX(KENH_MXH!C7:C, 1), "")', '=IF(A23="","",SUMIF(DU_LIEU_NGAY!D:D, INDEX(KENH_MXH!A7:A, 1), DU_LIEU_NGAY!N:N))'],
      ['=IFERROR(INDEX(KENH_MXH!C8:C, 1), "")', '=IF(A24="","",SUMIF(DU_LIEU_NGAY!D:D, INDEX(KENH_MXH!A8:A, 1), DU_LIEU_NGAY!N:N))'],
    ];

    await this.sheetsClient.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: 'DASHBOARD!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: dashboardValues },
    });

    // Thêm biểu đồ cột cho dữ liệu Kênh nếu chưa có biểu đồ nào
    if (dbSheet && dbSheetId !== undefined && (!dbSheet.charts || dbSheet.charts.length === 0)) {
      try {
        await this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                addChart: {
                  chart: {
                    spec: {
                      title: 'Tổng tương tác tích lũy theo Kênh MXH',
                      basicChart: {
                        chartType: 'COLUMN',
                        legendPosition: 'NONE',
                        axis: [
                          {
                            position: 'BOTTOM_AXIS',
                            title: 'Kênh MXH'
                          },
                          {
                            position: 'LEFT_AXIS',
                            title: 'Tổng tương tác'
                          }
                        ],
                        domains: [
                          {
                            domain: {
                              sourceRange: {
                                sources: [
                                  {
                                    sheetId: dbSheetId,
                                    startRowIndex: 16, // Dòng 17 (Tên Kênh)
                                    endRowIndex: 25,   // Dòng 25
                                    startColumnIndex: 0, // Cột A
                                    endColumnIndex: 1  // Cột A
                                  }
                                ]
                              }
                            }
                          }
                        ],
                        series: [
                          {
                            series: {
                              sourceRange: {
                                sources: [
                                  {
                                    sheetId: dbSheetId,
                                    startRowIndex: 16, // Dòng 17 (Tổng tương tác)
                                    endRowIndex: 25,   // Dòng 25
                                    startColumnIndex: 1, // Cột B
                                    endColumnIndex: 2  // Cột B
                                  }
                                ]
                              }
                            },
                            targetAxis: 'LEFT_AXIS'
                          }
                        ]
                      }
                    },
                    position: {
                      overlayPosition: {
                        anchorCell: {
                          sheetId: dbSheetId,
                          rowIndex: 3, // Dòng 4
                          columnIndex: 3 // Cột D (index 3)
                        },
                        widthPixels: 600,
                        heightPixels: 350
                      }
                    }
                  }
                }
              }
            ]
          }
        });
        console.log('[Sheets] Đã khởi tạo biểu đồ cột tổng quan trên tab DASHBOARD.');
      } catch (chartErr: any) {
        console.error('Lỗi khi chèn biểu đồ vào Google Sheets:', chartErr.message);
      }
    }
  }

  private async formatHeader(sheetName: string, colCount: number) {
    try {
      // Lấy sheet ID
      const metadata = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });
      const sheet = metadata.data.sheets?.find(s => s.properties?.title === sheetName);
      if (!sheet || !sheet.properties) return;
      const sheetId = sheet.properties.sheetId;

      await this.sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [
            // Freeze 1 dòng
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: {
                    frozenRowCount: 1,
                  },
                },
                fields: 'gridProperties.frozenRowCount',
              },
            },
            // Format hàng đầu tiên (Bold, background light grey, center align)
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: colCount,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    textFormat: { bold: true },
                    horizontalAlignment: 'CENTER',
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
              },
            },
            // Auto-resize columns
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: colCount,
                },
              },
            },
          ],
        },
      });
    } catch (e) {
      console.error(`Không thể định dạng sheet ${sheetName}:`, e);
    }
  }

  /**
   * Đọc toàn bộ dữ liệu của một Sheet và parse thành Objects
   */
  /** Read the first visible tab, or a caller-selected tab, as row objects. */
  async readFirstSheet(preferredSheet?: string): Promise<{ title: string; rows: any[] }> {
    const metadata = await this.sheetsClient.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const titles = (metadata.data.sheets || []).map((sheet: any) => sheet.properties?.title).filter(Boolean) as string[];
    const title = preferredSheet && titles.includes(preferredSheet) ? preferredSheet : titles[0];
    if (!title) throw new Error('Google Sheets không có trang dữ liệu.');
    return { title, rows: await this.readSheet(title) };
  }
  async readSheet(sheetName: string): Promise<any[]> {
    const response = await this.sheetsClient.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A1:Z`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return [];

    const headers = rows[0];
    const dataRows = rows.slice(1);

    return dataRows.map(row => {
      const obj: any = {};
      headers.forEach((header, index) => {
        let val = row[index];
        if (val === undefined || val === '') {
          val = null;
        } else if (!isNaN(Number(val)) && val.trim() !== '') {
          val = Number(val);
        } else if (val === 'true') {
          val = true;
        } else if (val === 'false') {
          val = false;
        }
        obj[header] = val;
      });
      return obj;
    });
  }

  /**
   * Upsert bản ghi vào một sheet cụ thể theo cột Key
   */
  async upsertRecords(sheetName: string, keyColumn: string, records: any[]) {
    if (records.length === 0) return;

    // 1. Đọc dữ liệu hiện có
    const response = await this.sheetsClient.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A1:Z`,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      throw new Error(`Sheet ${sheetName} chưa được định dạng tiêu đề.`);
    }

    const headers = rows[0];
    const keyColIndex = headers.indexOf(keyColumn);
    if (keyColIndex === -1) {
      throw new Error(`Không tìm thấy cột khóa "${keyColumn}" trong sheet ${sheetName}`);
    }

    const keyRowMap = new Map<string, number>(); // key -> row index (0-indexed)
    rows.forEach((row, idx) => {
      if (idx === 0) return; // Bỏ qua header
      const keyVal = row[keyColIndex];
      if (keyVal !== undefined && keyVal !== null && keyVal !== '') {
        keyRowMap.set(String(keyVal), idx);
      }
    });

    const updateRequests: { range: string; values: any[][] }[] = [];
    const appendValues: any[][] = [];

    records.forEach(record => {
      // Xây dựng mảng giá trị cho dòng tương ứng với các headers
      const rowValue = headers.map(header => {
        const val = record[header];
        if (val === undefined || val === null) return '';
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        return val;
      });

      const keyVal = String(record[keyColumn]);
      if (keyRowMap.has(keyVal)) {
        // Cập nhật dòng hiện tại (1-indexed trong Sheets)
        const rowIndex = keyRowMap.get(keyVal)! + 1;
        updateRequests.push({
          range: `${sheetName}!A${rowIndex}:${this.getColLetter(headers.length)}${rowIndex}`,
          values: [rowValue],
        });
      } else {
        // Thêm mới
        appendValues.push(rowValue);
      }
    });

    // 2. Thực hiện cập nhật các dòng trùng khóa
    if (updateRequests.length > 0) {
      // Chunk cập nhật thành các lô tối đa 100 dòng
      for (let i = 0; i < updateRequests.length; i += 100) {
        const chunk = updateRequests.slice(i, i + 100);
        await this.sheetsClient.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: chunk,
          },
        });
      }
    }

    // 3. Thêm mới các dòng không trùng khóa
    if (appendValues.length > 0) {
      await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A2`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: appendValues,
        },
      });
    }

    // Auto resize lại sau khi đồng bộ
    try {
      const metadata = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });
      const sheet = metadata.data.sheets?.find(s => s.properties?.title === sheetName);
      if (sheet && sheet.properties) {
        await this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                autoResizeDimensions: {
                  dimensions: {
                    sheetId: sheet.properties.sheetId,
                    dimension: 'COLUMNS',
                    startIndex: 0,
                    endIndex: headers.length,
                  },
                },
              },
            ],
          },
        });
      }
    } catch (e) {
      // Lỗi auto resize không chặn luồng
    }
  }

  private getColLetter(index: number): string {
    let temp = '';
    while (index > 0) {
      const m = (index - 1) % 26;
      temp = String.fromCharCode(65 + m) + temp;
      index = Math.floor((index - m) / 26);
    }
    return temp || 'A';
  }
}
