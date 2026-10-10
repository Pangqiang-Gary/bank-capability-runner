const actions = ["fill", "click"];
const keys = (x, allowed) => Object.keys(x).every((k) => allowed.includes(k));
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function validateArtifact(a) {
  assert(
    a && a.schemaVersion === 1 && a.vendor === "harbor-v1",
    "Unsupported capability version/vendor",
  );
  assert(
    a.name === "review_savings" &&
      a.inputs?.member?.type === "string" &&
      a.inputs.member.pattern === "^[0-9]{5}$",
    "Invalid input contract",
  );
  assert(
    a.outputs?.balance?.type === "number" &&
      a.outputs?.currency?.type === "string",
    "Invalid output contract",
  );
  for (const [name, field] of Object.entries(a.outputs)) {
    assert(
      ["balance", "currency"].includes(name) &&
        field.target?.kind === "label" &&
        typeof field.target.name === "string",
      "Invalid output target",
    );
  }
  assert(
    Array.isArray(a.steps) && a.steps.length > 0 && a.steps.length <= 20,
    "Invalid steps",
  );
  for (const s of a.steps) {
    assert(
      keys(s, ["action", "target", "input"]) && actions.includes(s.action),
      "Invalid action",
    );
    assert(
      s.target &&
        keys(s.target, ["kind", "name"]) &&
        ["label", "button", "link"].includes(s.target.kind) &&
        typeof s.target.name === "string" &&
        s.target.name.length < 100,
      "Invalid locator",
    );
    assert(
      s.action === "fill"
        ? s.input === "member" && s.target.kind === "label"
        : !("input" in s),
      "Only typed parameter references may be recorded",
    );
  }
  assert(
    JSON.stringify(a.checkpoint) ===
      JSON.stringify({ heading: "Balance review" }),
    "Invalid checkpoint",
  );
  return a;
}
function validateInputs(a, p) {
  validateArtifact(a);
  assert(
    keys(p, ["member"]) &&
      typeof p.member === "string" &&
      /^\d{5}$/.test(p.member),
    "Invalid input: member must be five digits",
  );
}
function capability(steps) {
  return validateArtifact({
    schemaVersion: 1,
    name: "review_savings",
    vendor: "harbor-v1",
    revision: 1,
    description:
      "Search a synthetic member and read savings balance at a review checkpoint.",
    inputs: {
      member: { type: "string", pattern: "^[0-9]{5}$", sensitive: true },
    },
    outputs: {
      balance: {
        type: "number",
        sensitive: true,
        target: { kind: "label", name: "Savings balance" },
      },
      currency: { type: "string", target: { kind: "label", name: "Currency" } },
    },
    steps,
    checkpoint: { heading: "Balance review" },
    targeting:
      "Exact accessible names; unique match required; no coordinate or index fallback.",
  });
}
module.exports = { validateArtifact, validateInputs, capability, assert };
