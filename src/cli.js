const fs = require("node:fs/promises");
const { startApp } = require("./app");
const { BrowserSurface } = require("./surface");
const { discover, replay } = require("./engine");
async function main() {
  const command = process.argv[2] || "replay";
  if (!["discover", "replay"].includes(command))
    throw new Error("Use discover or replay");
  const arg = (name) =>
    process.argv
      .find((x) => x.startsWith(`--${name}=`))
      ?.slice(name.length + 3);
  const app = await startApp();
  let surface;
  try {
    const target = arg("target") || app.origin;
    const url = new URL(target);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/" ||
      url.search ||
      url.username ||
      url.password
    )
      throw new Error("Demo targets must be loopback sandbox origins");
    const policy = JSON.parse(
      await fs.readFile(arg("policy") || "policy.json", "utf8"),
    );
    surface = await BrowserSurface.open(url.origin, {
      headed: process.argv.includes("--headed"),
      policy,
    });
    const mode = arg("mode") || "normal";
    if (
      ![
        "normal",
        "timeout",
        "permission",
        "interstitial",
        "slow",
        "validation",
      ].includes(mode)
    )
      throw new Error("Unknown sandbox mode");
    await surface.enter(mode);
    const inputs = {
      member:
        process.argv.find((x) => x.startsWith("--member="))?.split("=")[1] ||
        "12345",
    };
    const options = {
      dir: `evidence/${command}-${mode}`,
      ...(process.argv.includes("--handoff") ? { handoff: {} } : {}),
    };
    let result;
    if (command === "discover")
      result = await discover(surface, {
        ...options,
        inputs,
        goal:
          arg("goal") ||
          "Look up the supplied member reference, open the member, and reach the savings balance review page. Read the savings balance and currency. Do not transfer funds.",
      });
    else {
      const a = JSON.parse(
        await fs.readFile("evidence/discover-normal/capability.json", "utf8"),
      );
      result = await replay(surface, a, inputs, options);
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "failure") process.exitCode = 1;
  } finally {
    await surface?.close();
    await new Promise((r) => app.server.close(r));
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
