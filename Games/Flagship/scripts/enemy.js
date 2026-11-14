// Hollow Choir wraith (client script). Attached to WraithLeft, WraithRight, WraithAhead.
// `export default` stays the first statement (the engine rewrites a leading one); state lives in the IIFE.
// One script context may serve all three entities, so per-wraith state is keyed by self.name.
// [provisional: needs-tien-review] self.name, self.speed, self.audio.play(name) are assumed
// from overview.md Module 3; prelude.js does not define self/ctx shapes.
export default (function () {
  const locked = {};
  const banished = {};

  return script({
    // Looking at a wraith for 0.5 s locks it; the choir answers.
    onLookAt(self, ctx) {
      if (banished[self.name]) return;
      locked[self.name] = true;
      self.audio.play("wraith_choir");
      ctx.haptic("tick", 0.3);
    },

    // Flick or pinch banishes the locked wraith (server confirms).
    onGesture(self, ctx, g) {
      if (!locked[self.name] || banished[self.name]) return;
      if (g.type === "flick" || g.type === "pinch") {
        locked[self.name] = false;
        ctx.remote.fire("banish", { enemy: self.name });
      }
    },

    // Calm heart (intensity 0) = slow wraith; racing heart = up to 1.5x aggression.
    onHeartRate(self, ctx, bpm) {
      if (banished[self.name]) return;
      self.speed = 1 + 0.5 * ctx.intensity;
    },

    // WraithAhead closing in (its box trigger) reports contact to the server.
    onTriggerEnter(self, ctx) {
      if (banished[self.name]) return;
      ctx.remote.fire("contact", { enemy: self.name });
    },

    onRemote(self, ctx, name, data) {
      if (name === "banished" && data.enemy === self.name) {
        banished[self.name] = true;
        locked[self.name] = false;
        self.speed = 0;
        self.audio.play("wraith_vanish");
      }
    },
  });
})();
