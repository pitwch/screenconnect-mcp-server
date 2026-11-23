#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'dist', 'index.js');

const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: {
    ...process.env,
    SCREENCONNECT_BASE_URL: process.env.SCREENCONNECT_BASE_URL ?? 'https://example.invalid',
    SCREENCONNECT_API_SECRET: process.env.SCREENCONNECT_API_SECRET ?? 'test-secret-not-real',
    SCREENCONNECT_MODE: process.env.SCREENCONNECT_MODE ?? 'read',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const rl = createInterface({ input: child.stdout });
const stderrChunks = [];
child.stderr.on('data', (c) => stderrChunks.push(c));

function send(msg) {
  child.stdin.write(`${JSON.stringify(msg)}\n`);
}

const responses = new Map();
let nextWait = null;

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id != null) {
    responses.set(msg.id, msg);
    if (nextWait && nextWait.id === msg.id) {
      nextWait.resolve(msg);
      nextWait = null;
    }
  }
});

function waitFor(id, timeoutMs = 5000) {
  if (responses.has(id)) return Promise.resolve(responses.get(id));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for id=${id}`)), timeoutMs);
    nextWait = {
      id,
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
    };
  });
}

async function main() {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0.0.0' },
    },
  });
  await waitFor(1);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const listed = await waitFor(2);
  const tools = listed?.result?.tools ?? [];
  const names = tools.map((t) => t.name);

  const required = ['health_check', 'list_sessions', 'search_sessions', 'get_session_details', 'get_session_events'];
  for (const name of required) {
    if (!names.includes(name)) {
      throw new Error(`missing read tool: ${name}; got ${names.join(', ')}`);
    }
  }
  for (const banned of ['add_session_note', 'send_command_to_session', 'create_session']) {
    if (names.includes(banned)) {
      throw new Error(`read mode must not expose ${banned}`);
    }
  }

  console.error(`smoke ok: ${names.length} tools in read mode`);
  child.kill('SIGTERM');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  console.error(Buffer.concat(stderrChunks).toString('utf8'));
  child.kill('SIGKILL');
  process.exit(1);
});
