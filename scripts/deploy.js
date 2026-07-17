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
const appPort = normalizePort(process.env.PORT || '5500');
const appName = process.env.PM2_APP_NAME || 'ft-social-dashboard';
const publicUrl = normalizePublicUrl(
  process.env.DEPLOY_PUBLIC_URL
    || process.env.APP_URL
    || 'https://workspace.fermat.vn',
);
const archivePath = path.join(process.cwd(), 'deploy.tar.gz');

function normalizePort(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PORT không hợp lệ: ${value}`);
  }
  return parsed;
}

function normalizePublicUrl(value) {
  const normalized = String(value || '').trim().replace(/\/$/, '');
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Giao thức không hợp lệ');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`DEPLOY_PUBLIC_URL/APP_URL không hợp lệ: ${value}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function validateConfiguration() {
  if (!host) {
    throw new Error('Chưa cấu hình DEPLOY_HOST trong file .env.');
  }

  if (!Number.isFinite(sshPort) || sshPort < 1 || sshPort > 65535) {
    throw new Error(`DEPLOY_PORT không hợp lệ: ${process.env.DEPLOY_PORT}`);
  }

  if (privateKeyPath && !fs.existsSync(privateKeyPath)) {
    throw new Error(`Không tìm thấy SSH Private Key: ${privateKeyPath}`);
  }
}

function createSshConfig() {
  const config = {
    host,
    port: sshPort,
    username,
    readyTimeout: 20_000,
    keepaliveInterval: 10_000,
  };

  if (privateKeyPath) config.privateKey = fs.readFileSync(privateKeyPath);
  if (password) config.password = password;
  return config;
}

function buildRuntimeEnvContent() {
  if (!fs.existsSync('.env')) return '';

  const excludedKeys = new Set([
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
      return !match || !excludedKeys.has(match[1]);
    })
    .join('\n')
    .replace(/\s*$/, '\n');
}

function createTarball(outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('tar', {
      gzip: true,
      gzipOptions: { level: 9 },
    });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', warning => {
      if (warning.code === 'ENOENT') console.warn('[Archive]', warning.message);
      else reject(warning);
    });
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

    const runtimeEnv = buildRuntimeEnvContent();
    if (runtimeEnv) archive.append(runtimeEnv, { name: '.env' });

    // Không đóng gói server/data và uploads từ máy local. Đây là dữ liệu bền vững trên VPS.
    archive.finalize();
  });
}

function connectSsh() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.once('ready', () => resolve(conn));
    conn.once('error', reject);
    conn.connect(createSshConfig());
  });
}

function getSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) reject(error);
      else resolve(sftp);
    });
  });
}

function uploadFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, {}, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function executeRemoteCommand(conn, command, options = {}) {
  const { allowFailure = false, printOutput = true } = options;

  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) return reject(error);

      let stdout = '';
      let stderr = '';

      stream.on('close', code => {
        if (code !== 0 && !allowFailure) {
          reject(new Error(`Lệnh VPS thất bại với mã ${code}.\n${stderr || stdout}`));
        } else {
          resolve({ stdout, stderr, code });
        }
      });

      stream.on('data', data => {
        const text = data.toString();
        stdout += text;
        if (printOutput) process.stdout.write(text);
      });

      stream.stderr.on('data', data => {
        const text = data.toString();
        stderr += text;
        if (printOutput) process.stderr.write(text);
      });
    });
  });
}

