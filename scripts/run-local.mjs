import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
process.chdir(rootDir);

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const venvDir = path.join(rootDir, '.venv');
const venvPython = isWindows
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');
const markerDir = path.join(venvDir, '.ft-markers');
const envPath = path.join(rootDir, '.env');

function commandExists(command, args = ['--version'], useShell = false) {
  const result = spawnSync(command, args, { stdio: 'ignore', shell: useShell });
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

function run(command, args, label, useShell = false) {
  console.log(`\n[FT] ${label}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: useShell,
  });
  if (result.status !== 0) {
    throw new Error(`${label} thất bại với mã ${result.status ?? 'không xác định'}.`);
  }
}

function fileHash(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function installWhenChanged({ sourceFile, markerName, requiredPath, command, args, label, useShell = false }) {
  mkdirSync(markerDir, { recursive: true });
  const markerPath = path.join(markerDir, markerName);
  const currentHash = fileHash(sourceFile);
  const previousHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';
  if (currentHash !== previousHash || (requiredPath && !existsSync(requiredPath))) {
    run(command, args, label, useShell);
    writeFileSync(markerPath, currentHash, 'utf8');
  } else {
    console.log(`[FT] Bỏ qua ${label.toLowerCase()}: dependency không thay đổi.`);
  }
}

function createLocalEnv() {
  if (existsSync(envPath)) return;

  const examplePath = path.join(rootDir, '.env.example');
  if (!existsSync(examplePath)) throw new Error('Không tìm thấy .env.example.');

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
  console.log('[FT] Hãy lưu lại mật khẩu này. Mật khẩu chỉ được hiển thị khi .env được tạo lần đầu.\n');
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

  installWhenChanged({
    sourceFile: path.join(rootDir, 'backend', 'requirements.txt'),
    markerName: 'requirements.sha256',
    requiredPath: venvPython,
    command: venvPython,
    args: ['-m', 'pip', 'install', '-r', 'backend/requirements.txt'],
    label: 'Cài dependency backend',
  });

  installWhenChanged({
    sourceFile: path.join(rootDir, 'package.json'),
    markerName: 'package.sha256',
    requiredPath: path.join(rootDir, 'node_modules'),
    command: npmCommand,
    args: ['install', '--no-audit', '--no-fund'],
    label: 'Cài dependency frontend',
    useShell: isWindows,
  });

  run(venvPython, ['backend/manage.py', 'migrate', '--noinput'], 'Cập nhật cơ sở dữ liệu');
  run(venvPython, ['backend/manage.py', 'shell', '-c', "from django.contrib.auth.models import User; User.objects.filter(username='admin@ftsocial.com').exists() or User.objects.create_superuser('admin@ftsocial.com', 'admin@ftsocial.com', 'Admin123')"], 'Khởi tạo tài khoản Admin mặc định (admin/Admin123)');
  run(venvPython, ['backend/manage.py', 'check'], 'Kiểm tra cấu hình Django');

  console.log('\n[FT] Backend:  http://127.0.0.1:8000');
  console.log('[FT] Frontend: http://127.0.0.1:5173');
  console.log('[FT] Nhấn Ctrl+C để dừng toàn bộ hệ thống.\n');

  const backend = spawn(venvPython, ['backend/manage.py', 'runserver', '127.0.0.1:8000'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  });
  const frontend = spawn(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWindows,
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
