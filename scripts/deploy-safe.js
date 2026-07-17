import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import archiver from 'archiver';
import { Client } from 'ssh2';
import dotenv from 'dotenv';

dotenv.config();

const host = process.env.DEPLOY_HOST;
const sshPort = Number.parseInt(process.env.DEPLOY_PORT || '22', 10);
const username = process.env.DEPLOY_USER || 'root';
const password = process.env.DEPLOY_PASSWORD;
const privateKeyPath = process.env.DEPLOY_KEY_PATH;
const deployPath = process.env.DEPLOY_PATH || '/var/www/ft-social-dashboard';
const appPort = Number.parseInt(process.env.PORT || '5500', 10);
const appName = process.env.PM2_APP_NAME || 'ft-social-dashboard';
const publicUrl = String(
  process.env.DEPLOY_PUBLIC_URL || process.env.APP_URL || 'https://workspace.fermat.vn',
).replace(/\/$/, '');
const archivePath = path.join(process.cwd(), 'deploy.tar.gz');

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function validateConfig() {
  if (!host) throw new Error('Thiếu DEPLOY_HOST trong file .env.');
  if (!Number.isFinite(sshPort) || sshPort < 1 || sshPort > 65535) {
    throw new Error('DEPLOY_PORT không hợp lệ.');
  }
  if (!Number.isFinite(appPort) || appPort < 1 || appPort > 65535) {
    throw new Error('PORT không hợp lệ.');
  }
  const url = new URL(publicUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('DEPLOY_PUBLIC_URL không hợp lệ.');
  }
  if (privateKeyPath && !fs.existsSync(privateKeyPath)) {
    throw new Error(`Không tìm thấy SSH key: ${privateKeyPath}`);
  }
}

function runtimeEnv() {
  if (!fs.existsSync('.env')) return '';
  const localOnlyKeys = new Set([
    'DEPLOY_HOST',
    'DEPLOY_PORT',
    'DEPLOY_USER',
    'DEPLOY_PASSWORD',
    'DEPLOY_KEY_PATH',
    'DEPLOY_PATH',
    'DEPLOY_PUBLIC_URL',
    'PM2_APP_NAME',
  ]);

  return fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(line => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return !match || !localOnlyKeys.has(match[1]);
    })
    .join('\n')
    .replace(/\s*$/, '\n');
}

function createArchive() {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    archive.directory('dist/', 'dist');
    archive.file('package.json', { name: 'package.json' });
    if (fs.existsSync('package-lock.json')) {
      archive.file('package-lock.json', { name: 'package-lock.json' });
    }
    if (fs.existsSync('firebase-applet-config.json')) {
      archive.file('firebase-applet-config.json', { name: 'firebase-applet-config.json' });
    }

    const envContent = runtimeEnv();
    if (envContent) archive.append(envContent, { name: '.env' });

    // Không đưa dữ liệu local server/data hoặc uploads lên VPS.
    archive.finalize();
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const connection = new Client();
    const config = {
      host,
      port: sshPort,
      username,
      readyTimeout: 20_000,
      keepaliveInterval: 10_000,
    };

    if (password) config.password = password;
    if (privateKeyPath) config.privateKey = fs.readFileSync(privateKeyPath);

    connection.once('ready', () => resolve(connection));
    connection.once('error', reject);
    connection.connect(config);
  });
}

function getSftp(connection) {
  return new Promise((resolve, reject) => {
    connection.sftp((error, sftp) => error ? reject(error) : resolve(sftp));
  });
}

function upload(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, {}, error => error ? reject(error) : resolve());
  });
}

function runRemote(connection, command) {
  return new Promise((resolve, reject) => {
    connection.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';

      stream.on('data', data => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text);
      });
      stream.stderr.on('data', data => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text);
      });
      stream.on('close', code => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || stdout || `Lệnh VPS thất bại với mã ${code}`));
      });
    });
  });
}

