const { assert } = require("./contracts");
const controls = {
  fill: ["Member reference"],
  click: ["Search", "Open member", "Review savings balance", "Continue"],
};
class Policy {
  constructor(origin, config = {}) {
    this.origin = origin;
    this.routes = config.routes || ["/", "/search", "/detail", "/review"];
    this.controls = config.controls || controls;
  }
  url(url) {
    const u = new URL(url);
    assert(
      u.origin === this.origin && this.routes.includes(u.pathname),
      "POLICY_ROUTE_BLOCKED",
    );
  }
  action(a) {
    assert(
      this.controls[a.action]?.includes(a.target?.name),
      "POLICY_ACTION_BLOCKED",
    );
  }
}
function redact(text, values = []) {
  let s = String(text);
  for (const v of values.filter(Boolean)) s = s.split(v).join("[REDACTED]");
  return s
    .replace(/sk-[A-Za-z0-9_-]+/g, "[SECRET]")
    .replace(/\b\d{5,}\b/g, "[REFERENCE]")
    .replace(/\b\d+\.\d{2}\b/g, "[AMOUNT]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]");
}
module.exports = { Policy, redact };
