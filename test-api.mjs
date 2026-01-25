import https from 'https';

const options = {
  hostname: 'offering.begmedia.com',
  port: 443,
  path: '/web/offering.access.api/offering.access.api.MatchService/GetMatchesByCompetitionWithNotifications',
  method: 'POST',
  headers: {
    'Content-Type': 'application/grpc-web-text',
    'Accept': 'application/grpc-web-text',
    'X-Grpc-Web': '1',
    'X-Bg-Ref-Brand': 'BETCLIC',
    'X-Bg-Ref-Platform': 'DESKTOP',
    'X-Bg-Ref-Regulator-Zone': 'PL',
    'X-Bg-Regulation': 'PL',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Origin': 'https://www.betclic.pl',
    'Referer': 'https://www.betclic.pl/'
  }
};

const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Data length:', data.length, 'bytes'));
});

req.on('error', err => console.error('Error:', err.message));

// Simple protobuf request: field 1 (varint) = value 3
const body = Buffer.from('AAID', 'base64');
req.write(body);
req.end();