function buildRemoteDeploymentScript(remoteArchivePath, stagingPath) {
  return `
set -Eeuo pipefail

DEPLOY_PATH=${shellQuote(deployPath)}
STAGING_PATH=${shellQuote(stagingPath)}
REMOTE_ARCHIVE=${shellQuote(remoteArchivePath)}
APP_PORT=${shellQuote(appPort)}
APP_NAME=${shellQuote(appName)}
LOG_FILE="$DEPLOY_PATH/server.log"
ERROR_LOG_FILE="$DEPLOY_PATH/server-error.log"
HAS_PM2=0

if command -v pm2 >/dev/null 2>&1; then
  HAS_PM2=1
fi

stop_app() {
  if [ "$HAS_PM2" -eq 1 ]; then
    pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  elif [ -f "$DEPLOY_PATH/app.pid" ]; then
    kill "$(cat "$DEPLOY_PATH/app.pid")" >/dev/null 2>&1 || true
    rm -f "$DEPLOY_PATH/app.pid"
  fi

  pkill -f "$DEPLOY_PATH/dist/server.cjs" >/dev/null 2>&1 || true
  sleep 1
}

start_app() {
  : > "$LOG_FILE"
  : > "$ERROR_LOG_FILE"

  if [ "$HAS_PM2" -eq 1 ]; then
    cd "$DEPLOY_PATH"
    PORT="$APP_PORT" NODE_ENV=production pm2 start dist/server.cjs \
      --name "$APP_NAME" \
      --cwd "$DEPLOY_PATH" \
      --output "$LOG_FILE" \
      --error "$ERROR_LOG_FILE" \
      --time
  else
    cd "$DEPLOY_PATH"
    nohup env PORT="$APP_PORT" NODE_ENV=production node dist/server.cjs \
      > "$LOG_FILE" 2> "$ERROR_LOG_FILE" &
    echo $! > "$DEPLOY_PATH/app.pid"
  fi
}

restore_previous_release() {
  echo "[Rollback] Đang khôi phục phiên bản trước..." >&2
  stop_app

  rm -rf "$DEPLOY_PATH/dist" "$DEPLOY_PATH/node_modules"
  [ -d "$DEPLOY_PATH/dist.previous" ] && mv "$DEPLOY_PATH/dist.previous" "$DEPLOY_PATH/dist"
  [ -d "$DEPLOY_PATH/node_modules.previous" ] && mv "$DEPLOY_PATH/node_modules.previous" "$DEPLOY_PATH/node_modules"

  for name in package.json package-lock.json .env firebase-applet-config.json; do
    rm -f "$DEPLOY_PATH/$name"
    if [ -f "$DEPLOY_PATH/$name.previous" ]; then
      mv "$DEPLOY_PATH/$name.previous" "$DEPLOY_PATH/$name"
    fi
  done

  if [ -f "$DEPLOY_PATH/dist/server.cjs" ]; then
    start_app || true
    [ "$HAS_PM2" -eq 1 ] && pm2 save >/dev/null 2>&1 || true
  fi
}

rm -rf "$STAGING_PATH"
mkdir -p "$STAGING_PATH" "$DEPLOY_PATH/uploads" "$DEPLOY_PATH/server/data"
tar -xzf "$REMOTE_ARCHIVE" -C "$STAGING_PATH"
rm -f "$REMOTE_ARCHIVE"

if [ ! -f "$STAGING_PATH/dist/server.cjs" ]; then
  echo "Không tìm thấy dist/server.cjs trong gói triển khai." >&2
  exit 1
fi

cd "$STAGING_PATH"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

stop_app

if ss -ltn "sport = :$APP_PORT" | grep -q LISTEN; then
  echo "Cổng $APP_PORT vẫn đang bị một tiến trình khác sử dụng. Không tự động kill tiến trình không xác định." >&2
  ss -ltnp "sport = :$APP_PORT" >&2 || true
  exit 1
fi

rm -rf "$DEPLOY_PATH/dist.previous" "$DEPLOY_PATH/node_modules.previous"
[ -d "$DEPLOY_PATH/dist" ] && mv "$DEPLOY_PATH/dist" "$DEPLOY_PATH/dist.previous"
[ -d "$DEPLOY_PATH/node_modules" ] && mv "$DEPLOY_PATH/node_modules" "$DEPLOY_PATH/node_modules.previous"

for name in package.json package-lock.json .env firebase-applet-config.json; do
  rm -f "$DEPLOY_PATH/$name.previous"
  [ -f "$DEPLOY_PATH/$name" ] && cp -a "$DEPLOY_PATH/$name" "$DEPLOY_PATH/$name.previous"
done

mv "$STAGING_PATH/dist" "$DEPLOY_PATH/dist"
mv "$STAGING_PATH/node_modules" "$DEPLOY_PATH/node_modules"
cp -a "$STAGING_PATH/package.json" "$DEPLOY_PATH/package.json"
[ -f "$STAGING_PATH/package-lock.json" ] && cp -a "$STAGING_PATH/package-lock.json" "$DEPLOY_PATH/package-lock.json"
[ -f "$STAGING_PATH/.env" ] && cp -a "$STAGING_PATH/.env" "$DEPLOY_PATH/.env"
[ -f "$STAGING_PATH/firebase-applet-config.json" ] && cp -a "$STAGING_PATH/firebase-applet-config.json" "$DEPLOY_PATH/firebase-applet-config.json"
rm -rf "$STAGING_PATH"

start_app

HEALTH_OK=0
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$APP_PORT/api/health" > /tmp/ft-social-health.json; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "Ứng dụng không vượt qua kiểm tra sức khỏe sau 20 giây." >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  tail -n 80 "$ERROR_LOG_FILE" >&2 || true
  restore_previous_release
  exit 1
fi

cat /tmp/ft-social-health.json
rm -f /tmp/ft-social-health.json

rm -rf "$DEPLOY_PATH/dist.previous" "$DEPLOY_PATH/node_modules.previous"
rm -f "$DEPLOY_PATH/package.json.previous" \
  "$DEPLOY_PATH/package-lock.json.previous" \
  "$DEPLOY_PATH/.env.previous" \
  "$DEPLOY_PATH/firebase-applet-config.json.previous"

if [ "$HAS_PM2" -eq 1 ]; then
  pm2 save
fi

echo "Triển khai nội bộ thành công tại 127.0.0.1:$APP_PORT"
`;
}

