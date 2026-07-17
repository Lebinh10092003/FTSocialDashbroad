import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import archiver from 'archiver';
import { Client } from 'ssh2';
import dotenv from 'dotenv';

// Đọc file .env hiện tại
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Các thông số cấu hình SSH deploy lấy từ .env
const host = process.env.DEPLOY_HOST;
const port = parseInt(process.env.DEPLOY_PORT || '22', 10);
const username = process.env.DEPLOY_USER || 'root';
const password = process.env.DEPLOY_PASSWORD;
const privateKeyPath = process.env.DEPLOY_KEY_PATH;
const deployPath = process.env.DEPLOY_PATH || '/var/www/ft-social-dashboard';

// Kiểm tra xem cấu hình SSH có hợp lệ không
if (!host) {
  console.error('\n\x1b[31m[Lỗi] Chưa cấu hình DEPLOY_HOST trong file .env hoặc biến môi trường.\x1b[0m');
  console.error('Vui lòng tạo hoặc bổ sung các biến cấu hình deploy sau vào file .env:');
  console.error('  DEPLOY_HOST=123.45.67.89');
  console.error('  DEPLOY_USER=root');
  console.error('  DEPLOY_PASSWORD=your_password (hoặc DEPLOY_KEY_PATH=C:/path/to/key)');
  console.error('  DEPLOY_PATH=/var/www/ft-social-dashboard');
  process.exit(1);
}

