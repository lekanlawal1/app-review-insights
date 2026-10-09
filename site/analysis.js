/* App Review Insights: everything that turns raw App Store reviews into numbers, with no AI.
   The AI step (worker/) only proposes themes and quotes; this file checks every quote against the
   review it cites, counts each theme itself and builds every chart's data. Pure functions, so
   test/analysis.test.mjs runs them in Node without a browser. */

const ReviewAnalysis = (() => {
  // ---------------------------------------------------------------- Apple's feed
  // One page of https://itunes.apple.com/{country}/rss/customerreviews/page=N/id=APP/sortby=mostrecent/json
  function parsePage(json) {
    const entries = json?.feed?.entry;
    if (!entries) return [];
    return (Array.isArray(entries) ? entries : [entries])
      .filter((e) => e["im:rating"])                     // page 1 of older feeds starts with the app itself
      .map((e) => ({
        id: e.id.label,
        rating: Number(e["im:rating"].label),
        title: e.title?.label || "",
        text: e.content?.label || "",
        version: e["im:version"]?.label || "",
        date: (e.updated?.label || "").slice(0, 10),
      }));
  }

  // Same review on two pages (the feed shifts while it is paged): keep the first.
  function dedupe(reviews) {
    const seen = new Set();
    return reviews.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }

  // ---------------------------------------------------------------- summaries
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  function summary(reviews) {
    const dates = reviews.map((r) => r.date).filter(Boolean).sort();
    const dist = [1, 2, 3, 4, 5].map((s) => reviews.filter((r) => r.rating === s).length);
    return {
      count: reviews.length,
      from: dates[0] || null, to: dates[dates.length - 1] || null,
      average: mean(reviews.map((r) => r.rating)),
      distribution: dist,                                   // index 0 = 1 star
      lowShare: reviews.length ? (dist[0] + dist[1]) / reviews.length : null,
    };
  }

  // Monday of the ISO week a date falls in, as YYYY-MM-DD.
  function weekOf(date) {
    const d = new Date(date + "T00:00:00Z");
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }

  // Every week from the first review to the last, including empty ones (a gap is information).
  function weekly(reviews, pick = () => true) {
    if (!reviews.length) return [];
    const weeks = [...new Set(reviews.map((r) => weekOf(r.date)))].sort();
    const out = [];
    for (let w = weeks[0]; w <= weeks[weeks.length - 1];) {
      const inWeek = reviews.filter((r) => weekOf(r.date) === w);
      const picked = inWeek.filter(pick);
      out.push({ week: w, count: picked.length, total: inWeek.length, average: mean(inWeek.map((r) => r.rating)) });
      const d = new Date(w + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7); w = d.toISOString().slice(0, 10);
    }
    return out;
  }

  // Versions with enough reviews to say something (minimum 10), newest first by first appearance.
  function byVersion(reviews, minimum = 10) {
    const groups = new Map();
    for (const r of reviews) {
      if (!r.version) continue;
      if (!groups.has(r.version)) groups.set(r.version, []);
      groups.get(r.version).push(r);
    }
    return [...groups.entries()]
      .map(([version, rs]) => ({ version, count: rs.length, average: mean(rs.map((r) => r.rating)),
        lowShare: rs.filter((r) => r.rating <= 2).length / rs.length, first: rs.map((r) => r.date).sort()[0] }))
      .filter((v) => v.count >= minimum)
      .sort((a, b) => (a.first < b.first ? 1 : -1));
  }

  // ---------------------------------------------------------------- checking the AI
  // Quotes are compared after folding the differences a model introduces when copying text:
  // curly quotes, dashes, case and runs of whitespace.
  function fold(s) {
    return String(s).normalize("NFKC").replace(/[‘’‚′`]/g, "'").replace(/[“”„″]/g, "\"")
      .replace(/[‐-―−]/g, "-").replace(/…/g, "...").replace(/\s+/g, " ").trim().toLowerCase();
  }
  const MIN_QUOTE = 12;

  /** The AI's answer, checked. reviews: the array sent (index = position). ai: { themes, assignments }. */
  function checkThemes(reviews, ai) {
    const report = { quotesProposed: 0, quotesVerified: 0, quotesRejected: [], assignmentsDropped: 0 };
    const themes = [];
    const ids = new Set();
    for (const t of ai?.themes || []) {
      if (!t || typeof t.id !== "string" || ids.has(t.id) || !t.name) continue;
      ids.add(t.id);
      const quotes = [];
      for (const q of t.quotes || []) {
        report.quotesProposed++;
        const r = reviews[q?.i];
        const ok = r && typeof q.quote === "string" && fold(q.quote).length >= MIN_QUOTE
          && (fold(r.text).includes(fold(q.quote)) || fold(r.title).includes(fold(q.quote)));
        if (ok) { report.quotesVerified++; quotes.push({ i: q.i, quote: q.quote }); }
        else report.quotesRejected.push({ theme: t.name, i: q?.i, quote: q?.quote });
      }
      themes.push({ id: t.id, name: String(t.name), kind: ["complaint", "praise", "request"].includes(t.kind) ? t.kind : "complaint",
        summary: String(t.summary || ""), quotes, members: [] });
    }
    const byId = new Map(themes.map((t) => [t.id, t]));
    const covered = new Set();
    for (const a of ai?.assignments || []) {
      if (!reviews[a?.i]) { report.assignmentsDropped += (a?.themes || []).length; continue; }
      for (const id of new Set(a.themes || [])) {
        const t = byId.get(id);
        if (!t) { report.assignmentsDropped++; continue; }
        t.members.push(a.i); covered.add(a.i);
      }
    }
    // a quote is evidence for a theme only if its review is one the model put in that theme
    for (const t of themes) {
      const members = new Set(t.members);
      t.quotes = t.quotes.filter((q) => {
        if (members.has(q.i)) return true;
        report.quotesVerified--;
        report.quotesRejected.push({ theme: t.name, i: q.i, quote: q.quote, reason: "review not in this theme" });
        return false;
      });
    }
    // counts and ratings come from the reviews themselves, never from the model
    for (const t of themes) {
      const rs = t.members.map((i) => reviews[i]);
      t.count = rs.length;
      t.share = reviews.length ? rs.length / reviews.length : 0;
      t.average = mean(rs.map((r) => r.rating));
      t.weekly = weekly(reviews, (r) => rs.includes(r));
      // a "complaint" that people rate 4+ stars on average, or "praise" rated 2 or less, is labelled
      // against the evidence: shown with a warning instead of being trusted
      t.doubt = t.count >= 5 && ((t.kind === "complaint" && t.average >= 4) || (t.kind === "praise" && t.average <= 2));
    }
    themes.sort((a, b) => b.count - a.count);
    report.coverage = reviews.length ? covered.size / reviews.length : 0;
    const avgOf = (k) => mean(themes.filter((t) => t.kind === k && t.count >= 5).map((t) => t.average));
    report.complaintAverage = avgOf("complaint");
    report.praiseAverage = avgOf("praise");
    return { themes: themes.filter((t) => t.count > 0), report };
  }

  return { parsePage, dedupe, summary, weekOf, weekly, byVersion, fold, checkThemes };
})();

if (typeof module !== "undefined") module.exports = ReviewAnalysis;
