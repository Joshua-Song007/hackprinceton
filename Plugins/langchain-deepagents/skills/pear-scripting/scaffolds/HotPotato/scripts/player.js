// Hot potato client script (on the Arena entity). Reports this player's own position to the server (the scene grants the
// location permission), starts rounds, tags on a swing, and buzzes when this player becomes the holder.
// Keys in Studio: P = pinch, T = tap, F = flick, Devices panel has Double tap.
export default script({
  onTick(self, ctx, dt) {
    // ctx.position is null unless the scene sets permissions.location.
    if (ctx.position) ctx.remote.fire("pos", { x: ctx.position[0], z: ctx.position[2], acc: ctx.positionAccuracy == null ? 2 : ctx.positionAccuracy });
  },

  onGesture(self, ctx, g) {
    if (g.type === "doubleTap") ctx.remote.fire("start", {});
    const mine = ctx.player.id !== null && self.holder === ctx.player.id;
    if (mine && (g.type === "tap" || g.type === "flick" || g.type === "swing")) ctx.remote.fire("tag", {});
  },

  onRemote(self, ctx, name, data) {
    if (name === "holder") {
      self.holder = data.id;
      console.log("potato is with", data.name || data.id);
      if (ctx.player.id !== null && data.id === ctx.player.id) ctx.haptic("thud", 0.8);
    } else if (name === "eliminated") {
      console.log((data.name || data.id) + " is out in round " + data.round);
      if (ctx.player.id !== null && data.id === ctx.player.id) ctx.haptic("thud", 1);
    } else if (name === "tagMissed") {
      console.log("tag missed: " + data.reason);
    } else if (name === "winner") {
      self.holder = null;
      console.log("winner:", data.name || data.id);
    }
  },
});
