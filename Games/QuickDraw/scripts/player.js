// Quick Draw client script (on the Arena entity). The phones and the ref talk to the server through the web pages;
// this script only mirrors the server's announcements to the log so a Studio run shows the match.
export default script({
  onRemote(self, ctx, name, data) {
    if (name === "roundResult") console.log("round " + data.round + ": " + data.winnerId + " (" + data.reason + ")");
    else if (name === "matchOver") console.log("match winner:", data.winnerId);
  },
});
