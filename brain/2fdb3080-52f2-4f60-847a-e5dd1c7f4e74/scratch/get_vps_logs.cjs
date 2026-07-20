const { Client } = require('c:/Users/Admin/Videos/Tool/FTSocialDashbroad/node_modules/ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connection ready');
  conn.exec('pm2 logs ft-social-dashboard --lines 100 --raw', (err, stream) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    let output = '';
    
    const timer = setTimeout(() => {
      console.log('Timeout reached, saving log snapshot...');
      fs.writeFileSync(path.join(__dirname, 'vps_logs.txt'), output);
      conn.end();
      process.exit(0);
    }, 6500);

    stream.on('close', (code, signal) => {
      clearTimeout(timer);
      console.log('Stream closed');
      fs.writeFileSync(path.join(__dirname, 'vps_logs.txt'), output);
      conn.end();
      process.exit(0);
    }).on('data', (data) => {
      output += data.toString();
      if (output.split('\n').length >= 100) {
        clearTimeout(timer);
        fs.writeFileSync(path.join(__dirname, 'vps_logs.txt'), output);
        conn.end();
        process.exit(0);
      }
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
