const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { URL } = require('node:url');
const { isAllowedPrivateHost } = require('./public/normalize');

const PORT = Number(process.env.PORT || 8787);
const MOCK_MODE = process.env.MOCK_AUTODARTS === '1' || process.argv.includes('--mock');
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');
const DISCOVERY_CONCURRENCY = 32;
const DISCOVERY_TIMEOUT_MS = 650;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

let mockIndex = 0;
const mockStates = [
  {
    connected: true,
    running: true,
    status: 'Throw',
    event: 'Waiting for throw',
    numThrows: 0
  },
  {
    connected: true,
    running: true,
    status: 'Throw',
    event: 'Throw detected',
    throws: [{ segment: { name: 'T20' }, coords: { x: 12.3, y: -4.2 } }]
  },
  {
    connected: true,
    running: true,
    status: 'Throw',
    event: 'Throw detected',
    throws: [
      { segment: { name: 'T20' }, coords: { x: 12.3, y: -4.2 } },
      { segment: { name: 'S5' }, coords: { x: -2.1, y: 10.8 } }
    ]
  },
  {
    connected: true,
    running: true,
    status: 'Throw',
    event: 'Throw detected',
    throws: [
      { segment: { name: 'T20' }, coords: { x: 12.3, y: -4.2 } },
      { segment: { name: 'S5' }, coords: { x: -2.1, y: 10.8 } },
      { segment: { name: 'D16' }, coords: { x: 6.4, y: 2.5 } }
    ]
  },
  {
    connected: true,
    running: true,
    status: 'Takeout in progress',
    event: 'Takeout started',
    numThrows: 0
  },
  {
    connected: true,
    running: true,
    status: 'Throw',
    event: 'Takeout finished',
    numThrows: 0
  }
];

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(payload);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(text);
}

function sanitizeProfile(profile) {
  return {
    host: String(profile.host || '').trim(),
    port: Number(profile.port || 3180),
    pollIntervalMs: Number(profile.pollIntervalMs || 1000)
  };
}

function publicProfile(profile) {
  return {
    host: profile.host || '',
    port: profile.port || 3180,
    pollIntervalMs: profile.pollIntervalMs || 1000
  };
}

function validateHostAndPort(host, port) {
  if (!isAllowedPrivateHost(host)) {
    return 'Host is not allowed. Use localhost or a private IPv4 address.';
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Port must be an integer between 1 and 65535.';
  }
  return null;
}

function isIpv4Interface(info) {
  return info && (info.family === 'IPv4' || info.family === 4) && !info.internal && isAllowedPrivateHost(info.address);
}