// Bắt đầu quy trình
async function main() {
  try {
    // Bước 1: Build dự án ở local
    console.log('\n\x1b[36m[1/6] Đang build dự án ở máy local...\x1b[0m');
    execSync('npm run build', { stdio: 'inherit' });
    console.log('\x1b[32m-> Build dự án thành công!\x1b[0m');

    // Bước 2: Nén các file cần thiết
    console.log('\n\x1b[36m[2/6] Đang nén các file cần thiết thành deploy.tar.gz...\x1b[0m');
    const archivePath = path.join(process.cwd(), 'deploy.tar.gz');
    await createTarball(archivePath);
    console.log(`\x1b[32m-> Đã tạo file nén tại: ${archivePath}\x1b[0m`);

    // Bước 3: Kết nối SSH & SFTP lên VPS
    console.log('\n\x1b[36m[3/6] Đang kết nối tới VPS...\x1b[0m');
    const sshConfig = { host, port, username };
    if (privateKeyPath) {
      if (fs.existsSync(privateKeyPath)) {
        sshConfig.privateKey = fs.readFileSync(privateKeyPath);
      } else {
        console.warn(`\x1b[33m[Cảnh báo] File SSH Key tại ${privateKeyPath} không tồn tại. Thử kết nối không dùng Key...\x1b[0m`);
      }
    }
    if (password) {
      sshConfig.password = password;
    }

    const conn = new Client();
    await new Promise((resolve, reject) => {
      conn.on('ready', resolve).on('error', reject).connect(sshConfig);
    });
    console.log('\x1b[32m-> Kết nối SSH thành công!\x1b[0m');

    // Bước 4: Upload file lên VPS qua SFTP
    console.log('\n\x1b[36m[4/6] Đang tải file deploy.tar.gz lên VPS...\x1b[0m');
    const sftp = await new Promise((resolve, reject) => {
      conn.sftp((err, sftpSession) => {
        if (err) reject(err);
        else resolve(sftpSession);
      });
    });

    const remoteArchivePath = `/tmp/deploy_${Date.now()}.tar.gz`;
    await new Promise((resolve, reject) => {
      sftp.fastPut(archivePath, remoteArchivePath, {}, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log(`\x1b[32m-> Đã tải file nén lên VPS tại: ${remoteArchivePath}\x1b[0m`);

    // Bước 5: Giải nén, Cài đặt dependencies và khởi động lại
    console.log('\n\x1b[36m[5/6] Đang giải nén và cấu hình ứng dụng trên VPS...\x1b[0m');
    
    // Tạo thư mục deploy và giải nén
    console.log(`- Tạo thư mục ${deployPath} (nếu chưa có) và giải nén...`);
    await executeRemoteCommand(conn, `mkdir -p ${deployPath}`);
    await executeRemoteCommand(conn, `tar -xzf ${remoteArchivePath} -C ${deployPath}`);
    await executeRemoteCommand(conn, `rm -f ${remoteArchivePath}`);

    // Cài đặt production dependencies trên VPS
    console.log('- Đang cài đặt dependencies trên VPS (npm install --omit=dev)...');
    await executeRemoteCommand(conn, `cd ${deployPath} && npm install --omit=dev`);

    // Kiểm tra xem PM2 có được cài đặt hay không
    console.log('- Đang kiểm tra trạng thái PM2 trên VPS...');
    let hasPm2 = false;
    try {
      const pm2Check = await executeRemoteCommand(conn, 'command -v pm2');
      if (pm2Check.trim()) {
        hasPm2 = true;
      }
    } catch (e) {
      // Bỏ qua lỗi nếu command -v pm2 trả về code != 0
    }

    if (hasPm2) {
      console.log('\x1b[32m-> Phát hiện PM2 đang được cài đặt trên VPS. Khởi chạy bằng PM2...\x1b[0m');
      // Chạy khởi động/khởi động lại bằng PM2
      const appName = 'ft-social-dashboard';
      await executeRemoteCommand(
        conn, 
        `cd ${deployPath} && (pm2 delete ${appName} || true) && NODE_ENV=production pm2 start dist/server.cjs --name "${appName}" --output "server.log" --error "server.log"`
      );
      // Tự động lưu cấu hình pm2
      await executeRemoteCommand(conn, 'pm2 save');
      console.log('\x1b[32m-> PM2 đã khởi động ứng dụng thành công!\x1b[0m');
    } else {
      console.log('\x1b[33m[Cảnh báo] Không tìm thấy PM2 trên VPS. Đang chạy ứng dụng dạng background bằng node...\x1b[0m');
      console.log('Khuyên dùng: Bạn nên cài đặt PM2 trên VPS bằng lệnh: npm install -g pm2');
      
      // Chạy ứng dụng dưới dạng background bằng nohup
      // Kill app cũ chạy trên cổng cũ nếu có (hoặc kill node dist/server.cjs trước)
      await executeRemoteCommand(conn, `pkill -f "dist/server.cjs" || true`);
      await executeRemoteCommand(
        conn,
        `cd ${deployPath} && nohup env NODE_ENV=production node dist/server.cjs > server.log 2>&1 &`
      );
      console.log('\x1b[32m-> Đã khởi chạy Node background thông qua nohup. Xem log tại server.log trên VPS.\x1b[0m');
    }

    // Chờ 3 giây để server khởi động và dò tìm cổng rảnh
    console.log('- Đang chờ 3 giây để ứng dụng khởi tạo cổng trên VPS...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Đọc log để tìm cổng hoạt động thực tế
    console.log('- Đang quét log trên VPS để lấy cổng hoạt động...');
    const logContent = await executeRemoteCommand(conn, `tail -n 50 ${deployPath}/server.log || cat ${deployPath}/server.log`);
    
    let activePort = null;
    const portMatch = logContent.match(/Server đang chạy tại http:\/\/(localhost|0\.0\.0\.0|127\.0\.0\.1):(\d+)/i);
    if (portMatch && portMatch[2]) {
      activePort = portMatch[2];
    } else {
      // Thử tìm regex sơ cua hơn
      const genericMatch = logContent.match(/(running|chạy).*:(6\d{3}|5\d{3}|4\d{3}|3\d{3}|8\d{3})/i);
      if (genericMatch && genericMatch[2]) {
        activePort = genericMatch[2];
      }
    }

    // Bước 6: Cleanup local file nén
    console.log('\n\x1b[36m[6/6] Đang dọn dẹp các tệp tạm thời ở máy local...\x1b[0m');
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
    console.log('\x1b[32m-> Đã xóa file deploy.tar.gz ở local.\x1b[0m');

    console.log('\n\x1b[32m==================================================\x1b[0m');
    console.log('\x1b[32m🎉 TRIỂN KHAI LÊN VPS THÀNH CÔNG HOÀN TOÀN! 🎉\x1b[0m');
    if (activePort) {
      console.log(`\x1b[32mỨng dụng đang chạy tại địa chỉ: \x1b[1mhttp://${host}:${activePort}\x1b[0m`);
      console.log(`\x1b[33m(Cơ chế tự động tránh cổng bị chiếm: Cổng ${activePort} đã được sử dụng thành công)\x1b[0m`);
    } else {
      console.log(`\x1b[32mỨng dụng đã khởi chạy thành công tại địa chỉ IP: http://${host}\x1b[0m`);
      console.log('\x1b[33m(Không trích xuất được cổng cụ thể từ log. Vui lòng kiểm tra log trên VPS tại server.log)\x1b[0m');
    }
    console.log('\x1b[32m==================================================\x1b[0m');

    conn.end();
    process.exit(0);

  } catch (error) {
    console.error('\n\x1b[31m[Lỗi triển khai]:\x1b[0m', error.message);
    // Cleanup local archive if error
    const archivePath = path.join(process.cwd(), 'deploy.tar.gz');
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
    process.exit(1);
  }
}

// Hàm hỗ trợ nén tarball
function createTarball(outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('tar', {
      gzip: true,
      gzipOptions: { level: 9 }
    });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    // Thêm các thư mục cần thiết
    archive.directory('dist/', 'dist');
    if (fs.existsSync('server/data')) {
      archive.directory('server/data/', 'server/data');
    }

    // Thêm các file đơn lẻ
    archive.file('package.json', { name: 'package.json' });
    archive.file('package-lock.json', { name: 'package-lock.json' });
    if (fs.existsSync('firebase-applet-config.json')) {
      archive.file('firebase-applet-config.json', { name: 'firebase-applet-config.json' });
    }
    if (fs.existsSync('.env')) {
      archive.file('.env', { name: '.env' });
    }

    archive.finalize();
  });
}

// Hàm thực thi lệnh SSH từ xa
function executeRemoteCommand(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', (code) => {
        if (code !== 0 && !cmd.includes('|| true') && !cmd.includes('command -v')) {
          reject(new Error(`Lệnh thất bại với mã lỗi ${code}: ${cmd}\nStderr: ${stderr}`));
        } else {
          resolve(stdout);
        }
      }).on('data', (data) => {
        stdout += data.toString();
        process.stdout.write(data);
      }).stderr.on('data', (data) => {
        stderr += data.toString();
        process.stderr.write(data);
      });
    });
  });
}

main();
