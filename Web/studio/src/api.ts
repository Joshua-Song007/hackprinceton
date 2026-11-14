// Script API table: the one source for editor autocomplete, hover, the Help sheet and docs/creators/scripting-api.md.
// Handler names must match CLIENT_HANDLERS / SERVER_HANDLERS in prelude.js (checked by test/api.test.ts).
export type ApiSide = 'client' | 'server';

export interface ApiParam {
  name: string;
  type: string;
}

/** Examples of handlers are method definitions (`onTick(self, ctx, dt) { ... }`); examples of members are statements. */
export interface ApiHandler {
  name: string;
  params: ApiParam[];
  description: string;
  example: string;
}

export interface ApiMember {
  /** Full dotted path, e.g. `ctx.remote.fire`. */
  path: string;
  signature: string;
  description: string;
  example: string;
}

const p = (name: string, type: string): ApiParam => ({ name, type });

export const API: Record<ApiSide, { handlers: ApiHandler[]; members: ApiMember[] }> = {
  client: {
    handlers: [
      { name: 'onLookAt', params: [p('self', 'Self'), p('ctx', 'Ctx')], description: 'The head ray has stayed on this entity for 0.5 s.', example: 'onLookAt(self, ctx) { self.audio.play("growl"); }' },
      { name: 'onGesture', params: [p('self', 'Self'), p('ctx', 'Ctx'), p('g', '{ type: "tap" | "doubleTap" | "flick" | "squeeze" | "pinch" | string, dir?: [number, number, number] }')], description: 'A gesture arrived from any device. type is a built-in gesture or the name of a scene motion gesture (scene.gestures). flick and motion gestures carry dir.', example: 'onGesture(self, ctx, g) { if (g.type === "flick") ctx.remote.fire("punch", { dir: g.dir }); }' },
      { name: 'onHeartRate', params: [p('self', 'Self'), p('ctx', 'Ctx'), p('bpm', 'number')], description: 'Heart rate changed. ctx.intensity is the normalized 0..1 value.', example: 'onHeartRate(self, ctx, bpm) { self.speed = 1 + 0.5 * ctx.intensity; }' },
      { name: 'onRaycastHit', params: [p('self', 'Self'), p('ctx', 'Ctx')], description: 'The aim ray hit this entity.', example: 'onRaycastHit(self, ctx) { ctx.haptic("tick", 0.4); }' },
      { name: 'onTriggerEnter', params: [p('self', 'Self'), p('ctx', 'Ctx')], description: 'The player entered this entity\'s trigger volume.', example: 'onTriggerEnter(self, ctx) { console.log("entered", self.name); }' },
      { name: 'onTriggerExit', params: [p('self', 'Self'), p('ctx', 'Ctx')], description: 'The player left this entity\'s trigger volume.', example: 'onTriggerExit(self, ctx) { console.log("left", self.name); }' },
      { name: 'onRemote', params: [p('self', 'Self'), p('ctx', 'Ctx'), p('name', 'string'), p('data', 'any')], description: 'The server sent this player a remote event.', example: 'onRemote(self, ctx, name, data) { if (name === "hit") ctx.haptic("thud", 0.8); }' },
      { name: 'onTick', params: [p('self', 'Self'), p('ctx', 'Ctx'), p('dt', 'number')], description: 'Runs 5 times a second. dt is seconds since the last tick.', example: 'onTick(self, ctx, dt) { self.speed = Math.max(0, self.speed - dt); }' },
    ],
    members: [
      { path: 'self.name', signature: 'self.name: string', description: 'Name of the entity this script is attached to.', example: 'console.log(self.name);' },
      { path: 'self.speed', signature: 'self.speed: number', description: 'Speed multiplier for this entity. Read and write.', example: 'self.speed = 1.5;' },
      { path: 'self.position', signature: 'self.position: [x, y, z]', description: 'Entity position in meters. Reading it works; writes have no effect.', example: 'const [x, y, z] = self.position;' },
      { path: 'self.audio.play', signature: 'self.audio.play(sound: string)', description: 'Plays a named sound on this entity.', example: 'self.audio.play("growl");' },
      { path: 'self.audio.stop', signature: 'self.audio.stop()', description: 'Stops the sound playing on this entity.', example: 'self.audio.stop();' },
      { path: 'ctx.intensity', signature: 'ctx.intensity: number', description: 'Normalized heart rate, 0..1. Set on heart-rate calls.', example: 'const d = ctx.intensity;' },
      { path: 'ctx.player.id', signature: 'ctx.player.id: string | null', description: 'This player\'s id from the game server; null until the server welcome arrives.', example: 'if (ctx.player.id) console.log(ctx.player.id);' },
      { path: 'ctx.positionAccuracy', signature: 'ctx.positionAccuracy: number | null', description: 'Horizontal accuracy of ctx.position in meters. null without the location permission or a fix.', example: 'if (ctx.positionAccuracy !== null && ctx.positionAccuracy > 10) return;' },
      { path: 'ctx.position', signature: 'ctx.position: [x, y, z] | null', description: 'This player\'s position. Only set when scene.permissions.location is true, else null.', example: 'if (ctx.position) console.log(ctx.position[0]);' },
      { path: 'ctx.remote.fire', signature: 'ctx.remote.fire(name: string, data?: any)', description: 'Sends a remote event to the server. The only way off the client.', example: 'ctx.remote.fire("punch", { dir: [1, 0, 0] });' },
      { path: 'ctx.spawn', signature: 'ctx.spawn(name: string)', description: 'Asks the runtime to spawn an entity. Not simulated in local runs.', example: 'ctx.spawn("coin");' },
      { path: 'ctx.haptic', signature: 'ctx.haptic(pattern: string, intensity: number)', description: 'Plays a haptic pattern on the player\'s device. Intensity 0..1.', example: 'ctx.haptic("thud", 0.8);' },
      { path: 'console.log', signature: 'console.log(...args)', description: 'Writes to the Output tab. console.warn and console.error work too.', example: 'console.log("hello");' },
    ],
  },
  server: {
    handlers: [
      { name: 'onPlayerJoin', params: [p('ctx', 'Ctx'), p('player', '{ id: string, name: string }')], description: 'A player joined the session.', example: 'onPlayerJoin(ctx, player) { ctx.state.health = ctx.state.health || {}; ctx.state.health[player.id] = 100; }' },
      { name: 'onPlayerLeave', params: [p('ctx', 'Ctx'), p('player', '{ id: string, name: string }')], description: 'A player left the session.', example: 'onPlayerLeave(ctx, player) { delete ctx.state.health[player.id]; }' },
      { name: 'onRemote', params: [p('ctx', 'Ctx'), p('player', '{ id: string, name: string }'), p('name', 'string'), p('data', 'any')], description: 'A client fired a remote event.', example: 'onRemote(ctx, player, name, data) { if (name === "punch") ctx.remote.fireAll("hit", { from: player.id }); }' },
      { name: 'onTimer', params: [p('ctx', 'Ctx'), p('tag', 'string'), p('data', 'any')], description: 'A timer set with ctx.after fired.', example: 'onTimer(ctx, tag, data) { if (tag === "roundEnd") ctx.state.round = "over"; }' },
    ],
    members: [
      { path: 'ctx.state', signature: 'ctx.state: object', description: 'Plain object that lives in the hosted session. Resets when a new version is published.', example: 'ctx.state.round = "won";' },
      { path: 'ctx.remote.fire', signature: 'ctx.remote.fire(playerId: string, name: string, data?: any)', description: 'Sends a remote event to one player.', example: 'ctx.remote.fire("p1", "hit", { hp: 90 });' },
      { path: 'ctx.remote.fireAll', signature: 'ctx.remote.fireAll(name: string, data?: any)', description: 'Sends a remote event to every player.', example: 'ctx.remote.fireAll("hit", { hp: 90 });' },
      { path: 'ctx.now', signature: 'ctx.now(): number', description: 'Current time in milliseconds.', example: 'const t = ctx.now();' },
      { path: 'ctx.after', signature: 'ctx.after(ms: number, tag: string, data?: any): number', description: 'Fires onTimer after 50 ms to 1 h; at most 64 pending. Returns an id for ctx.cancel.', example: 'ctx.state.id = ctx.after(1000, "roundEnd", { n: 1 });' },
      { path: 'ctx.cancel', signature: 'ctx.cancel(id: number)', description: 'Cancels a pending ctx.after timer.', example: 'ctx.cancel(ctx.state.id);' },
      { path: 'console.log', signature: 'console.log(...args)', description: 'Writes to the Server tab. console.warn and console.error work too.', example: 'console.log("joined");' },
    ],
  },
};

export const handlerSignature = (h: ApiHandler): string => `${h.name}(${h.params.map((q) => q.name).join(', ')})`;

export const findHandler = (side: ApiSide, name: string): ApiHandler | undefined => API[side].handlers.find((h) => h.name === name);

export const findMember = (side: ApiSide, path: string): ApiMember | undefined => API[side].members.find((m) => m.path === path);

/** The empty script a new file starts from: first handler of the side, as project.ts's SCRIPT_STUBS has it. */
export function scriptStub(kind: ApiSide): string {
  const wrap = kind === 'client' ? 'script' : 'serverScript';
  const h = kind === 'client' ? findHandler('client', 'onLookAt')! : findHandler('server', 'onRemote')!;
  return `export default ${wrap}({\n  ${handlerSignature(h)} {\n  },\n});\n`;
}
