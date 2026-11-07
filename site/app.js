/* App Review Insights page. Reviews come straight from Apple (both endpoints allow browser
   requests). Everything numeric is computed by ReviewAnalysis (analysis.js); the Worker at
   window.REVIEWS_API only proposes themes and quotes, which are checked here before they are shown. */

const A = ReviewAnalysis;
const $ = (id) => document.getElementById(id);
// emojis in reviews, quotes and app names are left out of what the page shows (the checks still
// compare against the original text)
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
const STAR = '<svg class="star" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.6l2.55 5.2 5.75.84-4.15 4.05.98 5.71L10 14.7l-5.13 2.7.98-5.71L1.7 7.64l5.75-.84z" fill="currentColor"/></svg>';
const esc = (s) => String(s ?? "").replace(EMOJI, "").replace(/ {2,}/g, " ").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const API = (window.REVIEWS_API || "").replace(/\/$/, "");
const PAGES = 10;                                     // Apple serves at most 10 pages of 50
const fmt1 = (v) => (v == null ? "n/a" : v.toFixed(1));
const pct = (v) => (v == null ? "n/a" : v > 0 && v < 0.005 ? "under 1%" : `${Math.round(v * 100)}%`);
// filled stars, then the empty ones faded (not outline stars, which read as filled at small sizes)
const stars = (n) => `${STAR.repeat(n)}<span class="off">${STAR.repeat(5 - n)}</span>`;
const monthDay = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const fullDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const status = (msg, bad = false) => { $("status").textContent = msg; $("status").classList.toggle("bad", bad); };

let state = null;          // { app, country, reviews, themes, filter }

