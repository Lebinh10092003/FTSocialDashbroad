const { Client } = require('c:/Users/Admin/Videos/Tool/FTSocialDashbroad/node_modules/ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connection ready');
  // Đọc cấu hình Nginx
  conn.exec('cat /etc/nginx/sites-enabled/*', (err, stream) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    let output = '';
    stream.on('close', (code, signal) => {
      fs.writeFileSync(path.join(__dirname, 'nginx_config.txt'), output);
      conn.end();
      process.exit(0);
    }).on('data', (data) => {
      output += data.toString();
    }).stderr.on('data', (data) => {
      output += '[STDERR] ' + data.toString();
    });
  });
}).on('error', (err) => {
  console.error('Connection error:', err);
  process.exit(1);
}).connect({
  host: '103.142.27.69',
  port: 22,
  username: 'root',
  password: '02fztK--%#Np'
});
