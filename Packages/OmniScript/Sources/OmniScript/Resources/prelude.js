// Prelude evaluated into every script context before creator code.
// JavaScriptCore has no ES module loader, so the engine rewrites a leading
// `export default` to `__omniExportDefault(` ... `)` before evaluation
// (see __omniExportDefault below).
(function (global) {
  "use strict";

  var CLIENT_HANDLERS = [
    "onLookAt", "onGesture", "onHeartRate", "onRaycastHit",
    "onTriggerEnter", "onTriggerExit", "onRemote", "onTick"
  ];
  var SERVER_HANDLERS = ["onPlayerJoin", "onPlayerLeave", "onRemote", "onTimer"];

  function checkHandlers(kind, definition, allowed) {
    if (definition === null || typeof definition !== "object") {
      throw new TypeError(kind + "(...) expects an object of handlers");
    }
    Object.keys(definition).forEach(function (key) {
      if (typeof definition[key] !== "function") {
        throw new TypeError(kind + ": handler '" + key + "' must be a function");
      }
      if (allowed.indexOf(key) < 0) {
        throw new TypeError(kind + ": unknown handler '" + key + "'");
      }
    });
    return Object.freeze(definition);
  }

  // Client script definition: handlers receive (self, ctx, ...args).
  global.script = function script(definition) {
    return checkHandlers("script", definition, CLIENT_HANDLERS);
  };

  // Server script definition: handlers receive (ctx, ...args).
  global.serverScript = function serverScript(definition) {
    return checkHandlers("serverScript", definition, SERVER_HANDLERS);
  };

  // Target of the `export default` rewrite; the engine reads the result with __omniTakeDefault().
  var exported;
  global.__omniExportDefault = function (value) {
    exported = value;
    return value;
  };
  global.__omniTakeDefault = function () {
    var value = exported;
    exported = undefined;
    return value;
  };
})(this);
