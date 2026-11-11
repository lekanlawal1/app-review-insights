// node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { score, wilson, report } from "../eval/score.mjs";

const sample = { apps: [{ id: "1", name: "Demo", themes: [{ id: "t1", name: "Crashes", kind: "complaint" }, { id: "t2", name: "Design", kind: "praise" }],
  reviews: [0, 1, 2, 3].map((k) => ({ k })) }] };
const ai = { apps: [{ id: "1", assignments: { 0: ["t1"], 1: ["t2"], 2: ["t1", "t2"], 3: [] } }] };

test("a person who agrees with the AI everywhere scores 100%", () => {
  const labels = { 1: { 0: { themes: ["t1"] }, 1: { themes: ["t2"] }, 2: { themes: ["t1", "t2"] }, 3: { themes: [] } } };
  const { total } = score(sample, ai, { labels });
  assert.equal(total.aiPairs, 4); assert.equal(total.agreed, 4);
  assert.equal(total.humanPairs, 4); assert.equal(total.found, 4);
  assert.equal(total.exact, 4);
});

test("disagreements lower precision and recall separately", () => {
  // review 0: person says Design, not Crashes (AI wrong, and missed); review 2: person adds nothing new;
  // review 3: AI chose nothing, person says Crashes (a miss)
  const labels = { 1: { 0: { themes: ["t2"] }, 1: { themes: ["t2"] }, 2: { themes: ["t1", "t2"] }, 3: { themes: ["t1"] } } };
  const { total } = score(sample, ai, { labels });
  assert.equal(total.aiPairs, 4); assert.equal(total.agreed, 3);        // t1 on review 0 is not agreed
  assert.equal(total.humanPairs, 5); assert.equal(total.found, 3);       // review 0 t2 and review 3 t1 were not found
  assert.equal(total.exact, 2);
  assert.equal(total.missed, 1);                                          // review 3
  assert.equal(total.unsupported, 0);
});

test("only labelled reviews count, and the AI choosing a theme where the person chose none is recorded", () => {
  const labels = { 1: { 0: { themes: [], none: true } } };
  const { total } = score(sample, ai, { labels });
  assert.equal(total.reviews, 1); assert.equal(total.agreed, 0); assert.equal(total.unsupported, 1);
});

test("Wilson interval is wide on a small sample and brackets the estimate", () => {
  const [lo, hi] = wilson(9, 10);
  assert.ok(lo < 0.9 && hi > 0.9 && hi - lo > 0.2);
  assert.deepEqual(wilson(0, 0), [null, null]);
});

test("the report is a table with an All row", () => {
  const labels = { 1: { 0: { themes: ["t1"] } } };
  assert.match(report(score(sample, ai, { labels })), /\| All \| 1 \| 100%/);
});
