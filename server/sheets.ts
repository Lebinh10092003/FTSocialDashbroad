import { google } from 'googleapis';

export class SheetsService {
  private sheetsClient;
  private spreadsheetId: string;

  constructor(accessToken: string, spreadsheetId: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
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
        'last_sync_status', 'total_posts'
      ],
      BAI_DANG: [
        'post_key', 'platform', 'channel_id', 'external_post_id', 'post_url',
        'post_type', 'message', 'published_at', 'imported_at', 'updated_at',
        'is_deleted'
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

    // Thiết lập Dashboard cơ bản nếu trống
    const dbCheck = await this.sheetsClient.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'DASHBOARD!A1:B1',
    });
    if (!dbCheck.data.values?.[0]?.[0]) {
      const dashboardValues = [
        ['FT SOCIAL ANALYTICS - BẢO CÁO TỔNG QUAN', ''],
        ['Thời điểm khởi tạo:', new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' })],
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
      ];
      await this.sheetsClient.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'DASHBOARD!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: dashboardValues },
      });
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
