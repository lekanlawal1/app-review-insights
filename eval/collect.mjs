// Builds the sample a person labels, using the same prompt, schema and checks as the live page.
//
//   GEMINI_API_KEY=... node eval/collect.mjs
//
// For each app: fetch the latest reviews from Apple's public feed, ask Gemini for themes through the
// Worker's own code (worker/src/index.js), check them with site/analysis.js, then draw a random sample
// of reviews. Two files come out:
//   site/eval/sample.json  the reviews and the theme list, which is all a labeller sees
//   eval/ai.json           what the AI assigned to each sampled review, kept apart so labelling is blind
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { promptFor, gemini, MODEL, PROMPT_VERSION } from "../worker/src/index.js";

const A = createRequire(import.meta.url)("../site/analysis.js");
const APPS = [
  { id: "1403491709", name: "Wealthsimple", country: "ca" },
  { id: "1058959277", name: "Uber Eats", country: "ca" },
];
const SAMPLE = 50;          // reviews per app
const SEED = 20261111;      // fixed, so the draw can be repeated
const MIN_CHARS = 25;       // a few words at least; "Great" tells nobody anything

function rng(seed) {        // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchReviews(app) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://itunes.apple.com/${app.country}/rss/customerreviews/page=${page}/id=${app.id}/sortby=mostrecent/json`;
    const res = await fetch(url);
    if (!res.ok) break;
    const got = A.parsePage(await res.json());
    if (!got.length) break;
    all.push(...got);
    await new Promise((r) => setTimeout(r, 400));
  }
  return A.dedupe(all).slice(0, 500);
}

const sample = { generated: new Date().toISOString().slice(0, 10), model: MODEL, prompt: PROMPT_VERSION, seed: SEED, apps: [] };
const ai = { model: MODEL, prompt: PROMPT_VERSION, apps: [] };

for (const app of APPS) {
  const reviews = await fetchReviews(app);
  console.log(app.name, "reviews fetched:", reviews.length);
  const sent = reviews.map((r) => ({ id: r.id, rating: r.rating, title: r.title, text: r.text }));
  const out = await gemini({ GEMINI_API_KEY: process.env.GEMINI_API_KEY.trim() }, promptFor(app.name, sent));
  const { themes, report } = A.checkThemes(reviews, out);
  console.log("  themes:", themes.length, "quotes verified:", report.quotesVerified + "/" + report.quotesProposed,
    "coverage:", (report.coverage * 100).toFixed(0) + "%");

  const rand = rng(SEED + Number(app.id) % 1000);
  const pool = reviews.map((r, i) => i).filter((i) => (reviews[i].title + reviews[i].text).length >= MIN_CHARS);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picked = pool.slice(0, SAMPLE).sort((a, b) => a - b);

  sample.apps.push({
    id: app.id, name: app.name, country: app.country,
    themes: themes.map((t) => ({ id: t.id, name: t.name, kind: t.kind, summary: t.summary })),
    reviews: picked.map((i, k) => ({ k, rating: reviews[i].rating, title: reviews[i].title, text: reviews[i].text, date: reviews[i].date })),
  });
  ai.apps.push({
    id: app.id, reviewsFetched: reviews.length,
    assignments: Object.fromEntries(picked.map((i, k) => [k, themes.filter((t) => t.members.includes(i)).map((t) => t.id)])),
  });
}

writeFileSync(new URL("../site/eval/sample.json", import.meta.url), JSON.stringify(sample, null, 1) + "\n");
writeFileSync(new URL("./ai.json", import.meta.url), JSON.stringify(ai, null, 1) + "\n");
console.log("wrote site/eval/sample.json and eval/ai.json");
