// Hollow Choir player (client script). Attached to Sanctuary (head-probe trigger sphere).
// Feedback only: haptics for gestures and server events. [provisional: needs-tien-review]
// ctx.haptic(pattern, intensity) and self.audio.play(name) assumed from overview.md Module 3.
export default script({
  // Standing in the sanctuary is safe.
  onTriggerEnter(self, ctx) {
    self.audio.play("sanctuary_hum");
    ctx.haptic("soft", 0.2);
  },

  // Leaving the sanctuary is a warning pulse.
  onTriggerExit(self, ctx) {
    ctx.haptic("thud", 0.4);
  },

  // Gesture acknowledgement.
  onGesture(self, ctx, g) {
    if (g.type === "flick" || g.type === "pinch") ctx.haptic("tick", 0.5);
  },

  onRemote(self, ctx, name, data) {
    if (name === "banished") ctx.haptic("thud", 0.8);
    else if (name === "damage") ctx.haptic("thud", Math.min(1, 0.4 + data.hits * 0.2));
    else if (name === "round" && data.state === "won") ctx.haptic("chime", 1);
    else if (name === "round" && data.state === "lost") ctx.haptic("thud", 1);
  },
});
