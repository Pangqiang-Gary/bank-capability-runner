# Bank Capability Runner

A small computer-use vertical slice: a real LLM discovers a read-only workflow in a live, server-rendered banking sandbox; a reviewed, parameterized capability then replays without calling the model. Synthetic data only.

## Setup

Use Node.js 22+, npm, and installed Google Chrome. Windows, macOS and Linux are supported by Playwright. Run commands from this repository root.

```sh
npm ci
```

Discovery reads `OPENAI_API_KEY` from the environment. Never commit a key or paste it into a command that gets saved in shell history. Optional `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Responses API structured output is used with `store:false`. Replay and tests require no key and no model service. The browser defaults to installed Chrome (`channel: chrome`); set `BROWSER_CHANNEL=chromium` and run `npx playwright install chromium` to use Playwright's downloaded browser instead.

`--goal="..."` accepts a natural-language discovery goal within the savings-review contract. `--target=http://127.0.0.1:PORT` selects an already-running compatible sandbox origin; by default the CLI supplies its own ephemeral target. External targets and credentials are deliberately rejected by this demo. `--policy=path.json` loads a trusted administrator allowlist; edit `policy.json` to narrow actions/routes. Changing policy is a trusted configuration operation, not something model output can do. The engine functions can also be called with a goal and an instantiated surface directly.

## Exact demo path

```sh
node src/cli.js discover --member=12345
node src/cli.js replay --member=67890
node src/cli.js replay --member=99999
node src/cli.js replay --mode=interstitial
node src/cli.js replay --mode=timeout --headed --handoff
npm test
```

Every command starts and closes its own loopback sandbox. There is no target application API; all searches, navigation and extraction occur through browser controls. Discovery writes `evidence/discover-normal/capability.json`. Replay reads this exact artifact. A saved artifact is included so replay works before you make a model request. The second command returns `{balance:980.5,currency:"USD"}` for a different member. The third returns a known `NOT_FOUND` business outcome. Currency and balance are returned to the caller; persisted evidence redacts the balance.

For the headed handoff demo, wait for the printed operator console URL, open it in another browser tab, and use the already-open **Harbor Operations** browser window. Click **Restore sandbox session** when it expires, then **Return control to automation** in the console. The simulated expired-session mode triggers again on each new page, so repeat at each pause. Automation resumes the same Page/context and checks the final checkpoint. Click/change control names are audited; entered values are omitted. The console URL is a short-lived loopback capability token; it is not saved in evidence. Close the run if an operator cannot finish; the handoff expires after two minutes.

`--mode=permission`, `--mode=validation`, and `--mode=slow` exercise additional runtime conditions. Risky **Transfer funds** is visible at the checkpoint but outside the control and route allowlists. It cannot be executed by the agent.

## Evidence and validation

- `evidence/discover-normal/`: genuine Responses API discovery, model response IDs, token usage, redacted observations, executed actions, capability, result.
- `evidence/replay-normal/`: actual discovered capability replay, zero model calls.
- `evidence/tests-*`: actual browser replay scenarios, including changed input and business outcomes.
- `evidence/handoff-simulated-operator/`: automated test acting as the operator; real pause, same session, ownership lock and resume, but **not a recording of a human user**.
- `evidence/missing-target/`: failure and redacted accessibility snapshot, rather than a raw screenshot that could contain financial data.

See `evidence/README.md` for provenance and `REPORT.md` for the design, limitations and deliberate cuts. Core tests cover guardrails, contracts, replay, runtime errors and same-session control transfer. The fixture workflow in tests is handwritten; the normal replay demo uses the independently LLM-generated artifact.

## Layout

`app.js` is the intentionally old-style sandbox; `surface.js` owns browser perception/action; `model.js` is the isolated discovery provider; `contracts.js` defines and checks the capability; `policy.js` enforces permissions; `engine.js` orchestrates discovery/replay and logs; `handoff.js` handles ownership transfer. No scaling infrastructure or real banking integration is claimed.

API reference: [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
