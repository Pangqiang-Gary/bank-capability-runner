const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { startApp } = require("../src/app");
const { BrowserSurface } = require("../src/surface");
const { replay } = require("../src/engine");
const { capability, validateInputs } = require("../src/contracts");
const { Policy, redact } = require("../src/policy");
const flow = capability([
  {
    action: "fill",
    target: { kind: "label", name: "Member reference" },
    input: "member",
  },
  { action: "click", target: { kind: "button", name: "Search" } },
  { action: "click", target: { kind: "link", name: "Open member" } },
  { action: "click", target: { kind: "link", name: "Review savings balance" } },
]);
test("typed contract rejects invalid input and artifact versions", () => {
  assert.throws(() => validateInputs(flow, { member: "../secret" }));
  assert.throws(() =>
    validateInputs({ ...flow, schemaVersion: 2 }, { member: "12345" }),
  );
});
test("policy blocks irreversible controls, foreign origins and commit routes", () => {
  const p = new Policy("http://127.0.0.1:8000");
  for (const url of [
    "https://example.com/",
    "http://127.0.0.1:8000/commit",
    "http://127.0.0.1:8001/",
  ])
    assert.throws(() => p.url(url));
  assert.throws(() =>
    p.action({ action: "click", target: { name: "Transfer funds" } }),
  );
});
test("redaction strips references, amounts, emails and keys", () => {
  assert.equal(
    redact("12345 1250.00 test@example.com sk-syntheticsecret"),
    "[REFERENCE] [AMOUNT] [EMAIL] [SECRET]",
  );
});
for (const [mode, member, status, code] of [
  ["normal", "67890", "success"],
  ["normal", "99999", "business_outcome", "NOT_FOUND"],
  ["permission", "12345", "failure", "PERMISSION_DENIED"],
  ["validation", "12345", "business_outcome", "INVALID_REFERENCE"],
  ["interstitial", "12345", "success"],
  ["slow", "12345", "success"],
  ["timeout", "12345", "intervention", "SESSION_EXPIRED"],
]) {
  test(`live browser replay: ${mode}/${status}`, async () => {
    const app = await startApp();
    let surface;
    try {
      surface = await BrowserSurface.open(app.origin);
      await surface.enter(mode);
      const result = await replay(
        surface,
        flow,
        { member },
        { dir: `evidence/tests-${mode}-${member}` },
      );
      assert.equal(result.status, status);
      if (code) assert.equal(result.code, code);
      if (status === "success") {
        assert.equal(result.modelCalls, 0);
        assert.equal(result.outputs.balance, member === "67890" ? 980.5 : 1250);
        const persisted = await fs.readFile(
          `evidence/tests-${mode}-${member}/run.jsonl`,
          "utf8",
        );
        assert.doesNotMatch(persisted, /"balance":\s*\d/);
      }
    } finally {
      await surface?.close();
      await new Promise((r) => app.server.close(r));
    }
  });
}
test("same-session handoff, operator actions audited and deterministic replay resumes", async () => {
  const app = await startApp();
  let surface;
  try {
    surface = await BrowserSurface.open(app.origin);
    const originalPage = surface.page;
    await surface.enter("timeout");
    const result = await replay(
      surface,
      flow,
      { member: "12345" },
      {
        dir: "evidence/handoff-simulated-operator",
        handoff: {
          onReady: async (url, s) => {
            assert.equal(s.page, originalPage);
            assert.equal(s.owner, "human");
            await assert.rejects(
              s.action(flow.steps[0], { member: "12345" }),
              /SESSION_OWNED_BY_HUMAN/,
            );
            await s.page
              .getByRole("link", { name: "Restore sandbox session" })
              .click();
            await fetch(url, { method: "POST" });
          },
        },
      },
    );
    assert.equal(result.status, "success");
    assert.equal(surface.owner, "automation");
    const logs = await fs.readFile(
      "evidence/handoff-simulated-operator/run.jsonl",
      "utf8",
    );
    assert.match(logs, /human_actions/);
    assert.match(logs, /Restore sandbox session/);
  } finally {
    await surface?.close();
    await new Promise((r) => app.server.close(r));
  }
});
test("browser enforcement blocks forbidden navigation", async () => {
  const app = await startApp();
  let surface;
  try {
    surface = await BrowserSurface.open(app.origin);
    await surface.enter();
    await assert.rejects(surface.page.goto(`${app.origin}/commit`));
  } finally {
    await surface?.close();
    await new Promise((r) => app.server.close(r));
  }
});
test("ambiguous controls stop before clicking", async () => {
  const app = await startApp();
  let surface;
  try {
    surface = await BrowserSurface.open(app.origin);
    await surface.enter();
    await surface.page.evaluate(() => {
      const b = document.createElement("button");
      b.textContent = "Search";
      document.body.append(b);
    });
    const result = await replay(
      surface,
      flow,
      { member: "12345" },
      { dir: "evidence/ambiguous-target" },
    );
    assert.equal(result.code, "TARGET_AMBIGUOUS_OR_MISSING");
  } finally {
    await surface?.close();
    await new Promise((r) => app.server.close(r));
  }
});
test("unexpected dialogs are explicit failures", async () => {
  const app = await startApp();
  let surface;
  try {
    surface = await BrowserSurface.open(app.origin);
    await surface.enter();
    await surface.page.evaluate(() => alert("Unrecognized application dialog"));
    const result = await replay(
      surface,
      flow,
      { member: "12345" },
      { dir: "evidence/unexpected-dialog" },
    );
    assert.equal(result.status, "failure");
    assert.equal(result.code, "UNEXPECTED_DIALOG");
  } finally {
    await surface?.close();
    await new Promise((r) => app.server.close(r));
  }
});
test("missing target produces redacted failure evidence", async () => {
  const app = await startApp();
  let surface;
  try {
    surface = await BrowserSurface.open(app.origin);
    await surface.enter();
    const a = capability([
      { action: "click", target: { kind: "link", name: "Open member" } },
    ]);
    const result = await replay(
      surface,
      a,
      { member: "12345" },
      { dir: "evidence/missing-target" },
    );
    assert.equal(result.status, "failure");
    assert.equal(result.code, "TARGET_AMBIGUOUS_OR_MISSING");
    assert.ok(
      (
        await fs.readFile(
          "evidence/missing-target/failure.snapshot.txt",
          "utf8",
        )
      ).includes("Member search"),
    );
  } finally {
    await surface?.close();
    await new Promise((r) => app.server.close(r));
  }
});
