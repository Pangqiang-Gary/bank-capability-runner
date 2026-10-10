const http = require("node:http");
const crypto = require("node:crypto");
// Capability token lives only in memory, never evidence. Operator uses same Page.
async function handoff(
  surface,
  request,
  log,
  { onReady, timeoutMs = 120000 } = {},
) {
  surface.owner = "human";
  surface.humanEvents = [];
  const token = crypto.randomBytes(24).toString("hex");
  log("control_transfer", { owner: "human", request });
  let resolve;
  const resumed = new Promise((r) => (resolve = r));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname !== `/${token}`) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (req.method === "POST") {
      resolve();
      res.end("Control returned.");
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<h1>Automation paused</h1><p>Use the open sandbox browser window to repair the session. This is the same live session. Actions are audited without entered values.</p><form method="POST"><button>Return control to automation</button></form>',
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/${token}`;
  let timer;
  try {
    console.log("Operator console:", url);
    await onReady?.(url, surface);
    await Promise.race([
      resumed,
      new Promise(
        (_, reject) =>
          (timer = setTimeout(
            () => reject(new Error("HANDOFF_TIMEOUT")),
            timeoutMs,
          )),
      ),
    ]);
    surface.policy.url(surface.page.url());
    log("human_actions", { events: surface.humanEvents });
    surface.owner = "automation";
    log("control_transfer", { owner: "automation" });
  } finally {
    clearTimeout(timer);
    await new Promise((r) => server.close(r));
  }
}
module.exports = { handoff };