// ------------------------------------------------------------------ tooltips (hover and keyboard focus)
const tip = $("tip");
function attachTip(el, html) {
  const show = () => {
    tip.innerHTML = html; tip.hidden = false;
    const b = el.getBoundingClientRect();
    tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 10, Math.max(10, b.left + b.width / 2 - tip.offsetWidth / 2))}px`;
    tip.style.top = `${b.top + scrollY - tip.offsetHeight - 8}px`;
  };
  el.addEventListener("mouseenter", show); el.addEventListener("focus", show);
  el.addEventListener("mouseleave", () => { tip.hidden = true; }); el.addEventListener("blur", () => { tip.hidden = true; });
}

// ------------------------------------------------------------------ the hero
// The icon: a face plus 14 layers behind it, so it has thickness. Before an app is chosen the face
// is a star; after, it's the app's own App Store icon.
const hero = $("hero");
function setFace(html) {
  $("tilt").innerHTML = Array.from({ length: 14 }, (_, i) => `<i style="--z:${i + 1}"></i>`).join("") + `<div class="face">${html}</div>`;
}
setFace(`<span class="glyph">${STAR}</span>`);
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) addEventListener("pointermove", (e) => {
  const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
  $("tilt").style.setProperty("--ry", `${-26 + x * 30}deg`); $("tilt").style.setProperty("--rx", `${16 - y * 22}deg`);
});
function heroFor(app, s) {
  const h = A.headline(s.average, app.averageUserRating);
  const [lead, ...rest] = h.bottom.split(" ");
  hero.dataset.mode = "app"; hero.dataset.tone = h.tone;
  $("w1").textContent = h.top;
  $("w2").innerHTML = rest.length ? `${esc(lead)} <em>${esc(rest.join(" "))}</em>` : `<em>${esc(lead)}</em>`;
  $("s1").innerHTML = `${s.count} recent App Store reviews of ${esc(app.trackName)}, read and checked in your browser.`;
  $("s2").textContent = `${pct(s.lowShare)} of recent reviews are 1 or 2 stars. ${h.note}`;
  $("s3").textContent = `${app.trackName} · ${$("country").selectedOptions[0].text} App Store`;
  const big = (app.artworkUrl512 || app.artworkUrl100 || "").replace(/\/\d+x\d+bb\./, "/512x512bb.");
  setFace(big ? `<img src="${esc(big)}" alt="">` : `<span class="glyph">${STAR}</span>`);
  $("btns").hidden = false;
}
$("again").addEventListener("click", () => {
  hero.dataset.mode = "ask"; $("btns").hidden = true;
  $("q").focus({ preventScroll: true });
});

// ------------------------------------------------------------------ search
async function search(term) {
  const country = $("country").value;
  status("Searching the App Store...");
  $("results").hidden = true;
  try {
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${country}&limit=6`);
    if (r.status === 403 || r.status === 429) return status("Apple limits how many searches one person can make in a minute. Wait a minute and try again, or pick an app below.", true);
    const apps = (await r.json()).results || [];
    if (!apps.length) return status(`No apps found for "${term}" in that store.`, true);
    status("");
    $("results").innerHTML = apps.map((a, i) => `<button type="button" class="result" data-i="${i}">
      <img src="${esc(a.artworkUrl100)}" alt="" loading="lazy"><span><b>${esc(a.trackName)}</b>
      <small>${esc(a.sellerName)} · ${(a.userRatingCount || 0).toLocaleString("en-CA")} ratings</small></span></button>`).join("");
    $("results").hidden = false;
    $("results").querySelectorAll(".result").forEach((b) => b.addEventListener("click", () => { $("results").hidden = true; load(apps[+b.dataset.i], country); }));
    return apps;
  } catch {
    status("Couldn't reach the App Store search. Check your connection and try again.", true);
  }
}
$("search").addEventListener("submit", (e) => { e.preventDefault(); const t = $("q").value.trim(); if (t) search(t); });
// quick picks skip the search (Apple rate-limits it) and look the app up by id
async function lookup(id, country) {
  const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${country}`);
  if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? "Apple is limiting requests right now. Wait a minute and try again." : `HTTP ${r.status}`);
  return (await r.json()).results?.[0];
}
$("picks").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-id]");
  if (!b) return;
  const country = $("country").value;
  status("Looking up the app...");
  try {
    const app = await lookup(b.dataset.id, country);
    if (!app) return status("That app isn't in this country's App Store.", true);
    $("results").hidden = true; load(app, country);
  } catch (err) { status(err.message, true); }
});

// ------------------------------------------------------------------ loading reviews
async function load(app, country) {
  status(`Loading ${app.trackName}'s latest reviews...`);
  const url = (p) => `https://itunes.apple.com/${country}/rss/customerreviews/page=${p}/id=${app.trackId}/sortby=mostrecent/json`;
  const pages = await Promise.allSettled(Array.from({ length: PAGES }, (_, i) => fetch(url(i + 1)).then((r) => r.json())));
  const reviews = A.dedupe(pages.flatMap((p) => (p.status === "fulfilled" ? A.parsePage(p.value) : [])))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!reviews.length) {
    const limited = pages.some((p) => p.status === "rejected");
    return status(limited ? "Apple didn't send the reviews (it limits requests per minute). Wait a minute and try again."
      : `Apple has no written reviews for ${app.trackName} in this country's store.`, true);
  }
  status("");
  state = { app, country, reviews, themes: null, filter: { stars: 0, theme: null } };
  history.replaceState(null, "", `#${country}/${app.trackId}`);
  $("report").hidden = false;
  drawGlance();
  drawList();
  // the hero now shows this app's story; bring it into view if the visitor had scrolled
  if (scrollY > 40) scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  loadThemes();
}

