import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Client } from 'ssh2';

// Đọc file .env thủ công tránh lỗi thiếu thư viện dotenv
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let val = trimmed.slice(index + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = loadEnv();

const host = env.DEPLOY_HOST;
const port = parseInt(env.DEPLOY_PORT || '22', 10);
const username = env.DEPLOY_USER || 'root';
const password = env.DEPLOY_PASSWORD;
const privateKeyPath = env.DEPLOY_KEY_PATH;
const deployPath = env.DEPLOY_PATH || '/var/www/ft-social-dashboard';

if (!host) {
  console.error('\n\x1b[31m[Lỗi] Chưa cấu hình DEPLOY_HOST trong file .env!\x1b[0m');
  process.exit(1);
}

// Bắt đầu quy trình
async function main() {
  try {
    // Bước 1: Commit và Push git ở local
    const commitMsg = process.argv.slice(2).join(' ') || 'Auto deploy';
    console.log('\n\x1b[36m[1/3] Đang tiến hành commit và push mã nguồn ở local...\x1b[0m');
    
    // Gọi script git-push.mjs đã viết trước đó
    execSync(`node scripts/git-push.mjs "${commitMsg}"`, { stdio: 'inherit' });
    console.log('\x1b[32m-> Commit và Push lên GitHub thành công!\x1b[0m');

    // Bước 2: Kết nối SSH tới VPS
    console.log('\n\x1b[36m[2/3] Đang kết nối tới VPS qua SSH...\x1b[0m');
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

    // Bước 3: Đồng bộ git và chạy script update-vps.sh trên VPS
    console.log('\n\x1b[36m[3/3] Đang chạy lệnh cập nhật và khởi động lại server trên VPS...\x1b[0m');
    
    // Command để kéo code mới và chạy script setup trên VPS
    const remoteCommand = `cd ${deployPath} && git fetch origin main && git reset --hard origin/main && bash scripts/update-vps.sh`;
    
    await executeRemoteCommand(conn, remoteCommand);
    
    console.log('\n\x1b[32m==================================================\x1b[0m');
    console.log('\x1b[32m🎉 TRIỂN KHAI VÀ RESET SERVER VPS THÀNH CÔNG! 🎉\x1b[0m');
    console.log(`\x1b[32mỨng dụng VPS đã được cập nhật thành công tại: http://${host}\x1b[0m`);
    console.log('\x1b[32m==================================================\x1b[0m');

    conn.end();
    process.exit(0);

  } catch (error) {
    console.error('\n\x1b[31m[Lỗi triển khai]:\x1b[0m', error.message);
    process.exit(1);
  }
}

// Hàm thực thi lệnh SSH từ xa
function executeRemoteCommand(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Lệnh từ xa thất bại với mã lỗi ${code}`));
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
