// Quick Draw client script (on the zero-scale PlayerScriptHost entity): one per player. Every player is a "phone": it
// calibrates, reports `ready`, plays the cue itself and reports when it was raised after the cue. The server script
// (game.js) owns the rules; the events here match its contract: role, ready, raised {sinceFireMs}, lowered.
//
// Reaction time clock: Date.now() on this device, read when `fire` arrives and again when the raise gesture is handled,
// so sinceFireMs is a delta on one clock and the other phone's clock offset never enters. g.t is not used: it is the
// device's packet time and the `fire` event carries no packet time, so the two ends would be on different clocks. The
// error is the handler delay of the gesture (one input step, about 20 ms), the same for both phones.
export default script({
  onTick(self, ctx) {
    if (self.role !== undefined) return;
    // First tick: the Studio role is known and the join has completed, so announce it once.
    self.role = "phone";
    self.raised = false;
    self.fireAt = null;
    self.phase = "lobby";
    self.round = 0;
    ctx.remote.fire("role", { role: self.role });
  },

  onGesture(self, ctx, g) {
    if (self.role === "phone") {
      // An explicit tap is the phone's calibrate + ready; nothing reports ready on its own. Not while raised:
      // the rest pose must be the lowered one. The server starts the countdown once both phones are ready.
      if (g.type === "tap" && !self.raised) {
        self.calibrate(); // the pose held now is the rest pose raise is measured from
        ctx.remote.fire("ready", { round: self.round });
      } else if (g.type === "raise") {
        self.raised = true;
        ctx.remote.fire("raised", { round: self.round, sinceFireMs: self.fireAt === null ? null : Date.now() - self.fireAt });
      } else if (g.type === "lower") {
        self.raised = false;
        ctx.remote.fire("lowered", {});
      }
    }
  },

  onRemote(self, ctx, name, data) {
    if (name === "state") {
      self.phase = data.phase;
      self.round = data.round;
      if (data.phase === "lobby" || data.phase === "ready" || data.phase === "arming") self.fireAt = null;
      // Already raised when arming starts: the server only sees transitions, so report it as a foul.
      if (data.phase === "arming" && self.role === "phone" && self.raised) ctx.remote.fire("raised", { round: self.round, sinceFireMs: null });
    } else if (name === "fire") {
      self.round = data.round;
      self.fireAt = Date.now();
      self.audio.play("beep");
      ctx.haptic("thud", 1);
    } else if (name === "roundResult") console.log("round " + data.round + ": " + data.winnerId + " (" + data.reason + ")");
    else if (name === "matchOver") console.log("match winner:", data.winnerId);
  },
});