// ------------------------------------------------------------------ at a glance (no AI)
function drawGlance() {
  const { app, reviews } = state;
  const s = A.summary(reviews);
  $("app-head").innerHTML = `<img src="${esc(app.artworkUrl100)}" alt=""><div><h2>${esc(app.trackName)}</h2>
    <p>${esc(app.sellerName)} · ${s.count} most recent reviews, ${fullDate(s.from)} to ${fullDate(s.to)}</p></div>`;
  const allTime = app.averageUserRating;
  heroFor(app, s);
  const tone = A.headline(s.average, allTime).tone;
  $("tiles").innerHTML = [
    [`${fmt1(s.average)}${STAR}`, "average of these recent reviews", tone],
    [allTime ? `${fmt1(allTime)}${STAR}` : "n/a", `all-time App Store rating (${(app.userRatingCount || 0).toLocaleString("en-CA")} ratings)`],
    [pct(s.lowShare), "of recent reviews are 1 or 2 stars"],
    [String(s.count), `reviews since ${monthDay(s.from)}`],
  ].map(([v, l, t]) => `<div class="tile ${t || ""}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

  // star ratings: one series, so one colour; counts are labelled on each row
  const max = Math.max(...s.distribution, 1);
  $("stars-chart").innerHTML = [5, 4, 3, 2, 1].map((n) => `<div class="hbar" tabindex="0" data-n="${n}">
    <span>${n} ${STAR}</span><span class="track"><i class="fill" style="width:${(s.distribution[n - 1] / max) * 100}%"></i></span>
    <span class="n">${s.distribution[n - 1]}</span></div>`).join("");
  $("stars-chart").querySelectorAll(".hbar").forEach((el) => {
    const n = +el.dataset.n, c = s.distribution[n - 1];
    attachTip(el, `<b>${n} star${n > 1 ? "s" : ""}</b><br>${c} reviews, ${pct(c / s.count)} of the total<br>Click to read them`);
    el.addEventListener("click", () => { state.filter = { stars: n, theme: null }; drawList(); $("list").scrollIntoView({ behavior: "smooth", block: "start" }); });
  });

  const versions = A.byVersion(reviews);
  // each version against the one before it (the next row, as the list is newest first)
  const shown = versions.slice(0, 8);
  $("versions").innerHTML = versions.length ? `<table class="ver"><thead><tr><th>Version</th><th class="fs">First seen</th>
      <th class="n">Reviews</th><th class="n">Average</th><th class="n">vs previous</th></tr></thead><tbody>${shown.map((v, i) => {
        const prev = versions[i + 1], d = prev ? v.average - prev.average : null;
        const change = d == null ? "" : Math.abs(d) < 0.05 ? "same" : `<span class="${d < 0 ? "down" : "up"}">${d < 0 ? "▼ −" : "▲ +"}${Math.abs(d).toFixed(1)}</span>`;
        return `<tr><td>${esc(v.version)}</td><td class="fs">${monthDay(v.first)}</td><td class="n">${v.count}</td><td class="n${v.average < 3 ? " low" : ""}">${fmt1(v.average)}${STAR}</td><td class="n">${change}</td></tr>`;
      }).join("")}
      </tbody></table>` : `<p class="empty">No single version has 10 or more of these reviews.</p>`;

  const w = A.weekly(reviews);
  W = Math.round(Math.min(1000, Math.max(300, $("weekly-avg").clientWidth || 760)));
  // a week is marked when it averaged under 3 stars: a bad week for any app
  $("weekly-avg").innerHTML = line(w.map((x) => ({ x: x.week, y: x.average, low: x.average != null && x.average < 3,
    tip: `<b>Week of ${monthDay(x.week)}</b><br>${x.average == null ? "no reviews" : `${fmt1(x.average)} average from ${x.total} reviews`}` })), 1, 5, allTime);
  $("weekly-legend").innerHTML = `<span><i style="border-color:var(--ink)"></i>weekly average</span>${allTime ? `<span><i style="border-color:var(--muted);border-top-style:dashed"></i>all-time ${fmt1(allTime)}${STAR}</span>` : ""}
    <span><i style="border-color:var(--peach)"></i>weeks under 3${STAR}</span>`;
  $("weekly-count").innerHTML = `<p class="chart-title">Reviews per week</p>` + columns(w.map((x) => ({ x: x.week, y: x.count, tip: `<b>Week of ${monthDay(x.week)}</b><br>${x.count} reviews` })));
  for (const id of ["weekly-count", "weekly-avg"]) $(id).querySelectorAll("[data-tip]").forEach((el) => attachTip(el, decodeURIComponent(el.dataset.tip)));
}

// Small SVG charts. One axis each; the volume and the rating are two charts, never one with two scales.
// drawn at the chart's real width, so the text stays its true size on a phone
let W = 760;
const H = 150, PAD = { l: 34, r: 8, t: 8, b: 22 };
function frame(points, yMin, yMax, ticks, bands = false) {
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  // bars sit in the middle of equal slots; line points span edge to edge
  const x = bands ? (i) => PAD.l + ((i + 0.5) / points.length) * iw
    : (i) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => PAD.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const grid = ticks.map((t) => `<line class="gridline" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${PAD.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join("");
  const step = Math.max(1, Math.ceil(points.length / 6));
  const labels = points.map((p, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${monthDay(p.x)}</text>` : "")).join("");
  return { x, y, iw, ih, grid, labels };
}
function columns(points) {
  if (!points.length) return "";
  const max = Math.max(...points.map((p) => p.y), 1);
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : max <= 100 ? 20 : 50;
  const nice = Math.ceil(max / step) * step;
  const ticks = []; for (let t = 0; t <= nice; t += step) ticks.push(t);
  const f = frame(points, 0, nice, ticks.length > 6 ? ticks.filter((_, i) => i % 2 === 0) : ticks, true);
  const bw = Math.max(2, Math.min(28, f.iw / points.length - 2));
  const bars = points.map((p, i) => p.y > 0 ? `<rect class="col" tabindex="0" data-tip="${encodeURIComponent(p.tip)}" x="${f.x(i) - bw / 2}" y="${f.y(p.y)}" width="${bw}" height="${f.y(0) - f.y(p.y)}" rx="3"/>` : "").join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reviews per week">${f.grid}<line class="baseline" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f.y(0)}" y2="${f.y(0)}"/>${bars}${f.labels}</svg>`;
}
function line(points, yMin, yMax, ref) {
  if (!points.length) return "";
  const f = frame(points, yMin, yMax, [1, 2, 3, 4, 5]);
  const refLine = ref ? `<line class="ref" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f.y(ref)}" y2="${f.y(ref)}"/><text class="ref-label" x="${W - PAD.r}" y="${f.y(ref) - 6}" text-anchor="end">all-time ${fmt1(ref)} stars</text>` : "";
  const real = points.map((p, i) => [p, i]).filter(([p]) => p.y != null);
  const area = real.length > 1 ? `<path class="area" d="M${f.x(real[0][1])},${f.y(yMin)} ${real.map(([p, i]) => `L${f.x(i)},${f.y(p.y)}`).join(" ")} L${f.x(real[real.length - 1][1])},${f.y(yMin)}Z"/>` : "";
  // break the line across empty weeks instead of drawing through them
  let d = "", pen = false;
  points.forEach((p, i) => { if (p.y == null) { pen = false; return; } d += `${pen ? "L" : "M"}${f.x(i)},${f.y(p.y)}`; pen = true; });
  const dots = points.map((p, i) => p.y == null ? "" : `<circle class="hit" tabindex="0" data-tip="${encodeURIComponent(p.tip)}" cx="${f.x(i)}" cy="${f.y(p.y)}" r="9" fill="transparent"/><circle class="dotm${p.low ? " low" : ""}" cx="${f.x(i)}" cy="${f.y(p.y)}" r="${p.low ? 4.5 : 3}"/>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average rating per week">${f.grid}${area}${refLine}<path class="line" d="${d}"/>${dots}${f.labels}</svg>`;
}
// A small trend line: fixed height, stretched to the card's width, line kept at 2px.
function sparkline(weeks) {
  const max = Math.max(...weeks.map((w) => w.count), 1), w = 300, h = 36;
  const x = (i) => (weeks.length === 1 ? w / 2 : (i / (weeks.length - 1)) * w), y = (v) => h - 2 - (v / max) * (h - 6);
  return `<p class="spark-label">Mentions per week, ${monthDay(weeks[0].week)} to ${monthDay(weeks[weeks.length - 1].week)} (peak ${max})</p>
    <svg class="chart spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Mentions per week">
    <line class="baseline" x1="0" x2="${w}" y1="${h - 1}" y2="${h - 1}" vector-effect="non-scaling-stroke"/>
    <path class="line" vector-effect="non-scaling-stroke" d="${weeks.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.count)}`).join("")}"/></svg>`;
}

// ------------------------------------------------------------------ AI themes, checked
async function loadThemes() {
  const { app, country, reviews } = state;
  $("themes").innerHTML = `<p class="empty">Reading ${reviews.length} reviews... (usually 20 to 40 seconds the first time someone looks at an app)</p>`;
  $("checks").textContent = ""; $("themes-sub").textContent = "";
  if (!API) { $("themes").innerHTML = `<p class="empty">The AI service isn't connected yet. Everything above is exact and works without it.</p>`; return; }
  if (reviews.length < 20) { $("themes").innerHTML = `<p class="empty">Too few reviews for themes to mean anything.</p>`; return; }
  try {
    const res = await fetch(`${API}/themes`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: app.trackId, country, appName: app.trackName,
        reviews: reviews.map(({ id, rating, title, text }) => ({ id, rating, title, text })) }) });
    const ai = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(ai.error || `HTTP ${res.status}`);
    if (state?.app.trackId !== app.trackId) return;                     // the visitor moved on
    const { themes, report } = A.checkThemes(reviews, ai);
    state.themes = themes;
    drawThemes(themes, report, ai.cached);
    drawList();
  } catch (err) {
    $("themes").innerHTML = `<p class="empty">The themes couldn't be worked out this time (${esc(err.message)}). The numbers above don't depend on them.</p>`;
  }
}

