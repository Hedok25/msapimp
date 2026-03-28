/**
 * Тест для logout endpoint
 */

import http from 'http';

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbi1jbGllbnQiLCJpc3MiOiJtcC1wcm94eS1zZXJ2aWNlIiwiYXVkIjoibXAtcHJveHktc2VydmljZSIsImlhdCI6MTc3NDY4MTY2NSwiZXhwIjoxNzkwMjMzNjY1LCJqdGkiOiI5NzFiM2FmMS04ODVkLTQxYmItYTlhZi0xYzU2OGZhZjQ0OWIiLCJzY29wZSI6WyJwcm94eTpyZWFkIiwicHJveHk6d3JpdGUiXSwicmF0ZV90aWVyIjoiZW50ZXJwcmlzZSIsInJvbGUiOiJhZG1pbiJ9.WY-4Z4RD3TECSYTZFRYS9_cPpwOO9LY1OhqhrjdNNbs";

const data = JSON.stringify({ access_token: TOKEN });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/auth/logout',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'msapimp-key-api': `Bearer ${TOKEN}`
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Response: ${body}`);
  });
});

req.on('error', (e) => {
  console.error(`Error: ${e.message}`);
});

req.write(data);
req.end();
