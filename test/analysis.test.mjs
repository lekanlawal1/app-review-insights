// node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const A = require("../site/analysis.js");
const page = JSON.parse(readFileSync(new URL("./fixtures/wealthsimple_ca_page1.json", import.meta.url)));
const reviews = A.parsePage(page);

test("parses a real page of Apple's review feed", () => {
  assert.equal(reviews.length, 50);
  for (const r of reviews) {
    assert.ok(r.rating >= 1 && r.rating <= 5);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.id && typeof r.text === "string");
  }
});

test("summary counts every star rating once", () => {
  const s = A.summary(reviews);
  assert.equal(s.distribution.reduce((a, b) => a + b, 0), 50);
  assert.ok(s.from <= s.to);
});

test("weeks run Monday to Sunday and empty weeks are kept", () => {
  assert.equal(A.weekOf("2026-10-08"), "2026-10-05");   // a Thursday
  assert.equal(A.weekOf("2026-10-05"), "2026-10-05");   // a Monday
  assert.equal(A.weekOf("2026-10-11"), "2026-10-05");   // a Sunday
  const w = A.weekly([{ date: "2026-09-01", rating: 1 }, { date: "2026-09-22", rating: 5 }]);
  assert.deepEqual(w.map((x) => x.week), ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
  assert.equal(w[1].count, 0);
});

test("duplicate reviews across pages are dropped", () => {
  assert.equal(A.dedupe([...reviews, ...reviews.slice(0, 5)]).length, 50);
});

const sample = [
  { rating: 1, title: "Locked out", text: "My account was frozen for two weeks and support never answered.", date: "2026-10-01" },
  { rating: 1, title: "Support", text: "Support takes forever to reply, still waiting after 10 days.", date: "2026-10-02" },
  { rating: 5, title: "Love it", text: "Easiest investing app I have used. Fees are low.", date: "2026-10-03" },
  { rating: 4, title: "Good", text: "Great app but please add dark mode to the web version.", date: "2026-10-04" },
];

test("a quote must exist in the review it cites", () => {
  const { themes, report } = A.checkThemes(sample, { themes: [
    { id: "t1", name: "Slow support", kind: "complaint", quotes: [
      { i: 1, quote: "Support takes forever to reply" },              // real
      { i: 1, quote: "Support is the worst in Canada" },               // invented
      { i: 2, quote: "Support takes forever to reply" },               // real words, wrong review
      { i: 0, quote: "frozen" },                                       // too short to prove anything
    ] },
  ], assignments: [{ i: 0, themes: ["t1"] }, { i: 1, themes: ["t1"] }] });
  assert.equal(report.quotesProposed, 4);
  assert.equal(report.quotesVerified, 1);
  assert.equal(themes[0].quotes.length, 1);
});

test("quotes survive curly quotes, dashes and case", () => {
  const r = [{ rating: 2, title: "", text: "It’s slow — really slow.", date: "2026-10-01" }];
  const { report } = A.checkThemes(r, { themes: [{ id: "t", name: "Speed", kind: "complaint", quotes: [{ i: 0, quote: "it's slow - really slow" }] }], assignments: [{ i: 0, themes: ["t"] }] });
  assert.equal(report.quotesVerified, 1);
});

test("counts and ratings come from the reviews, not the model", () => {
  const { themes, report } = A.checkThemes(sample, { themes: [
    { id: "t1", name: "Slow support", kind: "complaint", count: 999, quotes: [] },
    { id: "t2", name: "Easy to use", kind: "praise", quotes: [] },
  ], assignments: [{ i: 0, themes: ["t1"] }, { i: 1, themes: ["t1", "t1", "nope"] }, { i: 2, themes: ["t2"] }, { i: 99, themes: ["t2"] }] });
  const support = themes.find((t) => t.id === "t1");
  assert.equal(support.count, 2);
  assert.equal(support.average, 1);
  assert.equal(report.assignmentsDropped, 2);       // the unknown theme id and the review that doesn't exist
  assert.equal(report.coverage, 0.75);
});

test("a complaint people rate highly is flagged, not trusted", () => {
  const happy = Array.from({ length: 6 }, (_, k) => ({ rating: 5, title: "", text: `Great ${k}`, date: "2026-10-01" }));
  const { themes } = A.checkThemes(happy, { themes: [{ id: "t", name: "Bugs", kind: "complaint", quotes: [] }],
    assignments: happy.map((_, i) => ({ i, themes: ["t"] })) });
  assert.equal(themes[0].doubt, true);
});

test("versions need 10 reviews to be shown", () => {
  const v = A.byVersion(reviews, 10);
  for (const x of v) assert.ok(x.count >= 10);
});

test("a quote only counts if its review is in that theme", () => {
  const { themes, report } = A.checkThemes(sample, { themes: [
    { id: "t1", name: "Slow support", kind: "complaint", quotes: [
      { i: 1, quote: "Support takes forever to reply" },              // review 1 is in the theme
      { i: 2, quote: "Easiest investing app I have used" },           // real quote, but review 2 is praise
    ] },
  ], assignments: [{ i: 1, themes: ["t1"] }, { i: 2, themes: [] }] });
  assert.equal(report.quotesVerified, 1);
  assert.deepEqual(themes[0].quotes.map((q) => q.i), [1]);
});