function drawThemes(themes, report, cached) {
  const { reviews } = state;
  $("themes-sub").textContent = `${themes.length} themes across ${reviews.length} reviews, largest first. Counts and ratings are worked out from the reviews, not by the AI.`;
  const LABEL = { complaint: "Complaint", praise: "Praise", request: "Request" };
  $("themes").className = themes.length ? "themes" : "";
  if (!themes.length) { $("themes").innerHTML = `<p class="empty">No themes came back.</p>`; }
  else {
    // a list of every theme, beside the open one: its summary, its checked quotes, its trend
    const open = (id) => {
      const t = themes.find((x) => x.id === id) || themes[0];
      $("themes").querySelectorAll(".trow").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === t.id)));
      $("theme-open").innerHTML = `<span class="kicker t-${t.kind}">${LABEL[t.kind]} · ${t.count} reviews (${pct(t.share)}) · average ${fmt1(t.average)} stars</span>
        <h3>${esc(t.name)}</h3><p class="summary">${esc(t.summary)}</p>
        ${t.quotes.map((q) => { const r = reviews[q.i]; return `<blockquote>“${esc(q.quote)}”<small><span class="st">${stars(r.rating)}</span> · ${fullDate(r.date)}${r.version ? ` · version ${esc(r.version)}` : ""}</small></blockquote>`; }).join("")}
        ${t.doubt ? `<p class="doubt">Check this one: the AI called it ${t.kind === "complaint" ? "a complaint, but these reviews average 4 stars or more" : "praise, but these reviews average 2 stars or less"}.</p>` : ""}
        ${t.weekly.length > 1 ? `<div class="spark-wrap">${sparkline(t.weekly)}</div>` : ""}
        <button class="pill more" type="button" data-theme="${t.id}">Read all ${t.count} reviews</button>`;
      $("theme-open").querySelector(".more").addEventListener("click", () => {
        state.filter = { stars: 0, theme: t.id }; drawList(); $("list").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    $("themes").innerHTML = `<div class="tlist" role="group" aria-label="Themes">${themes.map((t) => `<button type="button" class="trow" data-theme="${t.id}" aria-pressed="false">
        <span><b><span class="k ${t.kind}"></span>${esc(t.name)}</b><small>${LABEL[t.kind]} · ${t.count} reviews · ${pct(t.share)}</small></span>
        <em class="t-${t.kind}">${fmt1(t.average)}${STAR}</em></button>`).join("")}</div>
      <article class="theme" id="theme-open" aria-live="polite"></article>`;
    $("themes").querySelectorAll(".trow").forEach((b) => b.addEventListener("click", () => open(b.dataset.theme)));
    // open the biggest complaint first, if there is one: that's usually why someone is looking
    open((themes.find((t) => t.kind === "complaint") || themes[0]).id);
  }
  const rejected = report.quotesProposed - report.quotesVerified;
  $("checks").innerHTML = `Checked in your browser: ${report.quotesVerified} of ${report.quotesProposed} AI quotes found word for word in a review that belongs to their theme`
    + `${rejected ? ` (${rejected} thrown out)` : ""}; ${pct(report.coverage)} of reviews placed in at least one theme`
    + (report.complaintAverage != null && report.praiseAverage != null
      ? `; complaint themes average ${fmt1(report.complaintAverage)} stars and praise themes ${fmt1(report.praiseAverage)} stars` : "")
    + `.${cached ? " These themes were worked out earlier today for the same reviews." : ""}`;
}