function getLocalPrivateIpv4Interfaces(networkInterfaces = os.networkInterfaces()) {
  const result = [];
  for (const [name, entries] of Object.entries(networkInterfaces)) {
    for (const entry of entries || []) {
      if (!isIpv4Interface(entry)) continue;
      const parts = entry.address.split('.').map(Number);
      result.push({
        name,
        address: entry.address,
        prefix: `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
      });
    }
  }
  return result;
}

function createSubnetCandidates(address) {
  if (!isAllowedPrivateHost(address)) return [];
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return [];
  const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
  return Array.from({ length: 254 }, (_, index) => `${base}.${index + 1}`);
}

function createDiscoveryTargets(networkInterfaces = os.networkInterfaces()) {
  const interfaces = getLocalPrivateIpv4Interfaces(networkInterfaces);
  const seen = new Set();
  const targets = [];
  for (const iface of interfaces) {
    for (const host of createSubnetCandidates(iface.address)) {
      if (seen.has(host)) continue;
      seen.add(host);
      targets.push(host);
    }
  }
  return { interfaces, targets };
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 64) {
      throw new Error('Request body too large.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readProfile() {
  try {
    const data = await fs.readFile(PROFILE_FILE, 'utf8');
    return sanitizeProfile(JSON.parse(data));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return sanitizeProfile({});
    }
    throw error;
  }
}

async function writeProfile(profile) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf8');
}

async function servePublic(res, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const ext = path.extname(filePath);
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendText(res, 404, 'Not found');
      return;
    }
    sendText(res, 500, 'Internal server error');
  }
}

async function fetchBoardJson(host, port, endpoint, timeoutMs = 1200) {
  const error = validateHostAndPort(host, port);
  if (error) {
    return { statusCode: 400, body: { error } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const target = `http://${host}:${port}${endpoint}`;

  try {
    const response = await fetch(target, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return {
      statusCode: response.ok ? 200 : response.status,
      body
    };
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Board Manager request timed out.' : 'Board Manager request failed.';
    return {
      statusCode: 502,
      body: {
        error: message,
        detail: error.name === 'AbortError' ? 'timeout' : error.message
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDiscoveryTarget(host, port, timeoutMs) {
  const result = await fetchBoardJson(host, port, '/api/state', timeoutMs);
  if (result.statusCode !== 200 || !result.body || result.body.connected !== true) {
    return null;
  }

  return {
    host,
    port,
    connected: result.body.connected === true,
    running: result.body.running === true,
    status: typeof result.body.status === 'string' ? result.body.status : '',
    event: typeof result.body.event === 'string' ? result.body.event : '',
    numThrows: Number.isFinite(Number(result.body.numThrows)) ? Number(result.body.numThrows) : null
  };
}

async function scanForBoards({ port, timeoutMs, networkInterfaces }) {
  const { interfaces, targets } = createDiscoveryTargets(networkInterfaces);
  const boards = [];
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const board = await checkDiscoveryTarget(targets[index], port, timeoutMs);
      if (board) boards.push(board);
    }
  }

  const workerCount = Math.min(DISCOVERY_CONCURRENCY, targets.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  boards.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
  return {
    interfaces,
    scanned: targets.length,
    boards
  };
}

function getHostPortFromQuery(url) {
  return {
    host: String(url.searchParams.get('host') || '').trim(),
    port: Number(url.searchParams.get('port') || 3180)
  };
}

async function handleState(req, res, url) {
  if (MOCK_MODE) {
    const state = mockStates[mockIndex % mockStates.length];
    mockIndex += 1;
    sendJson(res, 200, state);
    return;
  }

  const { host, port } = getHostPortFromQuery(url);
  const result = await fetchBoardJson(host, port, '/api/state');
  sendJson(res, result.statusCode, result.body);
}

async function handleConfig(req, res, url) {
  const { host, port } = getHostPortFromQuery(url);
  const result = await fetchBoardJson(host, port, '/api/config');
  sendJson(res, result.statusCode, result.body);
}

async function handleDiscover(req, res, url) {
  const port = Number(url.searchParams.get('port') || 3180);
  const timeoutMs = Math.max(250, Math.min(1500, Number(url.searchParams.get('timeoutMs') || DISCOVERY_TIMEOUT_MS)));
  const portError = validateHostAndPort('127.0.0.1', port);
  if (portError) {
    sendJson(res, 400, { error: portError });
    return;
  }

  if (MOCK_MODE) {
    sendJson(res, 200, {
      mode: 'mock',
      interfaces: [{ name: 'mock', address: '192.168.2.10', prefix: '192.168.2.0/24' }],
      scanned: 254,
      durationMs: 1,
      boards: [
        {
          host: '192.168.2.107',
          port,
          connected: true,
          running: true,
          status: 'Throw',
          event: 'Mock board discovered',
          numThrows: 0
        }
      ]
    });
    return;
  }

  const started = Date.now();
  const result = await scanForBoards({ port, timeoutMs });
  sendJson(res, 200, {
    mode: 'network',
    ...result,
    durationMs: Date.now() - started
  });
}

async function handleGetProfile(req, res) {
  const profile = await readProfile();
  sendJson(res, 200, publicProfile(profile));
}

async function handlePostProfile(req, res) {
  try {
    const body = await readRequestBody(req);
    const parsed = body ? JSON.parse(body) : {};
    const profile = sanitizeProfile(parsed);
    const error = validateHostAndPort(profile.host, profile.port);
    if (error) {
      sendJson(res, 400, { error });
      return;
    }
    if (!Number.isInteger(profile.pollIntervalMs) || profile.pollIntervalMs < 250 || profile.pollIntervalMs > 10000) {
      sendJson(res, 400, { error: 'Polling interval must be between 250 and 10000 ms.' });
      return;
    }

    await writeProfile(profile);
    sendJson(res, 200, publicProfile(profile));
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'Invalid profile payload.' });
  }
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      await handleState(req, res, url);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      await handleConfig(req, res, url);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/discover') {
      await handleDiscover(req, res, url);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/profile') {
      await handleGetProfile(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/profile') {
      await handlePostProfile(req, res);
      return;
    }
    if (req.method === 'GET') {
      await servePublic(res, url.pathname);
      return;
    }
    sendText(res, 405, 'Method not allowed');
  } catch (error) {
    sendJson(res, 500, { error: 'Internal server error.' });
  }
}

const server = http.createServer(router);

if (require.main === module) {
  server.listen(PORT, () => {
    const mode = MOCK_MODE ? 'mock' : 'proxy';
    console.log(`Autodarts overlay prototype listening on http://localhost:${PORT} (${mode} mode)`);
  });
}

module.exports = {
  server,
  validateHostAndPort,
  fetchBoardJson,
  getLocalPrivateIpv4Interfaces,
  createSubnetCandidates,
  createDiscoveryTargets,
  scanForBoards
};
