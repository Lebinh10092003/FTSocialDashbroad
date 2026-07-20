const { Client } = require('c:/Users/Admin/Videos/Tool/FTSocialDashbroad/node_modules/ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connection ready for deployment...');
  const cmd = 'cd /var/www/ft-social-dashboard && git reset --hard && git pull && npm install && npm run build && pm2 restart all';
  console.log(`Running on VPS: ${cmd}`);
  
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error('Execution error:', err);
      process.exit(1);
    }
    stream.on('close', (code, signal) => {
      console.log(`\nDeployment finished with exit code ${code}`);
      conn.end();
      process.exit(code);
    }).on('data', (data) => {
      process.stdout.write(data.toString());
    }).stderr.on('data', (data) => {
      process.stderr.write(data.toString());
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