async function checkPublicHealth() {
  const healthUrl = new URL('/api/health', `${publicUrl}/`).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(healthUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.status !== 'ok') {
      throw new Error('Nội dung health check không hợp lệ');
    }

    return true;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  let conn;

  try {
    validateConfiguration();

    console.log('\n\x1b[36m[1/6] Đang build dự án ở máy local...\x1b[0m');
    execSync('npm run build', { stdio: 'inherit' });
    console.log('\x1b[32m-> Build dự án thành công.\x1b[0m');

    console.log('\n\x1b[36m[2/6] Đang tạo gói triển khai an toàn...\x1b[0m');
    await createTarball(archivePath);
    console.log(`\x1b[32m-> Đã tạo ${archivePath}.\x1b[0m`);

    console.log('\n\x1b[36m[3/6] Đang kết nối VPS...\x1b[0m');
    conn = await connectSsh();
    console.log('\x1b[32m-> Kết nối SSH thành công.\x1b[0m');

    console.log('\n\x1b[36m[4/6] Đang tải gói triển khai lên VPS...\x1b[0m');
    const sftp = await getSftp(conn);
    const deploymentId = Date.now();
    const remoteArchivePath = `/tmp/ft-social-${deploymentId}.tar.gz`;
    const stagingPath = `${deployPath}/.deploy-staging-${deploymentId}`;
    await uploadFile(sftp, archivePath, remoteArchivePath);
    console.log(`\x1b[32m-> Đã tải lên ${remoteArchivePath}.\x1b[0m`);

    console.log('\n\x1b[36m[5/6] Đang cài đặt, khởi động và kiểm tra sức khỏe...\x1b[0m');
    const remoteScript = buildRemoteDeploymentScript(remoteArchivePath, stagingPath);
    await executeRemoteCommand(conn, `bash -lc ${shellQuote(remoteScript)}`);

    console.log('\n\x1b[36m[6/6] Đang kiểm tra tên miền công khai...\x1b[0m');
    try {
      await checkPublicHealth();
      console.log(`\x1b[32m-> Tên miền hoạt động tốt: ${publicUrl}\x1b[0m`);
    } catch (error) {
      console.warn(`\x1b[33m[Cảnh báo] Ứng dụng nội bộ đã chạy nhưng health check tên miền chưa thành công: ${error.message}\x1b[0m`);
      console.warn('\x1b[33mHãy kiểm tra Nginx, DNS hoặc chứng chỉ HTTPS.\x1b[0m');
    }

    console.log('\n\x1b[32m==================================================\x1b[0m');
    console.log('\x1b[32mTRIỂN KHAI THÀNH CÔNG\x1b[0m');
    console.log(`\x1b[32mWebsite: \x1b[1m${publicUrl}\x1b[0m`);
    console.log(`\x1b[36mDịch vụ nội bộ: 127.0.0.1:${appPort} (Nginx chuyển tiếp tới cổng này)\x1b[0m`);
    console.log('\x1b[32m==================================================\x1b[0m');
  } catch (error) {
    console.error('\n\x1b[31m[Lỗi triển khai]\x1b[0m', error.message);
    process.exitCode = 1;
  } finally {
    if (conn) conn.end();
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  }
}

main();
