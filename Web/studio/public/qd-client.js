// Shared helper for qd-phone.html: dev sign-in, /play/{game} socket, role event,
// auto-reconnect. Page URL: ?game=<gameId>&name=<display name>[&version=<n>][&lobby=CODE] (no version: the latest published one;
// no lobby: the shared OPEN lobby; CODE is 4-8 of A-Z0-9).
(function () {
  const params = new URLSearchParams(location.search);
  const game = params.get("game") || "";
  const name = (params.get("name") || "Player").slice(0, 40);
  const version = /^\d+$/.test(params.get("version") || "") ? params.get("version") : "";

  const lobbyParam = (params.get("lobby") || "").toUpperCase();
  const lobby = /^[A-Z0-9]{4,8}$/.test(lobbyParam) ? lobbyParam : "";

  // sessionStorage: survives a reload (same account id), but two tabs stay distinct players.
  function subject() {
    let s = sessionStorage.getItem("qd-subject");
    if (!s) {
      s = "qd-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("qd-subject", s);
    }
    return s;
  }

  async function signIn() {
    const res = await fetch("/api/accounts/signin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "dev", subject: subject(), display_name: name }),
    });
    if (!res.ok) {
      throw new Error(res.status === 403 ? "dev sign-in is off (server needs PEAR_DEV_SIGNIN=1)" : "sign-in failed: " + res.status);
    }
    return res.json();
  }

  // connect({role, onEvent(name, data), onStatus(text, ok)}) -> {send(name, data)}
  function connect({ role, onEvent, onStatus }) {
    let ws = null;
    let delay = 500;
    const status = (text, ok) => onStatus && onStatus(text, !!ok);
    if (!game) {
      status("missing ?game=<gameId> in the URL", false);
      return { send() {} };
    }

    async function open() {
      status("connecting…", false);
      let token;
      try {
        token = (await signIn()).token;
      } catch (e) {
        return retry(e.message);
      }
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${scheme}://${location.host}/play/${encodeURIComponent(game)}?token=${encodeURIComponent(token)}${version ? "&version=" + version : ""}${lobby ? "&lobby=" + lobby : ""}`);
      const mine = ws;
      mine.onmessage = (ev) => {
        let frame;
        try { frame = JSON.parse(ev.data); } catch { return; }
        if (frame.name === "_welcome") {
          delay = 500;
          mine.send(JSON.stringify({ name: "role", data: { role } }));
          status("connected as " + (frame.data && frame.data.name || name), true);
        }
        onEvent(frame.name, frame.data);
      };
      mine.onclose = () => { if (ws === mine) retry("disconnected"); };
    }

    function retry(why) {
      ws = null;
      status(`${why}; reconnecting in ${(delay / 1000).toFixed(1)}s`, false);
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 8000);
    }

    open();
    return {
      send(evName, data) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ name: evName, data: data === undefined ? {} : data }));
      },
    };
  }

  window.QD = { game, name, lobby: lobby || "OPEN", connect };
})();
