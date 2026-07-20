const fs = require('fs');
const path = require('path');

async function run() {
  try {
    console.log('Calling GET /api/channels...');
    const res = await fetch('https://workspace.fermat.vn/api/channels', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer mock-dev-token-admin@ftsocial.com'
      }
    });
    console.log('GET /api/channels status:', res.status);
    const text = await res.text();
    fs.writeFileSync(path.join(__dirname, 'response_channels.txt'), text);

    console.log('Calling POST /api/channels/mock-channel-1/sync...');
    const syncRes = await fetch('https://workspace.fermat.vn/api/channels/mock-channel-1/sync', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-dev-token-admin@ftsocial.com',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    console.log('POST /api/channels/mock-channel-1/sync status:', syncRes.status);
    const syncText = await syncRes.text();
    fs.writeFileSync(path.join(__dirname, 'response_sync.txt'), syncText);
    
    console.log('Done. Responses saved to response_channels.txt and response_sync.txt');
  } catch (e) {
    console.error('Fetch error:', e);
  }
}
run();
