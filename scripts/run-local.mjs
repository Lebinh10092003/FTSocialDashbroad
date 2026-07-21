import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(rootDir);

const isWindows = process.platform === 'win32';
const venvDir = path.join(rootDir, '.venv');
const venvPython = isWindows
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');
const markerDir = path.join(venvDir, '.ft-markers');
const envPath = path.join(rootDir, '.env');

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore', shell: false });
  return result.status === 0;
}

function detectPython() {
  if (isWindows && commandExists('py', ['-3', '--version'])) {
    return { command: 'py', prefix: ['-3'] };
  }
  for (const command of ['python3', 'python']) {
    if (commandExists(command)) return { command, prefix: [] };
  }
  throw new Error('Không tìm thấy Python 3. Hãy cài Python 3.12 trở lên và chạy lại.');
}

function run(command, args, label) {
  console.log(`\n[FT] ${label}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${label} thất bại với mã ${result.status ?? 'không xác định'}.`);
  }
}

function fileHash(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function installWhenChanged(sourceFile, markerName, command, args, label) {
  mkdirSync(markerDir, { recursive: true });
  const markerPath = path.join(markerDir, markerName);
  const currentHash = fileHash(sourceFile);
  const previousHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';
  if (currentHash !== previousHash) {
    run(command, args, label);
    writeFileSync(markerPath, currentHash, 'utf8');
  } else {
    console.log(`[FT] Bỏ qua ${label.toLowerCase()}: dependency không thay đổi.`);
  }
}

function createLocalEnv() {
  if (existsSync(envPath)) return;

  const examplePath = path.join(rootDir, '.env.example');
  if (!existsSync(examplePath)) {
    throw new Error('Không tìm thấy .env.example.');
  }

  const secretKey = randomBytes(48).toString('hex');
  const initialPassword = `FT-${randomBytes(9).toString('base64url')}!`;
  let content = readFileSync(examplePath, 'utf8');
  content = content
    .replace('replace-with-a-long-random-secret', secretKey)
    .replace('replace-with-a-strong-initial-password', initialPassword)
    .replace('replace-with-a-long-random-value', randomBytes(32).toString('hex'));
  writeFileSync(envPath, content, 'utf8');

  console.log('\n[FT] Đã tạo .env cho môi trường local.');
  console.log('[FT] Tài khoản quản trị khởi tạo: admin@ftsocial.com');
  console.log(`[FT] Mật khẩu quản trị khởi tạo: ${initialPassword}`);
  console.log('[FT] Hãy lưu lại mật khẩu này. Nó chỉ được hiển thị trong lần tạo .env đầu tiên.\n');
}

function stopChild(child) {
  if (!child || child.killed) return;
  if (isWindows && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function main() {
  createLocalEnv();

  const python = detectPython();
  if (!existsSync(venvPython)) {
    run(python.command, [...python.prefix, '-m', 'venv', '.venv'], 'Tạo môi trường Python .venv');
  }

  installWhenChanged(
    path.join(rootDir, 'backend', 'requirements.txt'),
    'requirements.sha256',
    venvPython,
    ['-m', 'pip', 'install', '-r', 'backend/requirements.txt'],
    'Cài dependency backend',
  );

  installWhenChanged(
    path.join(rootDir, 'package.json'),
    'package.sha256',
    isWindows ? 'npm.cmd' : 'npm',
    ['install', '--no-audit', '--no-fund'],
    'Cài dependency frontend',
  );

  run(venvPython, ['backend/manage.py', 'migrate', '--noinput'], 'Cập nhật cơ sở dữ liệu');
  run(venvPython, ['backend/manage.py', 'check'], 'Kiểm tra cấu hình Django');

  console.log('\n[FT] Backend:  http://127.0.0.1:8000');
  console.log('[FT] Frontend: http://127.0.0.1:5173');
  console.log('[FT] Nhấn Ctrl+C để dừng toàn bộ hệ thống.\n');

  const backend = spawn(venvPython, ['backend/manage.py', 'runserver', '127.0.0.1:8000'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  });
  const frontend = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  });

  let shuttingDown = false;
  const shutdown = (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopChild(frontend);
    stopChild(backend);
    process.exit(exitCode);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  backend.on('exit', code => shutdown(code ?? 1));
  frontend.on('exit', code => shutdown(code ?? 1));
}

main().catch(error => {
  console.error(`\n[FT] ${error.message}`);
  process.exit(1);
});
