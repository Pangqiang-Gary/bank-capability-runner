const http = require("node:http");

// Deliberately server-rendered, table-based UI without test IDs or a task API.
function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Harbor Operations Sandbox</title><style>body{font:16px system-ui;background:#eef2f6;color:#18324b;margin:40px}main{background:white;padding:30px;max-width:720px;border-top:5px solid #168577}td{padding:12px}input,button{font:inherit;padding:10px}button{background:#18324b;color:white;border:0}a{color:#14796e}.banner{padding:15px;background:#ffefbd}</style></head><body><main><h1>Harbor Operations</h1><p>Sandbox · synthetic records only · vendor v1</p>${body}</main></body></html>`;
}
function startApp(port = 0) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    const mode = u.searchParams.get("mode") || "normal";
    const id = u.searchParams.get("member") || "";
    const hidden = `<input type="hidden" name="mode" value="${["normal", "timeout", "permission", "interstitial", "slow", "validation"].includes(mode) ? mode : "normal"}">`;
    let body;
    if (u.pathname === "/")
      body = `<h2>Member search</h2><form action="/search"><table><tr><td><label for="member">Member reference</label></td><td><input id="member" name="member" pattern="[0-9]{5}" required></td></tr></table>${hidden}<button>Search</button></form>`;
    else if (mode === "timeout" && !u.searchParams.has("resumed"))
      body = `<h2>Session expired</h2><p>Operator verification required.</p><a href="${u.pathname}?member=${encodeURIComponent(id)}&mode=${mode}&resumed=1">Restore sandbox session</a>`;
    else if (mode === "permission")
      body =
        "<h2>Permission denied</h2><p>Your role cannot view this record.</p>";
    else if (mode === "validation" || !/^\d{5}$/.test(id))
      body =
        "<h2>Validation error</h2><p>Member reference must contain five digits.</p>";
    else if (!["12345", "67890"].includes(id))
      body = "<h2>Member not found</h2><p>No matching sandbox member.</p>";
    else if (mode === "interstitial" && !u.searchParams.has("dismissed"))
      body = `<h2>Maintenance notice</h2><p>Known reversible interstitial.</p><a href="${u.pathname}?member=${id}&mode=${mode}&dismissed=1">Continue</a>`;
    else if (u.pathname === "/search")
      body = `<h2>Search results</h2><table><tr><th>Record</th><th>Action</th></tr><tr><td>Sandbox member</td><td><a href="/detail?member=${id}&mode=${mode}">Open member</a></td></tr></table>`;
    else if (u.pathname === "/detail")
      body = `<h2>Member detail</h2><table><tr><td>Savings</td><td>$${id === "12345" ? "1250.00" : "980.50"}</td></tr></table><a href="/review?member=${id}&mode=${mode}">Review savings balance</a>`;
    else if (u.pathname === "/review")
      body = `<h2>Balance review</h2><p>Read-only review complete.</p><dl><dt>Savings balance</dt><dd aria-label="Savings balance">${id === "12345" ? "1250.00" : "980.50"}</dd><dt>Currency</dt><dd aria-label="Currency">USD</dd></dl><form action="/commit"><button>Transfer funds</button></form>`;
    else {
      res.writeHead(404);
      return res.end(html("<h2>Unknown route</h2>"));
    }
    const send = () => {
      res.setHeader("Content-Type", "text/html");
      res.end(html(body));
    };
    if (mode === "slow" && u.pathname === "/search") setTimeout(send, 700);
    else send();
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}
module.exports = { startApp };
