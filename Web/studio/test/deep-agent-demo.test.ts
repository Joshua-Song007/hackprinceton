// Judge demo, headless: a Deep Agent writes scripts/cube.client.js and scripts/tags.server.js into a Blank project
// (the same addScript + setScript calls deep-agent.ts makes on file_written); Run local with the sim head aimed at Cube
// must pulse the cube (haptic tick) and send the tagged remote event.
// shortcut: the server script is only loaded in the sandbox, not run. Local run has no server runtime and the sandbox
// calls handlers as (self, ctx, ...args), not serverScript's (ctx, player, ...args). Server behaviour is covered by the runtime pytest.
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { ScriptSandbox, type WorkerLike } from '@pear/script';
import { Project, templateSnapshot } from '../src/project';
import { LocalRun, type EffectOutput } from '../src/run';

class NodeWorkerLike implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  private worker = new Worker(new URL('../../packages/pear-script/test/node-worker.ts', import.meta.url), { execArgv: ['--experimental-strip-types'] }); // Node < 22.18 does not strip TS types by default
  constructor() {
    this.worker.on('message', (data) => this.onmessage?.({ data }));
    this.worker.on('error', (e) => this.onerror?.({ message: e.message }));
  }
  postMessage(m: unknown) {
    this.worker.postMessage(m);
  }
  terminate() {
    void this.worker.terminate();
  }
}

// The scripts a Deep Agent is expected to write for this demo (expected output shape; no agent runs in this test).
const CUBE_CLIENT_SCRIPT = `export default (function () {
  // Cube pulse (client script): looking at the cube pulses it and tags the look for the server.
  // [provisional] self.scale, self.name and ctx.haptic follow the Flagship scripts; prelude.js does not define self/ctx shapes.
  return script({
    onLookAt(self, ctx) {
      self.scale = 1.25;
      ctx.haptic("tick", 0.4);
      ctx.remote.fire("tag", { entity: self.name, tag: "looked" });
    },

    // The server confirmed the tag: end the pulse.
    onRemote(self, ctx, name, data) {
      if (name === "tagCount" && data.entity === self.name) self.scale = 1;
    },
  });
})();
`;

const TAGS_SERVER_SCRIPT = `export default (function () {
  // Tag counter (server script): counts each tag per player and confirms to everyone.
  function init(ctx) {
    if (!ctx.state.tags) ctx.state.tags = {};
  }

  return serverScript({
    onPlayerJoin(ctx, player) {
      init(ctx);
      ctx.state.tags[player.id] = {};
    },

    onPlayerLeave(ctx, player) {
      init(ctx);
      delete ctx.state.tags[player.id];
    },

    onRemote(ctx, player, name, data) {
      init(ctx);
      if (name !== "tag") return;
      const mine = ctx.state.tags[player.id] || (ctx.state.tags[player.id] = {});
      mine[data.tag] = (mine[data.tag] || 0) + 1;
      ctx.remote.fireAll("tagCount", { entity: data.entity, player: player.id, tag: data.tag, count: mine[data.tag] });
    },
  });
})();
`;

/** What deep-agent.ts does for a file_written message. */
function writeScript(project: Project, kind: 'client' | 'server', name: string, content: string) {
  if (!Object.hasOwn(project.scripts(kind), name)) project.addScript(kind, name);
  project.setScript(kind, name, content);
}

describe('Deep Agent demo scripts in Run local on the Blank template', () => {
  let run: LocalRun | undefined;
  afterEach(() => run?.stop());

  function open() {
    const project = new Project(templateSnapshot('tapcounter'));
    writeScript(project, 'client', 'cube', CUBE_CLIENT_SCRIPT);
    writeScript(project, 'server', 'tags', TAGS_SERVER_SCRIPT);
    const outputs: { script: string; output: EffectOutput }[] = [];
    const loadErrors: string[] = [];
    let now = 1000;
    run = new LocalRun({
      scene: project.description(),
      clientScripts: project.clientScripts,
      sandbox: new ScriptSandbox({ createWorker: () => new NodeWorkerLike() }),
      now: () => now,
      onOutput: (output, script) => outputs.push({ script, output }),
      onLoadError: (script, message) => loadErrors.push(`${script}: ${message}`),
    });
    // 30 x 20 ms steps of sim head packets: past the 500 ms look dwell.
    const gaze = async (yaw: number, pitch: number) => {
      run!.devices.setHeadLook(yaw, pitch);
      for (let i = 0; i < 30; i++) {
        now += 20;
        run!.devices.start(); // the first tick is immediate; stopping at once keeps the test off real timers
        run!.devices.stop();
        await run!.step();
      }
    };
    return { run, outputs, loadErrors, gaze };
  }

  it('looking at Cube pulses it and sends the tagged remote event', async () => {
    const t = open();
    await t.run.load();
    expect(t.loadErrors).toEqual([]);
    await t.gaze(0, -Math.atan(0.4 / 3)); // head at playerOrigin (0, 1.6, 0), Cube at (0, 1.2, -3)
    expect(t.outputs).toEqual([
      { script: 'cube', output: { kind: 'haptic', pattern: 'tick', intensity: 0.4 } },
      { script: 'cube', output: { kind: 'remote', name: 'tag', data: { entity: 'Cube', tag: 'looked' } } },
    ]);
  });

  it('looking away from Cube does nothing', async () => {
    const t = open();
    await t.run.load();
    await t.gaze(Math.PI, 0);
    expect(t.outputs).toEqual([]);
  });

  it('the server confirmation reaches the cube without errors', async () => {
    const t = open();
    await t.run.load();
    await t.run.deliverRemote('tagCount', { entity: 'Cube', player: 'p1', tag: 'looked', count: 1 });
    expect(t.outputs).toEqual([]);
    expect(t.loadErrors).toEqual([]);
  });

  it('tags.server.js is stored as a server script and loads in the sandbox', async () => {
    const project = new Project(templateSnapshot('tapcounter'));
    writeScript(project, 'server', 'tags', TAGS_SERVER_SCRIPT);
    expect(Object.keys(project.serverScripts)).toContain('tags');
    expect(project.serverScripts['tags']).toMatch(/^export default /);
    const sandbox = new ScriptSandbox({ createWorker: () => new NodeWorkerLike() });
    try {
      await sandbox.loadScript('tags', project.serverScripts['tags']!);
    } finally {
      sandbox.dispose();
    }
  });
});
