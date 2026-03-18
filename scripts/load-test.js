#!/usr/bin/env node
/**
 * Simulated load test for the Global Payment Orchestrator.
 *
 * Usage:
 *   node scripts/load-test.js [--url http://localhost:3000] [--rps 100] [--duration 30]
 *
 * Requires the server to be running with PostgreSQL and Redis.
 */

'use strict';

const http = require('http');
const { randomUUID } = require('crypto');

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : def;
};

const BASE_URL = getArg('--url', 'http://localhost:3000');
const TARGET_RPS = parseInt(getArg('--rps', '50'), 10);
const DURATION_SEC = parseInt(getArg('--duration', '30'), 10);

const CURRENCY_REGION = [
  ['USD', 'us-east'],
  ['USD', 'eu-west'],
  ['EUR', 'eu-central'],
  ['GBP', 'eu-west'],
  ['BTC', 'ap-southeast'],
  ['ETH', 'us-east'],
];

let totalRequests = 0;
let totalSucceeded = 0;
let totalFailed = 0;
let totalLatency = 0;

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-request-id': randomUUID(),
      },
    };

    const start = Date.now();
    const req = http.request(options, (res) => {
      const latency = Date.now() - start;
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, latency, body: data }));
    });

    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function randomPair() {
  return CURRENCY_REGION[Math.floor(Math.random() * CURRENCY_REGION.length)];
}

async function sendPayment() {
  const [currency, region] = randomPair();
  const body = {
    idempotencyKey: `load-${randomUUID()}`,
    merchantId: 'merchant_load_test',
    customerId: `cust_${Math.floor(Math.random() * 1000)}`,
    amount: Math.floor(Math.random() * 10000) + 100,
    currency,
    region,
    metadata: { source: 'load-test' },
  };

  try {
    const { status, latency } = await post('/payments', body);
    totalRequests++;
    totalLatency += latency;
    if (status === 201 || status === 200) {
      totalSucceeded++;
    } else {
      totalFailed++;
    }
  } catch {
    totalRequests++;
    totalFailed++;
  }
}

async function run() {
  console.log(`Load test: ${TARGET_RPS} RPS for ${DURATION_SEC}s → ${BASE_URL}`);
  console.log('');

  const intervalMs = 1000 / TARGET_RPS;
  const endTime = Date.now() + DURATION_SEC * 1000;

  const ticker = setInterval(() => {
    if (Date.now() >= endTime) {
      clearInterval(ticker);
      return;
    }
    void sendPayment();
  }, intervalMs);

  await new Promise((r) => setTimeout(r, (DURATION_SEC + 2) * 1000));

  const avgLatency = totalRequests > 0 ? (totalLatency / totalRequests).toFixed(1) : 0;
  const successRate = totalRequests > 0 ? ((totalSucceeded / totalRequests) * 100).toFixed(1) : 0;
  const actualRps = (totalRequests / DURATION_SEC).toFixed(1);

  console.log('=== Load Test Results ===');
  console.log(`Total requests:  ${totalRequests}`);
  console.log(`Succeeded:       ${totalSucceeded} (${successRate}%)`);
  console.log(`Failed:          ${totalFailed}`);
  console.log(`Avg latency:     ${avgLatency}ms`);
  console.log(`Actual RPS:      ${actualRps}`);
}

run().catch(console.error);
