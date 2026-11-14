// Blank template: a floor and one cube. The client script fires a "click" remote on a tap gesture; the server
// script counts clicks into ctx.state, so Run on server plus the State tab shows the loop in under a minute.
// Plain data: project.ts turns it into a Project.

export const blankScene = {
  name: 'Blank',
  requiredTier: 1,
  playerOrigin: [0, 1.6, 0],
  runMode: 'screen',
  clientScripts: ['cube'],
  serverScripts: ['counter'],
  entities: [
    { name: 'Floor', position: [0, 0, -4], scale: [10, 0.1, 10] },
    {
      name: 'Cube',
      position: [0, 1.2, -3],
      components: [{ type: 'script', name: 'cube' }],
    },
  ],
};

export const blankClientScripts: Record<string, string> = {
  cube: `// Client script on Cube. Press T (tap) while the viewport is focused, or look at the cube.
export default script({
  onGesture(self, ctx, gesture) {
    if (gesture.type === "tap") {
      console.log("click sent");
      ctx.remote.fire("click", { by: self.name });
    }
  },

  onRemote(self, ctx, name, data) {
    if (name === "clicks") console.log("server says clicks =", data.count);
  },
});
`,
};

export const blankServerScripts: Record<string, string> = {
  counter: `// Server script. ctx.state lives in the hosted session; the State tab shows it live.
export default serverScript({
  onRemote(ctx, player, name, data) {
    if (name !== "click") return;
    ctx.state.clicks = (ctx.state.clicks || 0) + 1;
    console.log("click from", player.id, "total", ctx.state.clicks);
    ctx.remote.fireAll("clicks", { count: ctx.state.clicks });
  },
});
`,
};
