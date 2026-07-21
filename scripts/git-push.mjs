import { execSync } from 'child_process';
import process from 'process';

// Lấy thông điệp commit từ đối số dòng lệnh, mặc định là 'Auto update'
let commitMsg = process.argv.slice(2).join(' ') || 'Auto update';

try {
  console.log(`\n\x1b[36m[Git] Thêm tất cả thay đổi vào Staging...\x1b[0m`);
  execSync('git add .', { stdio: 'inherit' });
  
  console.log(`\x1b[36m[Git] Commit với thông điệp: "${commitMsg}"...\x1b[0m`);
  execSync(`git commit -m "${commitMsg}"`, { stdio: 'inherit' });
  
  console.log(`\x1b[36m[Git] Đẩy code lên GitHub...\x1b[0m`);
  execSync('git push', { stdio: 'inherit' });
  
  console.log(`\x1b[32m[Git] Đẩy code thành công!\x1b[0m\n`);
} catch (error) {
  console.error(`\x1b[31m[Git Lỗi] Quá trình push thất bại:\x1b[0m`, error.message);
  process.exit(1);
}
