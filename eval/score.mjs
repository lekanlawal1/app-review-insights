// Compares the AI's theme assignments with a person's labels.
//
//   node eval/score.mjs path/to/labels.json
//
// Reads site/eval/sample.json (the reviews and themes), eval/ai.json (what the AI assigned, kept apart so
// labelling was blind) and the exported labels. For the reviews a person labelled it reports:
//   precision  of the (review, theme) pairs the AI made, the share the person also made
//   recall     of the pairs the person made, the share the AI also made
//   exact      reviews where the AI's set of themes equals the person's set exactly
// with 95% Wilson intervals, since a sample of 100 is small and the page should say how small.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function wilson(hits, n, z = 1.96) {
  if (!n) return [null, null];
  const p = hits / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function score(sample, ai, given) {
  const labels = given.labels || given;
  const apps = [];
  const total = { aiPairs: 0, agreed: 0, humanPairs: 0, found: 0, reviews: 0, exact: 0, missed: 0, unsupported: 0 };
  for (const app of sample.apps) {
    const mine = labels[app.id] || {};
    const theirs = ai.apps.find((a) => a.id === app.id)?.assignments || {};
    const t = { name: app.name, aiPairs: 0, agreed: 0, humanPairs: 0, found: 0, reviews: 0, exact: 0, missed: 0, unsupported: 0, themes: {} };
    for (const th of app.themes) t.themes[th.id] = { name: th.name, kind: th.kind, ai: 0, human: 0, both: 0 };
    for (const r of app.reviews) {
      const lab = mine[r.k];
      if (!lab) continue;
      const human = new Set(lab.themes || []);
      const machine = new Set(theirs[r.k] || []);
      t.reviews++;
      for (const id of machine) { t.aiPairs++; if (t.themes[id]) t.themes[id].ai++; if (human.has(id)) { t.agreed++; if (t.themes[id]) t.themes[id].both++; } }
      for (const id of human) { t.humanPairs++; if (t.themes[id]) t.themes[id].human++; if (machine.has(id)) t.found++; }
      if (human.size === machine.size && [...human].every((id) => machine.has(id))) t.exact++;
      if (!machine.size && human.size) t.missed++;
      if (machine.size && !human.size) t.unsupported++;
    }
    apps.push(t);
    for (const k of Object.keys(total)) total[k] += t[k];
  }
  return { apps, total };
}

const pct = (x) => (x == null || Number.isNaN(x) ? "n/a" : (x * 100).toFixed(0) + "%");
const range = (h, n) => { const [a, b] = wilson(h, n); return a == null ? "" : ` (${pct(a)} to ${pct(b)})`; };

export function report(res) {
  const line = (name, t) => `| ${name} | ${t.reviews} | ${pct(t.agreed / t.aiPairs)}${range(t.agreed, t.aiPairs)} | ${pct(t.found / t.humanPairs)}${range(t.found, t.humanPairs)} | ${pct(t.exact / t.reviews)}${range(t.exact, t.reviews)} | ${t.missed} | ${t.unsupported} |`;
  const out = ["| App | Reviews labelled | Precision | Recall | Exact match | AI found no theme, person did | AI chose a theme, person none |", "|---|---|---|---|---|---|---|"];
  for (const a of res.apps) out.push(line(a.name, a));
  out.push(line("All", res.total));
  for (const a of res.apps) {
    out.push("", `**${a.name}, by theme** (AI pairs, person pairs, both)`, "", "| Theme | Kind | AI | Person | Both |", "|---|---|---|---|---|");
    for (const t of Object.values(a.themes)) out.push(`| ${t.name} | ${t.kind} | ${t.ai} | ${t.human} | ${t.both} |`);
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error("usage: node eval/score.mjs labels.json"); process.exit(1); }
  const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
  console.log(report(score(read("../site/eval/sample.json"), read("./ai.json"), JSON.parse(readFileSync(process.argv[2])))));
}
