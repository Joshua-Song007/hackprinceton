// Local device relay: phones running the Pear companion find this machine over Bonjour (_pear._tcp), stream newline-delimited
// JSON (the PearBridge wire protocol: hello, ping/pong, output, raw USIS packets), and Studio reads them over a WebSocket.
// Both servers stay on this machine's network (Network Rule): the WebSocket binds 127.0.0.1 and nothing is forwarded anywhere else.
// Run: npm run relay (from Web/studio). Env: PEAR_RELAY_PORT (TCP, default 7777), PEAR_RELAY_WS_PORT (default 8787).
import net from 'node:net';
import { WebSocketServer } from 'ws';
import { Bonjour } from 'bonjour-service';

const TCP_PORT = Number(process.env.PEAR_RELAY_PORT ?? 7777);
const WS_PORT = Number(process.env.PEAR_RELAY_WS_PORT ?? 8787);
const MAX_LINE = 1 << 20;

/** deviceId -> { socket, name, kind } for every device that has said hello. */
const devices = new Map();
// Only Studio pages (localhost dev server or the Tauri shell) may read sensor data.
const allowedOrigin = (o) => !o || /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/.test(o);
const wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT, verifyClient: ({ origin }) => allowedOrigin(origin) });

const sendAll = (msg) => { const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };
const announce = () => sendAll({ type: 'devices', devices: [...devices].map(([id, d]) => ({ id, name: d.name, kind: d.kind })) });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'devices', devices: [...devices].map(([id, d]) => ({ id, name: d.name, kind: d.kind })) }));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m?.type === 'output' && m.command && typeof m.deviceId === 'string') {
      devices.get(m.deviceId)?.socket.write(JSON.stringify({ msg: 'output', command: m.command }) + '\n');
    }
  });
});

const server = net.createServer((socket) => {
  socket.setNoDelay(true);
  let buf = '';
  let id = null;
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    if (buf.length > MAX_LINE && !buf.includes('\n')) return socket.destroy();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) handle(line);
    }
  });
  const handle = (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.msg === 'hello' && typeof m.deviceId === 'string') {
      if (id) devices.delete(id);
      id = m.deviceId;
      const old = devices.get(id)?.socket;
      if (old && old !== socket) old.destroy(); // same device reconnecting: the old link is stale
      devices.set(id, { socket, name: String(m.name ?? id), kind: String(m.kind ?? 'custom') });
      console.log(`device ${id} (${m.kind}) connected`);
      announce();
    } else if (m.msg === 'ping') {
      socket.write(JSON.stringify({ msg: 'pong', id: m.id, deviceT: Date.now() }) + '\n');
    } else if (m.msg === undefined && m.v !== undefined && id) {
      sendAll({ type: 'packet', deviceId: id, packet: m });
    }
  };
  const gone = () => { if (id && devices.get(id)?.socket === socket) { devices.delete(id); console.log(`device ${id} left`); announce(); } };
  socket.on('close', gone);
  socket.on('error', () => socket.destroy());
});

server.listen(TCP_PORT, () => {
  const bonjour = new Bonjour();
  bonjour.publish({ name: 'Pear relay', type: 'pear', port: TCP_PORT });
  console.log(`relay: devices on tcp ${TCP_PORT} (Bonjour _pear._tcp), Studio on ws://127.0.0.1:${WS_PORT}`);
  process.on('SIGINT', () => bonjour.unpublishAll(() => process.exit(0)));
});
