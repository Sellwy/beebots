// First-run Setup: shown instead of the dashboard until the engine has a Jev key. No code needed: the first person to
// finish it owns the server, and it closes for good once saved (or times out after SETUP_WINDOW_MIN, until the engine
// restarts). The owner picks an owner password here for later dashboard writes. Keys go straight to the engine.
// Each bee is designed from one sentence ("how do you want this bee to trade?"). With an OpenAI key (the server's, or
// one pasted on the bees step) OpenAI invents the name, rules, coins and look, then paints the portrait. Without one,
// the owner types the bee by hand and uploads a portrait instead. A bee without its own portrait shows the placeholder
// mark, never the official bees' art.
import { useEffect, useRef, useState } from "react";
import { BEE_MARK_URL } from "./BeeMark";
import { HIVE_DISCLAIMER } from "./types";

interface StyleInfo {
  id: string;
  label: string;
  blurb: string;
  name: string;
  tagline: string;
}
interface Status {
  needed: boolean;
  timedOut: boolean;
  closesAt: number;
  secure: boolean;
  serverHasOpenAiKey: boolean;
  styles: StyleInfo[];
}
interface Design {
  name: string;
  tagline: string;
  rules: string;
  coins: string[];
  baseStyle: string;
  styleLabel: string;
  look: string;
  /** Why the bee runs on a different brain than the one it was designed for. */
  styleNote?: string;
}
/** The owner's hand-typed bee (no OpenAI key): the same fields, filled in by the owner. */
interface ManualBee {
  name: string;
  tagline: string;
  rules: string;
  /** Comma/space separated tickers; empty = any coin. */
  coins: string;
  style: string;
  look: string;
}
interface BeeDraft {
  /** What the owner typed: "How do you want this bee to trade?" (the AI path's prompt). */
  ask: string;
  /** The designed bee (null until "Create my bee"). The name and tagline stay editable. */
  design: Design | null;
  /** The hand-typed bee, used when there is no design. */
  manual: ManualBee;
  img: string | null;
  busy: "" | "design" | "paint" | "upload";
  error: string;
}

const EXAMPLES = [
  "a Trump bee that only ever trades TRUMP",
  "a sleepy bee that only buys bitcoin dips",
  "a meme-coin gremlin that chases whatever is pumping",
];

const emptyManual = (): ManualBee => ({ name: "", tagline: "", rules: "", coins: "", style: "boozy", look: "" });

