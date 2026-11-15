// Static kit reference returned by the kit_reference tool: contracts C1/C2 (+ amendments) and the script API, compact.
export const KIT_REFERENCE = `PEAR GAME KIT (agent reference)

FILES (save_version {id, files}; paths are keys, values are strings)
  scene.json                      scene (required, JSON object)
  scripts/client/<name>.js        client scripts (optional)
  scripts/server/<name>.js        server scripts, e.g. scripts/server/game.js
  metadata.json                   optional JSON object (name, instructions, ...)
  ui.json (or any other .json/.html/.css/.js name)   stored as a version ASSET (PearUI screens, scenario.json)
Scripts: \`export default (function () { return { onRemote(ctx, player, name, data) {...} }; })();\` or
\`export default serverScript({...})\` / \`script({...})\`. The first statement must be the \`export default\`.
Server handlers: onPlayerJoin(ctx, player) onPlayerLeave(ctx, player) onRemote(ctx, player, name, data) onTimer(ctx, tag, data)
Server ctx: ctx.state (plain object, lives in the session) ctx.remote.fire(playerId, name, data) ctx.remote.fireAll(name, data)
  ctx.now() ctx.after(ms, tag, data)->id (50ms..1h, max 64 pending) ctx.cancel(id) console.log
Client handlers: onLookAt onGesture(self,ctx,g) onHeartRate onRaycastHit onTriggerEnter onTriggerExit onRemote(self,ctx,name,data) onTick(self,ctx,dt)
Client ctx: ctx.remote.fire(name,data) ctx.haptic(pattern,intensity) ctx.player.id/role ctx.position ctx.intensity self.audio.play/speak
Scripts see only these APIs. No fs, network or source access.

PEARUI v1 (ui.json): server-driven native UI; the same JSON renders on iOS and web
  {"pearui":1,"route":[{"when":"<expr>","screen":"<id>"},...,{"screen":"<id>"}],"screens":{"<id>":Node}}
  First matching route wins; the last route has no "when".
  View state (read-only): ev.<name> = latest data of each server->client event (ctx.remote.fireAll("state",d) gives ev.state);
    me = {id,name,lobby}; local.<k> = values set by "set" actions; device = {kind:"phone"|"ipad"|"watch"}.
  Bindings: any string prop may hold {{expr}}. expr = dotted path, optional == / != literal, ! prefix, || fallback, .length (arrays/strings, iOS). No JS.
  Equality is loose between number and string (2 == '2').
  Node common props: type, if(expr), id, style{tone:neutral|accent|good|bad|warn, size:s|m|l|xl|huge, align:start|center|end, pad:0-4, grow:bool}
  Nodes: column|row|stack(children) text(value) button(label,action) image(src=asset name) timer(until=epoch ms expr, counts down)
    list(items=expr->array, item=Node, inside it item.<k>) gauge(value 0..1) spacer map(markers=[{lat,lng,label,tone}], follow:"me")
    sensor(invisible; kind:motion|location; event; hz<=30; streams {pitch,roll,yaw} or {lat,lng,acc} to the server as that event)
    effect(invisible; on=expr change -> haptic:light|heavy|success|fail, sound:asset name)
  Action: {"send":"<event>","data":{...bindings}} or {"set":"<local key>","value":...}. Unknown node types render nothing.
  A PearUI client sends {"name":"role","data":{"role":"referee"|"phone","kind":"ipad"|"phone"}} on socket open. Scripts that ignore role are unaffected.
  Clients have no logic: a motion sensor streams "aim" {pitch,roll,yaw}; the server script does any thresholding/hysteresis.
  Aim pattern: put a sensor(kind:motion,event:"aim") on the phone screen; the server script reads "aim" and fires when pitch/roll cross its threshold, then fireAll("fire",{round}).
  Worked example (trimmed from Games/QuickDraw/ui.json):
    {"pearui":1,"route":[{"when":"device.kind == 'ipad'","screen":"referee"},{"screen":"gun"}],
     "screens":{
      "referee":{"type":"column","children":[
        {"type":"list","items":"ev.view.players","item":{"type":"row","children":[
          {"type":"text","value":"{{item.name}}"},{"type":"spacer"},{"type":"text","value":"{{item.score}}","style":{"size":"xl","tone":"accent"}}]}}]},
      "gun":{"type":"column","children":[
        {"type":"sensor","kind":"motion","event":"aim","hz":20,"id":"aim"},
        {"type":"effect","id":"fire-haptic","on":"ev.fire.round","haptic":"heavy"},
        {"type":"text","value":"{{ev.state.needs}}","if":"ev.view.players.length"},
        {"type":"button","label":"Ready","action":{"send":"ready","data":{"round":"{{ev.state.round}}"}},"if":"!ev.state.ready","style":{"tone":"accent"}}]}}}

  Location game (Manhunt-style): client streams {lat,lng,acc} via a location sensor; the server script does the distance maths.
    ui: {"type":"column","children":[
      {"type":"sensor","kind":"location","event":"location","hz":1,"id":"gps"},
      {"type":"map","markers":"ev.view.markers","follow":"me"},
      {"type":"text","value":"{{ev.view.hint}}"},
      {"type":"button","label":"Tag","action":{"send":"tag"},"if":"ev.view.role == 'hunter'"},
      {"type":"effect","id":"near","on":"ev.view.hint","haptic":"heavy"}]}
    server (JS): const R=6371000,rad=d=>d*Math.PI/180;
      const haversine=(a,b)=>{const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
      on "location" {lat,lng,acc}: store per player; hint = d<15?"Tag range":d<50?"Close":"Cold" (d metres to nearest runner); on "tag" accept only if haversine<=15.
    Markers are [{lat,lng,label,tone}] (tone good=green, bad=red, else orange). One location stream per screen.

SCENARIO (run_scenario: headless, real sockets against the hosted server)
  {"game":"<id>","version"?:n,"lobby"?:"CODE","durationMs":n,
   "devices":[{"name","kind":"phone"|"ipad"|"watch","role"?,
     "script":[{"at":ms,"send":{"name","data"}}|{"at":ms,"motion":{pitch,roll,yaw}}|{"at":ms,"gps":{lat,lng}}|{"at":ms,"tap":true}],
     "rules":[{"on":"<event>","when"?:"<expr over {data, ...viewState}>","after"?:ms,"send":{"name","data"},"once"?:bool}]}],
   "expect":[{"by":ms,"expr":"<expr on a device's view state>","device":"<name>"}]}
  Reactive rules answer server events (cues arrive at random times); {{expr}} in a rule's send.data resolves against {data, ...viewState}.
  Timed motion/gps steps send "aim"/"location" (override with scenario motionEvent / gpsEvent). A device role sends role {role} after _welcome.
  Report: {"ok","expect":[{...,"pass","actual"}],"frames":[{t,device,dir,name,data}],"logs":[],"final":{device:viewState}}.
  The scenario runs against the LATEST saved version unless "version" is set. Logs need an owner/developer token.
  Loop: save_version -> run_scenario -> read the report -> fix -> repeat until ok is true; then publish (publish = list: sets listed:true; optional description/tags/releaseNotes).
`;
