const { chromium } = require("playwright");
const { Policy, redact } = require("./policy");
const { assert } = require("./contracts");
class BrowserSurface {
  static async open(origin, { headed = false, policy = {} } = {}) {
    const browser = await chromium.launch({
      headless: !headed,
      channel: process.env.BROWSER_CHANNEL || "chrome",
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const surface = new BrowserSurface(
      browser,
      context,
      page,
      new Policy(origin, policy),
    );
    await context.route("**/*", (route) => {
      try {
        surface.policy.url(route.request().url());
        return route.continue();
      } catch {
        return route.abort();
      }
    });
    page.on("dialog", async (d) => {
      surface.dialog = d.message();
      await d.dismiss();
    });
    await page.exposeBinding("operatorEvent", (_, event) => {
      if (surface.owner === "human")
        surface.humanEvents.push({
          type: event.type,
          control: redactedControl(event.control),
        });
    });
    await page.addInitScript(() => {
      for (const type of ["click", "change"])
        document.addEventListener(
          type,
          (e) =>
            window.operatorEvent({
              type,
              control:
                e.target.getAttribute("aria-label") ||
                e.target.labels?.[0]?.textContent ||
                e.target.textContent?.slice(0, 80) ||
                e.target.tagName,
            }),
          true,
        );
    });
    return surface;
  }
  constructor(browser, context, page, policy) {
    Object.assign(this, {
      browser,
      context,
      page,
      policy,
      owner: "automation",
      humanEvents: [],
      dialog: null,
    });
    page.setDefaultTimeout(2500);
    page.setDefaultNavigationTimeout(10000);
  }
  locator(t) {
    return t.kind === "label"
      ? this.page.getByLabel(t.name, { exact: true })
      : this.page.getByRole(t.kind, { name: t.name, exact: true });
  }
  async enter(mode = "normal") {
    await this.page.goto(`${this.policy.origin}/?mode=${mode}`);
  }
  async observe() {
    this.policy.url(this.page.url());
    const snap = await this.page.locator("body").ariaSnapshot();
    return redact(snap);
  }
  async action(a, inputs) {
    assert(this.owner === "automation", "SESSION_OWNED_BY_HUMAN");
    this.policy.url(this.page.url());
    this.policy.action(a);
    const loc = this.locator(a.target);
    assert((await loc.count()) === 1, "TARGET_AMBIGUOUS_OR_MISSING");
    if (a.action === "fill") {
      assert(a.input === "member", "INVALID_PARAMETER");
      await loc.fill(inputs.member);
    } else {
      await loc.click();
      await this.page.waitForLoadState("domcontentloaded");
    }
    this.policy.url(this.page.url());
  }
  async state() {
    if (this.dialog) {
      const text = this.dialog;
      this.dialog = null;
      return {
        kind: "failure",
        code: "UNEXPECTED_DIALOG",
        observed: redact(text),
      };
    }
    for (const [heading, kind, code] of [
      ["Member not found", "business_outcome", "NOT_FOUND"],
      ["Validation error", "business_outcome", "INVALID_REFERENCE"],
      ["Permission denied", "failure", "PERMISSION_DENIED"],
      ["Session expired", "intervention", "SESSION_EXPIRED"],
      ["Maintenance notice", "recoverable", "MAINTENANCE_NOTICE"],
    ]) {
      if (
        await this.page
          .getByRole("heading", { name: heading, exact: true })
          .count()
      )
        return { kind, code, observed: heading };
    }
    return null;
  }
  async outputs(contract) {
    assert(
      (await this.page
        .getByRole("heading", {
          name: contract.checkpoint.heading,
          exact: true,
        })
        .count()) === 1,
      "CHECKPOINT_NOT_MET",
    );
    const out = {};
    for (const [name, field] of Object.entries(contract.outputs)) {
      const loc = this.locator(field.target);
      assert((await loc.count()) === 1, "OUTPUT_TARGET_AMBIGUOUS_OR_MISSING");
      const raw = await loc.innerText();
      assert(
        field.type !== "number" || /^\d+\.\d{2}$/.test(raw),
        "OUTPUT_CONTRACT_FAILED",
      );
      out[name] = field.type === "number" ? Number(raw) : raw;
    }
    assert(out.currency === "USD", "OUTPUT_CONTRACT_FAILED");
    return out;
  }
  async evidence(dir) {
    const fs = require("node:fs/promises");
    await fs.writeFile(
      `${dir}/failure.snapshot.txt`,
      await this.observe().catch(
        () => "Surface unavailable or outside permitted route",
      ),
    ); /* raw screenshots intentionally not retained: financial data may be visible */
  }
  async close() {
    await this.browser.close();
  }
}
function redactedControl(x) {
  return redact(x);
}
module.exports = { BrowserSurface };
