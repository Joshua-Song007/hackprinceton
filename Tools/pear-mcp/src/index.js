#!/usr/bin/env node
// Pear MCP server (stdio): the closed API boundary for agents that build Pear games (Contract C3).
// Tools only reach the Pear HTTP/WebSocket API and the headless runner; there are no shell, filesystem or source tools.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { KIT_REFERENCE } from './kit.js';
import { registerDevTools } from './devtools.js';
import { api, authToken, buildVersion, cloudUrl, versionFiles } from './pear.js';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'Web');
const id = z.string().uuid().describe('game id (uuid)');

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
// Errors come back as tool results (isError) so the agent can read and fix them.
const tool = (fn) => async (args) => {
  try { return text(await fn(args)); } catch (e) { return { isError: true, content: [{ type: 'text', text: String(e?.message ?? e) }] }; }
};

/** Runs the headless runner (cwd Web/) on a temp scenario file; resolves with its report JSON. */
function runScenario(scenario, token) {
  const dir = mkdtempSync(join(tmpdir(), 'pear-scenario-'));
  const file = join(dir, 'scenario.json');
  writeFileSync(file, JSON.stringify(scenario));
  return new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite-node', 'packages/pear-sim/bin/pear-sim-run.ts', file, '--cloud', cloudUrl()], { cwd: WEB_DIR, shell: process.platform === 'win32', env: { ...process.env, PEAR_TOKEN: token } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill(), (Number(scenario.durationMs) || 60000) + 60000);
    p.on('error', reject);
    p.on('close', (code) => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`runner exited ${code} without a report (is Web/ installed? run npm install there): ${(err || out).slice(-600)}`)); }
    });
  });
}

/** Collects /debug frames for ms milliseconds. */
async function readLogs(gameId, lobby, ms) {
  const url = `${cloudUrl().replace(/^http/, 'ws')}/debug/${gameId}?token=${await authToken()}${lobby ? `&lobby=${encodeURIComponent(lobby)}` : ''}`;
  return new Promise((resolve, reject) => {
    const frames = [];
    const ws = new WebSocket(url);
    const done = () => { try { ws.close(); } catch { /* already closed */ } resolve(frames); };
    ws.onmessage = (m) => { try { frames.push(JSON.parse(String(m.data))); } catch { /* skip non-JSON */ } };
    ws.onopen = () => setTimeout(done, ms);
    ws.onerror = () => reject(new Error('debug socket failed (401/403: only the game owner or a developer can read logs)'));
  });
}

const server = new McpServer({ name: 'pear', version: '0.1.0' });

server.tool('kit_reference', 'Compact reference: file layout, script API, PearUI v1, scenario format. Read first.', {}, tool(async () => KIT_REFERENCE));

server.tool('list_games', 'List the games this account can see.', {}, tool(() => api('GET', '/api/games')));

server.tool('get_game', 'Latest (or given) version of a game as a files map.', { id, version: z.number().int().positive().optional() }, tool(async ({ id, version }) => {
  const v = await api('GET', `/api/games/${id}/versions/${version ?? 'latest'}`);
  return { version: v.version, run_mode: v.run_mode, files: await versionFiles(v) };
}));

server.tool('create_game', 'Create an empty game.', { title: z.string().min(1).max(256) }, tool(({ title }) => api('POST', '/api/games', { title })));

server.tool('save_version', 'Save files as a new version (becomes the latest; live lobbies reload). Script files go in scripts/, scene.json and metadata.json are special, everything else (ui.json, scenario.json) is uploaded as an asset.', {
  id,
  files: z.record(z.string()).describe('path -> content, see kit_reference'),
  run_mode: z.enum(['screen', 'device']).optional().describe('default screen'),
}, tool(async ({ id, files, run_mode }) => {
  const v = await api('POST', `/api/games/${id}/versions`, await buildVersion(id, files, run_mode));
  return { version: v.version, assets: Object.keys(v.assets) };
}));

server.tool('publish', 'Publish: list the game (listed:true) so phones see it, re-saving an earlier saved version as the new latest. Optional description, tags, releaseNotes.', {
  id, version: z.number().int().positive(),
  description: z.string().optional(), tags: z.array(z.string()).optional(), releaseNotes: z.string().optional(),
}, tool(async ({ id, version, description, tags, releaseNotes }) => {
  const v = await api('GET', `/api/games/${id}/versions/${version}`);
  const { scene, client_scripts, server_scripts, assets, metadata, run_mode } = v;
  const n = await api('POST', `/api/games/${id}/versions`, { scene, client_scripts, server_scripts, assets, metadata, run_mode, listed: true, description, tags, release_notes: releaseNotes });
  return { published: version, version: n.version };
}));

server.tool('read_logs', 'Read the live /debug stream (snapshot with recent logs, then events) for N ms. Owner or developer only.', {
  id, lobby: z.string().optional(), ms: z.number().int().min(100).max(60000).default(3000),
}, tool(({ id, lobby, ms }) => readLogs(id, lobby, ms)));

server.tool('run_scenario', 'Run a headless multi-device scenario against a saved game; returns the report ({ok, expect, frames, logs, final}).', {
  scenario: z.record(z.any()).describe('scenario JSON, see kit_reference'),
}, tool(async ({ scenario }) => runScenario(scenario, await authToken())));

registerDevTools(server, tool);

await server.connect(new StdioServerTransport());