function deploymentCommands(remoteArchive, stagingPath) {
  return `
set -euo pipefail
DEPLOY_PATH=${shellQuote(deployPath)}
STAGING_PATH=${shellQuote(stagingPath)}
REMOTE_ARCHIVE=${shellQuote(remoteArchive)}
APP_PORT=${shellQuote(appPort)}
APP_NAME=${shellQuote(appName)}

command -v pm2 >/dev/null 2>&1 || { echo "PM2 chưa được cài đặt." >&2; exit 1; }
mkdir -p "$DEPLOY_PATH/uploads" "$DEPLOY_PATH/server/data" "$STAGING_PATH"
tar -xzf "$REMOTE_ARCHIVE" -C "$STAGING_PATH"
rm -f "$REMOTE_ARCHIVE"

cd "$STAGING_PATH"
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
sleep 1
if ss -ltn "sport = :$APP_PORT" | grep -q LISTEN; then
  echo "Cổng $APP_PORT đang bị tiến trình khác sử dụng." >&2
  ss -ltnp "sport = :$APP_PORT" >&2 || true
  exit 1
fi

rm -rf "$DEPLOY_PATH/dist.previous" "$DEPLOY_PATH/node_modules.previous"
[ -d "$DEPLOY_PATH/dist" ] && mv "$DEPLOY_PATH/dist" "$DEPLOY_PATH/dist.previous"
[ -d "$DEPLOY_PATH/node_modules" ] && mv "$DEPLOY_PATH/node_modules" "$DEPLOY_PATH/node_modules.previous"

mv "$STAGING_PATH/dist" "$DEPLOY_PATH/dist"
mv "$STAGING_PATH/node_modules" "$DEPLOY_PATH/node_modules"
cp -a "$STAGING_PATH/package.json" "$DEPLOY_PATH/package.json"
[ -f "$STAGING_PATH/package-lock.json" ] && cp -a "$STAGING_PATH/package-lock.json" "$DEPLOY_PATH/package-lock.json"
[ -f "$STAGING_PATH/.env" ] && cp -a "$STAGING_PATH/.env" "$DEPLOY_PATH/.env"
[ -f "$STAGING_PATH/firebase-applet-config.json" ] && cp -a "$STAGING_PATH/firebase-applet-config.json" "$DEPLOY_PATH/firebase-applet-config.json"
rm -rf "$STAGING_PATH"

: > "$DEPLOY_PATH/server.log"
: > "$DEPLOY_PATH/server-error.log"
cd "$DEPLOY_PATH"
PORT="$APP_PORT" NODE_ENV=production pm2 start dist/server.cjs \
  --name "$APP_NAME" \
  --cwd "$DEPLOY_PATH" \
  --output "$DEPLOY_PATH/server.log" \
  --error "$DEPLOY_PATH/server-error.log" \
  --time

HEALTHY=0
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$APP_PORT/api/health"; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if [ "$HEALTHY" -ne 1 ]; then
  echo "Ứng dụng không vượt qua health check." >&2
  tail -n 80 "$DEPLOY_PATH/server.log" >&2 || true
  tail -n 80 "$DEPLOY_PATH/server-error.log" >&2 || true
  exit 1
fi

pm2 save
rm -rf "$DEPLOY_PATH/dist.previous" "$DEPLOY_PATH/node_modules.previous"
echo "Dịch vụ nội bộ hoạt động tại 127.0.0.1:$APP_PORT"
`;
}

async function verifyPublicDomain() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL('/api/health', `${publicUrl}/`), {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.status !== 'ok') throw new Error('Phản hồi health check không hợp lệ.');
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  let connection;
  try {
    validateConfig();

    console.log('\n[1/6] Build dự án...');
    execSync('npm run build', { stdio: 'inherit' });

    console.log('\n[2/6] Đóng gói bản triển khai...');
    await createArchive();

    console.log('\n[3/6] Kết nối VPS...');
    connection = await connect();

    console.log('\n[4/6] Tải bản triển khai lên VPS...');
    const sftp = await getSftp(connection);
    const id = Date.now();
    const remoteArchive = `/tmp/ft-social-${id}.tar.gz`;
    const stagingPath = `${deployPath}/.deploy-staging-${id}`;
    await upload(sftp, archivePath, remoteArchive);

    console.log('\n[5/6] Cài đặt và kiểm tra dịch vụ nội bộ...');
    await runRemote(connection, `bash -lc ${shellQuote(deploymentCommands(remoteArchive, stagingPath))}`);

    console.log('\n[6/6] Kiểm tra tên miền...');
    await verifyPublicDomain();

    console.log('\n==================================================');
    console.log('TRIỂN KHAI THÀNH CÔNG');
    console.log(`Website: ${publicUrl}`);
    console.log(`Dịch vụ nội bộ: 127.0.0.1:${appPort}`);
    console.log('==================================================');
  } catch (error) {
    console.error('\n[Lỗi triển khai]', error.message);
    process.exitCode = 1;
  } finally {
    if (connection) connection.end();
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  }
}

main();