/** Same rule as the engine: the official bees' names (and obvious spellings) are theirs. */
const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/bee$/, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/(ie|ey|i)$/, "y");
const RESERVED = new Set(["bizzy", "breezy", "boozy"].map(squash));
const nameProblem = (name: string): string | null =>
  !/^[\p{L}\p{N} .'_-]{1,24}$/u.test(name.trim())
    ? "Names are 1-24 letters, numbers, spaces and . ' _ -"
    : RESERVED.has(squash(name))
      ? "Bizzy, Breezy and Boozy are the official bees. Pick another name."
      : null;

const STEPS = ["The rules", "Password", "Jev", "Your bees", "The Hive", "Start"] as const;

class TimedOut extends Error {}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/setup/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (r.status === 410) throw new TimedOut(j.error ?? "Setup timed out.");
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export function Setup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [accept, setAccept] = useState({ notAdvice: false, paperDefault: false, ownRisk: false });
  const [jevKey, setJevKey] = useState("");
  const [jevOk, setJevOk] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiOk, setOpenaiOk] = useState(false);
  const [bees, setBees] = useState<BeeDraft[]>([]);
  const [hive, setHive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const fileInputs = useRef<Array<HTMLInputElement | null>>([null, null, null]);

  useEffect(() => {
    void fetch("/setup/status", { cache: "no-store" })
      .then((r) => r.json() as Promise<Status>)
      .then((s) => {
        setStatus(s);
        setBees([0, 1, 2].map(() => ({ ask: "", design: null, manual: emptyManual(), img: null, busy: "", error: "" })));
      })
      .catch(() => setError("Can't reach the engine. Give it a few seconds, then reload."));
  }, []);

  // After saving, the engine restarts. Wait for it to come back set up, then load the dashboard.
  useEffect(() => {
    if (!done) return;
    const t = setInterval(() => {
      void fetch("/profile", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((p: { setup?: boolean } | null) => {
          if (p && p.setup === false) location.reload();
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [done]);

  const hasOpenAi = openaiOk || !!status?.serverHasOpenAiKey;
  const oaBody = openaiKey ? { openaiKey } : {};

  /** The message for an error; a timed-out Setup switches the whole page to the restart hint. */
  const fail = (e: unknown) => {
    if (e instanceof TimedOut) setTimedOut(true);
    return (e as Error).message;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  };

  const patch = (i: number, p: Partial<BeeDraft>) => setBees((bs) => bs.map((b, j) => (j === i ? { ...b, ...p } : b)));

  const patchDesign = (i: number, p: Partial<Design>) => setBees((bs) => bs.map((b, j) => (j === i && b.design ? { ...b, design: { ...b.design, ...p } } : b)));

  const patchManual = (i: number, p: Partial<ManualBee>) => setBees((bs) => bs.map((b, j) => (j === i ? { ...b, manual: { ...b.manual, ...p } } : b)));

  const create = async (i: number) => {
    const b = bees[i]!;
    patch(i, { busy: "design", error: "" });
    try {
      const d = await post<Design>("design", { ...oaBody, slot: i, description: b.ask.trim() });
      // A new design is a new bee: its old portrait no longer fits.
      patch(i, { design: d, img: null, busy: "" });
    } catch (e) {
      patch(i, { busy: "", error: fail(e) });
    }
  };

  const paint = async (i: number) => {
    const b = bees[i]!;
    if (!b.design) return;
    patch(i, { busy: "paint", error: "" });
    try {
      const r = await post<{ url: string }>("paint", { ...oaBody, slot: i, name: b.design.name, look: b.design.look });
      patch(i, { img: r.url, busy: "" });
    } catch (e) {
      patch(i, { busy: "", error: `${fail(e)} You can try again.` });
    }
  };

  /** Reads the picked file and sends it as a data URL; the engine squashes it to a square JPEG. */
  const upload = (i: number, file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      patch(i, { error: "Portraits are PNG, JPEG or WebP images." });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      patch(i, { error: "That image is over 8 MB. Export it as a JPEG and try again." });
      return;
    }
    patch(i, { busy: "upload", error: "" });
    const fr = new FileReader();
    fr.onerror = () => patch(i, { busy: "", error: "Couldn't read that file. Try again." });
    fr.onload = async () => {
      try {
        const r = await post<{ url: string }>("upload", { slot: i, image: String(fr.result) });
        patch(i, { img: r.url, busy: "" });
      } catch (e) {
        patch(i, { busy: "", error: `${fail(e)} You can try again.` });
      }
    };
    fr.readAsDataURL(file);
  };

  /** The bee that will be saved: the AI design when there is one, otherwise the hand-typed one. */
  const chosen = (b: BeeDraft): { name: string; tagline: string; rules: string; coins: string[]; style: string; look: string } | null => {
    if (b.design) {
      const d = b.design;
      if (nameProblem(d.name)) return null;
      return { name: d.name.trim(), tagline: d.tagline.trim(), rules: d.rules, coins: d.coins, style: d.baseStyle, look: d.look };
    }
    const m = b.manual;
    if (!m.name.trim() || nameProblem(m.name) || m.rules.trim().length < 10) return null;
    const coins = m.coins
      .split(/[,\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 20);
    return { name: m.name.trim(), tagline: m.tagline.trim(), rules: m.rules.trim(), coins, style: m.style, look: m.look.trim() || "a bee" };
  };

  const save = () =>
    run(async () => {
      await post("save", {
        jevKey,
        ...(openaiKey ? { openaiKey } : {}),
        accept,
        ownerPassword: password,
        bees: bees.map((b) => {
          const c = chosen(b)!;
          return { name: c.name, style: c.style, tagline: c.tagline, rules: c.rules, coins: c.coins, look: c.look, image: !!b.img };
        }),
        hive,
      });
      setDone(true);
    });

  if (!status) {
    return (
      <div className="setup">
        <div className="setup-card">
          <h1>beebots</h1>
          <p className="dim">{error || "Loading…"}</p>
        </div>
      </div>
    );
  }

  if (timedOut || status.timedOut) {
    return (
      <div className="setup">
        <div className="setup-card center">
          <h1>Setup timed out</h1>
          <p>
            Setup timed out to keep this server safe. Restart the engine container (Hostinger <b>Docker Manager</b> → <b>Restart</b>, or{" "}
            <code>docker compose restart engine</code>) to open it again.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="setup">
        <div className="setup-card center">
          <h1>Starting your bees 🐝</h1>
          <p>Saved. The engine is restarting in paper trading. This page opens the dashboard as soon as it's back, usually within a minute.</p>
        </div>
      </div>
    );
  }

  const beesReady = bees.length === 3 && bees.every((b) => b.img && chosen(b));
  const anyBusy = busy || bees.some((b) => b.busy);
  const styleLabel = (id: string) => status.styles.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-head">
          <h1>beebots setup</h1>
          <ol className="setup-steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i === step ? "on" : i < step ? "done" : ""}>
                {s}
              </li>
            ))}
          </ol>
        </div>

        {!status.secure && (
          <div className="setup-warn">
            This page is on plain HTTP, so your keys travel unencrypted. For a quick paper-trading test that's a small risk. For anything longer,
            point a domain at the server and set <code>PUBLIC_DOMAIN</code> so it gets HTTPS (see the README).
          </div>
        )}

        {step === 0 && (
          <section>
            <h2>Before anything else</h2>
            <p>beebots is an experiment and a piece of open-source software, not a trading product. Tick all three to carry on.</p>
            <label className="setup-check">
              <input type="checkbox" checked={accept.notAdvice} onChange={(e) => setAccept({ ...accept, notAdvice: e.target.checked })} />
              <span>
                <b>This is not financial advice.</b> Nothing the bees do, and nothing in the video or the code, is a recommendation to buy or sell anything.
              </span>
            </label>
            <label className="setup-check">
              <input type="checkbox" checked={accept.paperDefault} onChange={(e) => setAccept({ ...accept, paperDefault: e.target.checked })} />
              <span>
                <b>My bees trade on paper.</b> They use real market prices and simulated money. Nothing touches an exchange account unless I change the
                server settings myself, on purpose.
              </span>
            </label>
            <label className="setup-check">
              <input type="checkbox" checked={accept.ownRisk} onChange={(e) => setAccept({ ...accept, ownRisk: e.target.checked })} />
              <span>
                <b>I use it at my own risk.</b> The software comes with no warranty (MIT licence). Leveraged crypto trading can lose everything you put in, and if
                I ever switch it to real money, that's on me.
              </span>
            </label>
            <div className="setup-actions">
              <button disabled={!accept.notAdvice || !accept.paperDefault || !accept.ownRisk} onClick={() => setStep(1)}>
                I agree
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h2>Pick an owner password</h2>
            <p>
              Your dashboard is public, so anything you change from it later (like joining or leaving the Hive) asks for this password. Pick one only
              you know, at least 8 characters. The server keeps only a scrambled (hashed) copy, so write it down: to reset it, run Setup again (see the
              README).
            </p>
            <input
              className="setup-input"
              type="password"
              autoComplete="new-password"
              placeholder="Owner password (8+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <input className="setup-input" type="password" autoComplete="new-password" placeholder="Type it again" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            {password.length > 0 && password.length < 8 && <p className="setup-err small">At least 8 characters.</p>}
            {password2.length > 0 && password.length >= 8 && password2 !== password && <p className="setup-err small">The two don't match yet.</p>}
            <div className="setup-actions">
              <button className="ghost" onClick={() => setStep(0)}>
                Back
              </button>
              <button disabled={password.length < 8 || password.length > 200 || password !== password2} onClick={() => setStep(2)}>
                Next
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>Your Jev key</h2>
            <p>
              Jev (from TypeSafe AI) makes every decision. Get a key at{" "}
              <a href="https://console.typesafe.ai/keys" target="_blank" rel="noopener">
                console.typesafe.ai/keys
              </a>{" "}
              — or use your OpenRouter key: Jev also runs on OpenRouter, and this server may be set up to take it here. Jev charges per decision. The
              engine caps Jev spending at $2 a day by default.
            </p>
            <input
              className="setup-input mono"
              type="password"
              autoComplete="off"
              placeholder="Jev API key (TypeSafe or OpenRouter)"
              value={jevKey}
              onChange={(e) => (setJevKey(e.target.value), setJevOk(false))}
            />
            {jevOk && <p className="setup-ok">✓ Jev answered. Key works.</p>}
            <div className="setup-actions">
              <button className="ghost" onClick={() => setStep(1)}>
                Back
              </button>
              {jevOk ? (
                <button onClick={() => setStep(3)}>Next</button>
              ) : (
                <button disabled={busy || jevKey.trim().length < 8} onClick={() => run(async () => (await post("check-jev", { key: jevKey.trim() }), setJevOk(true)))}>
                  {busy ? "Checking…" : "Check key"}
                </button>
              )}
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <h2>Design your bees</h2>
            <p>
              Three bees trade side by side and race each other. For each one: type its name, trading rules and coins, then upload a portrait. Got an
              OpenAI key? Say how the bee should trade and press <b>Create my bee</b> instead — OpenAI writes the bee and paints it. Copied a winning
              bee's rules from{" "}
              <a href="https://beebots.tech" target="_blank" rel="noopener">
                beebots.tech
              </a>
              ? Paste them in.
            </p>
            <div className="setup-bees-openai">
              <input
                className="setup-input mono"
                type="password"
                autoComplete="off"
                placeholder="OpenAI key (optional — only for designing and painting)"
                value={openaiKey}
                onChange={(e) => (setOpenaiKey(e.target.value), setOpenaiOk(false))}
              />
              {openaiOk && <p className="setup-ok">✓ OpenAI key works. Say how each bee should trade and press Create my bee.</p>}
            </div>
            <div className="setup-bees">
              {bees.map((b, i) => {
                const d = b.design;
                const problem = d ? nameProblem(d.name) : nameProblem(b.manual.name);
                const m = b.manual;
                return (
                  <div className="setup-bee" key={i} style={{ ["--bee" as string]: `var(--${["bizzy", "breezy", "boozy"][i]})` }}>
                    <div className={`setup-portrait ${b.img ? "" : "empty"}`}>
                      <img src={b.img ?? BEE_MARK_URL} alt={b.img ? `${d?.name ?? m.name ?? "bee"} portrait` : "no portrait yet"} />
                      {b.busy === "paint" && <span className="setup-portrait-busy">Painting… (~40 s)</span>}
                      {b.busy === "upload" && <span className="setup-portrait-busy">Uploading…</span>}
                    </div>
                    <label className="setup-label" htmlFor={`ask-${i}`}>
                      How do you want this bee to trade?
                    </label>
                    <textarea
                      id={`ask-${i}`}
                      className="setup-input small"
                      rows={3}
                      maxLength={400}
                      placeholder={`e.g. ${EXAMPLES[i]}`}
                      value={b.ask}
                      onChange={(e) => patch(i, { ask: e.target.value })}
                    />
                    {hasOpenAi && (
                      <button className="ghost" disabled={!!b.busy || b.ask.trim().length < 3} onClick={() => void create(i)}>
                        {b.busy === "design" ? "Designing…" : d ? "Create again" : "Create my bee"}
                      </button>
                    )}

                    {d ? (
                      <div className="setup-design">
                        <input className="setup-input setup-name" maxLength={24} value={d.name} onChange={(e) => patchDesign(i, { name: e.target.value })} aria-label="Name" />
                        {problem && <p className="setup-err small">{problem}</p>}
                        <input className="setup-input small" maxLength={40} value={d.tagline} onChange={(e) => patchDesign(i, { tagline: e.target.value })} aria-label="Tagline" />
                        <div className="setup-coins">
                          {d.coins.length ? d.coins.map((c) => <span key={c} className="coin-chip">{c}</span>) : <span className="coin-chip any">any coin</span>}
                          <span className="dim small">runs on {d.styleLabel}</span>
                        </div>
                        {d.styleNote && <p className="setup-note small">{d.styleNote}</p>}
                        <p className="setup-rules">{d.rules}</p>
                        <button className={b.img ? "ghost" : ""} disabled={!!b.busy} onClick={() => void paint(i)}>
                          {b.busy === "paint" ? "Painting… (~40 s)" : b.img ? "Paint again" : "Generate your bee's portrait"}
                        </button>
                      </div>
                    ) : (
                      <div className="setup-design">
                        <input className="setup-input setup-name" maxLength={24} placeholder="Name (e.g. Granny)" value={m.name} onChange={(e) => patchManual(i, { name: e.target.value })} aria-label="Name" />
                        {problem && <p className="setup-err small">{problem}</p>}
                        <input className="setup-input small" maxLength={40} placeholder="Tagline, e.g. the calm one (optional)" value={m.tagline} onChange={(e) => patchManual(i, { tagline: e.target.value })} aria-label="Tagline" />
                        <textarea
                          className="setup-input small"
                          rows={3}
                          maxLength={500}
                          placeholder="Trading rules, plain English (e.g. Buy BTC dips and hold them for days. Get out when the trend breaks.)"
                          value={m.rules}
                          onChange={(e) => patchManual(i, { rules: e.target.value })}
                          aria-label="Rules"
                        />
                        <input className="setup-input small mono" placeholder="Coins it may trade, e.g. BTC, ETH (empty = any coin)" value={m.coins} onChange={(e) => patchManual(i, { coins: e.target.value })} aria-label="Coins" />
                        <select className="setup-input small" value={m.style} onChange={(e) => patchManual(i, { style: e.target.value })} aria-label="Trading style">
                          {status.styles.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label} — {s.blurb}
                            </option>
                          ))}
                        </select>
                        <p className="setup-note small">
                          The engine has the final say: Trend only trades BTC and ETH, Breakout only BTC, ETH, SOL and HYPE — anything else runs on
                          Momentum. Coins must be on OKX's list.
                        </p>
                        <input className="setup-input small" maxLength={400} placeholder="What it looks like (optional, kept with the bee)" value={m.look} onChange={(e) => patchManual(i, { look: e.target.value })} aria-label="Look" />
                      </div>
                    )}

                    <input
                      ref={(el) => {
                        fileInputs.current[i] = el;
                      }}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={(e) => {
                        upload(i, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <button className={b.img ? "ghost" : ""} disabled={!!b.busy} onClick={() => fileInputs.current[i]?.click()}>
                      {b.busy === "upload" ? "Uploading…" : b.img ? "Upload again" : "Upload your bee's portrait"}
                    </button>
                    {b.error && <p className="setup-err small">{b.error}</p>}
                  </div>
                );
              })}
            </div>
            <div className="setup-actions">
              {!beesReady && <span className="dim small setup-hint">Name every bee (10+ characters of rules) and upload all three portraits to carry on.</span>}
              <button className="ghost" onClick={() => setStep(2)}>
                Back
              </button>
              <button disabled={!beesReady || anyBusy} onClick={() => setStep(4)}>
                Next
              </button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section>
            <h2>Join the Hive?</h2>
            <p>
              The Hive is a public leaderboard of everyone's bees at{" "}
              <a href="https://beebots.tech" target="_blank" rel="noopener">
                beebots.tech
              </a>
              . Your bees race everyone else's, and each fill is checked against OKX's public prices.
            </p>
            <div className="setup-hive">{HIVE_DISCLAIMER}</div>
            <div className="setup-actions">
              <button className="ghost" onClick={() => setStep(3)}>
                Back
              </button>
              <button className="ghost" onClick={() => (setHive(false), setStep(5))}>
                Not now
              </button>
              <button onClick={() => (setHive(true), setStep(5))}>Join the Hive</button>
            </div>
          </section>
        )}

        {step === 5 && (
          <section>
            <h2>Ready</h2>
            <ul className="setup-summary">
              {bees.map((b, i) => {
                const c = chosen(b);
                return (
                  <li key={i}>
                    <img src={b.img ?? BEE_MARK_URL} alt="" />
                    <span>
                      <b>{c?.name}</b> {c?.tagline && <span className="dim">{c.tagline}</span>}
                      <br />
                      <span className="dim small">{c?.coins.length ? c.coins.join(", ") : "any coin"} · {c ? styleLabel(c.style) : ""}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p>
              Each bee starts with <b>$333 of paper money</b>, and trades OKX perpetuals at real prices. The engine saves your settings, restarts, and opens
              the live dashboard. The setup page then closes for good. To run it again later, see the README.
            </p>
            <p>
              {hive
                ? "Your bees join the Hive when the engine starts. You can leave any time from the dashboard."
                : "Your bees stay off the Hive. You can join later from the dashboard."}
            </p>
            <div className="setup-actions">
              <button className="ghost" onClick={() => setStep(4)}>
                Back
              </button>
              <button disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Start paper trading"}
              </button>
            </div>
          </section>
        )}

        {error && <p className="setup-err">{error}</p>}
        <p className="setup-foot dim small">Not financial advice. Open source, MIT licence, no warranty.</p>
      </div>
    </div>
  );
}