// ------------------------------------------------------------------ the reviews themselves
function drawList() {
  const { reviews, themes, filter } = state;
  const theme = themes?.find((t) => t.id === filter.theme);
  const buttons = [`<button type="button" data-s="0" aria-pressed="${!filter.stars && !theme}">All ${reviews.length}</button>`]
    .concat([5, 4, 3, 2, 1].map((n) => `<button type="button" data-s="${n}" aria-pressed="${filter.stars === n}" aria-label="${n} stars">${n} ${STAR}</button>`))
    .concat(theme ? [`<button type="button" aria-pressed="true" data-s="0">${esc(theme.name)} ×</button>`] : []);
  $("filters").innerHTML = buttons.join("");
  $("filters").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { state.filter = { stars: +b.dataset.s, theme: null }; drawList(); }));
  let shown = reviews.map((r, i) => ({ r, i }));
  if (filter.stars) shown = shown.filter(({ r }) => r.rating === filter.stars);
  if (theme) shown = shown.filter(({ i }) => theme.members.includes(i));
  const LIMIT = 60;
  $("list").innerHTML = shown.slice(0, LIMIT).map(({ r }) => `<article class="review">
      <div class="meta"><span class="stars" role="img" aria-label="${r.rating} stars">${stars(r.rating)}</span>${fullDate(r.date)}${r.version ? ` · version ${esc(r.version)}` : ""}</div>
      <b>${esc(r.title)}</b><p>${esc(r.text)}</p></article>`).join("")
    + (shown.length > LIMIT ? `<p class="note">Showing the newest ${LIMIT} of ${shown.length}.</p>` : "")
    + (!shown.length ? `<p class="empty">No reviews match.</p>` : "");
}

// redraw the charts at the new width when the window changes size
let resizeTimer, lastWidth = innerWidth;
addEventListener("resize", () => {
  if (innerWidth === lastWidth) return;          // phones fire resize when the address bar hides
  lastWidth = innerWidth; clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state) drawGlance(); }, 250);
});

// ------------------------------------------------------------------ a shared link opens the same app
(async () => {
  const m = location.hash.match(/^#([a-z]{2})\/(\d+)$/);
  if (!m) return;
  $("country").value = m[1];
  try {
    const app = await lookup(m[2], m[1]);
    if (app) load(app, m[1]);
  } catch (err) { status(err.message, true); }
})();
