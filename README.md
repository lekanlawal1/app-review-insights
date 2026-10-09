# App Review Insights

Pick any iPhone app and see what its users love, hate and ask for, from its latest App Store reviews.
Ratings, trends and versions are counted exactly; an AI suggests themes, and code checks every quote it
uses before you see it.

**Live:** [lekanlawal1.github.io/app-review-insights](https://lekanlawal1.github.io/app-review-insights/)

## What it shows

- **At a glance, no AI:** the average of the latest reviews against the app's all-time rating, the share
  of 1 and 2 star reviews, the star breakdown, reviews and average rating week by week, and rating by app
  version, so you can see whether an update helped or hurt.
- **What people are saying:** themes sorted by size, each marked as a complaint, praise or a feature
  request, with real quotes, how many reviews mention it, their average rating and a weekly trend.
- **The reviews themselves,** filtered by stars or by theme.

For example, Wealthsimple's latest 500 Canadian reviews average 3.5 stars against an all-time 4.6, and
34% are 1 or 2 stars: the recent experience is a lot worse than the headline rating suggests.

## How it works

```
your browser -> Apple's review feed (up to 500 most recent reviews; both endpoints allow browser requests)
             -> analysis.js: counts, weeks, versions (no AI)
             -> Cloudflare Worker -> Gemini proposes themes, quotes and which reviews belong to each
             -> analysis.js checks the answer, then the page draws it
```

The model never produces a number. What it proposes is checked in the browser:

| Check | What happens when it fails |
|---|---|
| The quote appears word for word in the review it cites (ignoring curly quotes, dashes and case) | quote thrown out and counted |
| That review is one the model placed in the same theme | quote thrown out ("review not in this theme") |
| The theme and the review exist | the assignment is dropped |
| A "complaint" whose reviews average 4+ stars, or "praise" averaging 2 or less | shown with a warning, not trusted |

Every count, share and average comes from the reviews themselves. The page reports, for each app, how many
quotes passed, how much of the review set the themes cover, and whether complaint themes really do have
lower ratings than praise themes.

**The Worker** keeps the Gemini key secret, accepts requests only from this page, rate-limits new apps per
visitor, and caches each answer for a day per app, country and set of reviews. Reviews are public, so a
popular app costs one model call a day however many people look at it.

## Limits

- Apple publishes at most 500 recent reviews per app and country, so this covers recent months, not an
  app's whole history. Reviews in the feed are written reviews only, not star-only ratings.
- Apple limits how many searches one person can make in a minute; the quick picks look apps up by id to
  save searches.
- The checks prove quotes are real and come from the right reviews. They don't prove the AI grouped every
  review the way a person would. A hand-labelled sample would measure that, and it is the next step.

## Run it

```bash
node --test test/*.test.mjs                 # analysis: quote checks, counts, weeks, versions
(cd worker && node --test test/*.test.mjs)  # the Worker's prompt and origin check
python3 -m http.server 8799 -d site         # then open http://localhost:8799
```

Built by [Lekan Lawal](https://lekanlawal1.github.io/portfolio-site/). Replaces my earlier AI ticket
triage project, which sorted synthetic tickets: this one works on real data anyone can check.
