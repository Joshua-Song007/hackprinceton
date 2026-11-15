// Manhunt client script: nothing to do on the phone except announce itself once. Location streaming comes from the PearUI `sensor` node.
export default script({
  onTick(self, ctx) {
    if (self.role !== undefined) return;
    self.role = "phone";
    ctx.remote.fire("role", { role: self.role });
  },
});
