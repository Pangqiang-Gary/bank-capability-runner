const fs = require("node:fs/promises");
const path = require("node:path");
const { capability, validateArtifact, validateInputs } = require("./contracts");
const { redact } = require("./policy");
const { decide } = require("./model");
const { handoff } = require("./handoff");
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        ["balance", "member", "password", "token", "secret"].includes(k)
          ? "[REDACTED]"
          : scrub(v),
      ]),
    );
  return typeof value === "string" ? redact(value) : value;
}
async function logger(dir) {
  await fs.mkdir(dir, { recursive: true });
  const events = [];
  return {
    log: (type, data) =>
      events.push({
        time: new Date().toISOString(),
        type,
        ...scrub(data || {}),
      }),
    flush: () =>
      fs.writeFile(
        path.join(dir, "run.jsonl"),
        events.map((x) => JSON.stringify(x)).join("\n") + "\n",
      ),
  };
}
async function settle(surface, log, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await surface.state();
    if (!state) return null;
    log("state", state);
    if (state.kind === "recoverable") {
      await surface.action(
        { action: "click", target: { kind: "link", name: "Continue" } },
        {},
      );
      continue;
    }
    if (state.kind === "intervention" && options.handoff) {
      await handoff(
        surface,
        {
          ...state,
          ...options.context,
          observed: await surface.observe(),
        },
        log,
        options.handoff,
      );
      continue;
    }
    return state;
  }
  return { kind: "failure", code: "RECOVERY_EXHAUSTED" };
}
async function discover(
  surface,
  { goal, inputs, dir, maxSteps = 12, ...options },
) {
  const l = await logger(dir);
  const steps = [];
  let result;
  try {
    validateInputs(
      capability([
        {
          action: "fill",
          target: { kind: "label", name: "Member reference" },
          input: "member",
        },
      ]),
      inputs,
    );
    const started = Date.now();
    for (let i = 0; i < maxSteps; i++) {
      if (Date.now() - started > 180000) throw new Error("DISCOVERY_TIMEOUT");
      const state = await settle(surface, l.log, {
        ...options,
        context: { capability: "review_savings", goal: redact(goal), step: i },
      });
      if (state) {
        result = { status: state.kind, ...state };
        break;
      }
      const observation = await surface.observe();
      const { decision: d, receipt } = await decide(goal, observation, steps);
      l.log("model_decision", { step: i, observation, decision: d, receipt });
      if (d.action === "finish") {
        const a = capability(steps);
        const outputs = await surface.outputs(a);
        await fs.writeFile(
          path.join(dir, "capability.json"),
          JSON.stringify(a, null, 2),
        );
        result = { status: "success", outputs, modelCalls: i + 1 };
        break;
      }
      if (d.action === "escalate") {
        if (!options.handoff) throw new Error("DISCOVERY_STUCK");
        await handoff(
          surface,
          {
            code: "DISCOVERY_STUCK",
            capability: "review_savings",
            goal: redact(goal),
            step: i,
            observed: await surface.observe(),
          },
          l.log,
          options.handoff,
        );
        continue;
      }
      const action = {
        action: d.action,
        target: { kind: d.kind, name: d.name },
        ...(d.action === "fill" ? { input: d.input } : {}),
      };
      surface.policy.action(action);
      if (JSON.stringify(steps.at(-1)) === JSON.stringify(action))
        throw new Error("REPEATED_ACTION");
      await surface.action(action, inputs);
      steps.push(action);
      l.log("action", { step: i, action });
    }
    if (!result) throw new Error("STEP_LIMIT");
  } catch (e) {
    result = { status: "failure", code: e.message, step: steps.length };
    await surface.evidence(dir);
    l.log("failure", result);
  }
  l.log("result", result);
  await l.flush();
  await fs.writeFile(
    path.join(dir, "result.json"),
    JSON.stringify(
      {
        ...result,
        outputs: result.outputs
          ? { balance: "[REDACTED]", currency: result.outputs.currency }
          : undefined,
      },
      null,
      2,
    ),
  );
  return result;
}
async function replay(surface, a, inputs, { dir, ...options }) {
  const l = await logger(dir);
  let step = 0,
    result;
  try {
    validateArtifact(a);
    validateInputs(a, inputs);
    l.log("start", { capability: a.name, revision: a.revision, modelCalls: 0 });
    for (; step < a.steps.length; step++) {
      const state = await settle(surface, l.log, {
        ...options,
        context: { capability: a.name, step, expected: a.steps[step].target },
      });
      if (state) {
        result = { status: state.kind, ...state, step };
        break;
      }
      const action = a.steps[step];
      l.log("action", { step, action });
      await surface.action(action, inputs);
    }
    if (!result) {
      const state = await settle(surface, l.log, {
        ...options,
        context: { capability: a.name, step, expected: a.checkpoint },
      });
      result = state
        ? { status: state.kind, ...state, step }
        : {
            status: "success",
            outputs: await surface.outputs(a),
            modelCalls: 0,
          };
    }
  } catch (e) {
    result = {
      status: "failure",
      code: e.message,
      step,
      expected: a.steps?.[step]?.target || a.checkpoint,
      observed: await surface.observe().catch(() => "surface unavailable"),
    };
    if (options.handoff) {
      try {
        await handoff(surface, result, l.log, options.handoff);
        result = {
          status: "success",
          outputs: await surface.outputs(a),
          modelCalls: 0,
          humanCompleted: true,
        };
      } catch (h) {
        result = { ...result, handoffError: h.message };
      }
    }
  }
  if (result.status !== "success" && result.status !== "business_outcome")
    await surface.evidence(dir);
  l.log("result", result);
  await l.flush();
  await fs.writeFile(
    path.join(dir, "result.json"),
    JSON.stringify(
      {
        ...result,
        outputs: result.outputs
          ? { balance: "[REDACTED]", currency: result.outputs.currency }
          : undefined,
      },
      null,
      2,
    ),
  );
  return result;
}
module.exports = { discover, replay };
