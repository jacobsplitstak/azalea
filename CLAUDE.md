# CLAUDE.md — Fertility & Cycle Tracker

Instructions for continuing development on this app. Read this fully before
making changes — it captures the intent, constraints, and design philosophy
that shaped the v1 implementation.

## 1. Purpose

A focused fertility tracker for people actively trying to conceive (TTC). It
turns menstrual cycle data into actionable predictions — fertile window,
ovulation day, earliest reliable pregnancy test date — and pairs those
predictions with educational content sourced from reputable medical bodies.

It is intentionally **not** a general period-tracking, wellness, social, or
pregnancy app. The target user is someone who has decided to try for a child
and wants a clear, honest tool to time it well.

## 2. Who it's for

- People (and their partners) actively trying to conceive.
- People with limited medical literacy — explanations must be plain English.
- People who may have irregular cycles — the app must degrade gracefully and
  point them toward OPKs / BBT / a clinician when calendar math is unreliable.

## 3. How it's used

1. User opens the app, sees the **Tracker** tab and a context-aware reminder
   banner at the top.
2. User enters the first day of their last period, cycle length, period
   length, and luteal phase length (sensible defaults are pre-filled).
3. User taps **Calculate my fertile window** — results, phase timeline, and
   reminder banner update.
4. User can switch to **Calendar** to mark actual period or ovulation days.
   Logged days override predictions and feed back into the cycle stats.
5. **History** shows past cycles and surfaces pattern insights once at least
   two cycles are logged.
6. **Guide** and **Best Practices** are reference content the user can browse
   any time, filtered by category.

## 4. Architecture

- **One file, no build.** Everything lives in
  [fertility-tracker.html](fertility-tracker.html) — HTML, CSS, vanilla JS,
  all in one document. There is no bundler, no framework, no package manager.
- **External dependency:** [Tabler Icons](https://tabler.io/icons) loaded from
  a CDN for icon glyphs. Nothing else.
- **State is in-memory only.** `loggedDays`, `skippedCycles`, daily-log entries,
  etc. are lost on page refresh. This is a known limitation called out in the
  `saveDailyLog` comment and is the single highest-priority follow-up.
- **Mobile-first responsive.** Layout collapses to a single column under
  480px. Wrapper caps at 700px on larger screens.
- **Theme.** Light and dark mode supported via CSS variables under
  `:root` and `@media (prefers-color-scheme: dark)`. Brand accent is
  `#D4537E` (azalea pink). Phase colors are reused throughout — keep them
  consistent (pink = period/ovulation, green = fertile, amber = luteal,
  purple = test window, blue = follicular).

## 5. Core features (current state)

### Tracker tab — [fertility-tracker.html:362](fertility-tracker.html#L362)
- **Reminder banner** at the very top — context-aware. Icon, title, sub-text,
  background color, and pill set all change with the current cycle phase
  (`period`, `fertile`, `ovulation`, `luteal`, `test`, `none`). See
  `updateBanner()` at [fertility-tracker.html:816](fertility-tracker.html#L816).
- **Disclaimer card** explains that stats start as defaults and improve with
  logged data.
- **Cycle stats card** — three live metrics (cycle length, period length,
  luteal phase) each showing whether the value is `default`, `manual`, or
  `logged (avg of N cycles)`. Source labels are critical UX — do not remove.
- **Inputs** — date of last period + three numbers, each with optional
  plain-language help via a `?` button (`toggleHelp`).
- **Calculate button** runs `calculate()` which derives ovulation, fertile
  window, test date, and renders the six-bar phase timeline.
- **Skip cycle bar** opens a modal that lists common reasons (illness,
  stress, travel, medication, exercise/diet change, postpartum, other) and
  excludes the chosen cycle from averages. State lives in `skippedCycles`.
- **Optional daily symptom log** (collapsed by default) — cervical mucus
  (4 plain-language options), BBT in °C, energy/mood chips, free-text notes.
  Toggle pattern: `toggleOpt()`.

### Calendar tab — [fertility-tracker.html:494](fertility-tracker.html#L494)
- Monthly grid with prev/next navigation.
- Three edit modes: **Period day**, **Ovulation day**, **Erase**. Taps
  toggle in `toggleDay()`.
- **Predicted vs logged** — predicted days render at `opacity: 0.5`; logged
  days render solid. This visual distinction is core to the app's
  honesty-about-uncertainty principle.
- Legend always visible.

### History tab — [fertility-tracker.html:522](fertility-tracker.html#L522)
- Table built from period start dates the user logged on the Calendar.
- Each row: start date, period length, cycle length bar, status badge
  (Normal / Short / Long / Atypical / In progress).
- Average cycle length displayed once at least one complete cycle exists.
- **Pattern Insights** card appears at ≥2 logged cycles — analyzes variation,
  flags short/long cycles, recommends OPKs or doctor visit where appropriate.

### Guide tab — [fertility-tracker.html:541](fertility-tracker.html#L541)
- Filterable accordions. Categories: Cycle basics, Menstruation, Ovulation,
  OPKs, Conception, Early pregnancy.
- Content lives in the `gData` array at
  [fertility-tracker.html:1056](fertility-tracker.html#L1056).
- Every entry ends with a `Sources:` citation.

### Best Practices tab — [fertility-tracker.html:555](fertility-tracker.html#L555)
- Same accordion pattern as Guide. Categories: Diet, Supplements, Lifestyle,
  Male fertility, Timing.
- Content lives in the `tData` array at
  [fertility-tracker.html:1075](fertility-tracker.html#L1075).

## 6. Development philosophy

These are load-bearing — every change should respect them.

### a. Useful features, not bloat
The v1 features were selected from a review of Clue, Flo, Glow, and Natural
Cycles. The user explicitly rejected community forums, AI chatbots, generic
wellness tracking, and pregnancy mode. Before adding a feature, ask: does
this directly help someone time conception or understand their cycle? If
not, it does not belong here.

### b. Plain language by default
The target user may have no medical background. Every technical term gets a
plain-English explanation, either inline or behind a `?` help link. The
"Cycle basics" guide category exists specifically to teach the fundamentals
without jargon. New content must follow this standard.

### c. Source transparency
Every educational claim cites a reputable source. Acceptable sources used in
v1: ACOG, Mayo Clinic, Cleveland Clinic, NHS, NEJM (Wilcox et al. 1995 for
the fertile window method), Harvard (Chavarro et al. for the fertility diet),
WHO, AUA, NIMH, FDA, peer-reviewed journals (Fertil Steril, Human
Reproduction, Andrology). Do not add unsourced advice. Do not cite blogs,
influencer content, or commercial fertility brands as primary sources.

### d. Predicted vs logged
A foundational UX principle. Anything the app *predicted* from inputs must
be visually distinguishable from anything the user *confirmed* by logging.
The faded-vs-solid calendar styling, the `default / manual / logged` source
labels on cycle stats, and the disclaimer banner all enforce this.

### e. Honest about limitations
Per the published critique of period-tracker apps (cited inline at
[fertility-tracker.html:116](fertility-tracker.html#L116) in the chat
history), this app must always be clear that:
- Estimates degrade with irregular cycles.
- Calendar math is a starting point, not a confirmation.
- OPKs and BBT are more reliable than calendar prediction for pinpointing
  ovulation.
- The app is not a medical device — the footer disclaimer must stay.

### f. Calculation methods (do not change without a source)
- **Fertile window** = 5 days before ovulation through ovulation day
  (Wilcox et al., NEJM 1995).
- **Ovulation day** = last-period date + (cycle length − luteal phase).
- **Earliest pregnancy test** = ovulation day + 14 days (ACOG, NHS).
- **Normal cycle range** = 21–35 days (ACOG, WHO). Short < 24, long > 35
  used for History badge thresholds.
- **Normal luteal phase** = 12–14 days; under 10 days is flagged as
  potentially needing clinician review.

## 7. Deliberately excluded (and why)

These were proposed during the design review and explicitly rejected. Do
not silently add them; if the user changes their mind, discuss first.

| Feature | Why excluded |
|---|---|
| Community / forums / peer chat | Moderation burden; rarely stays on topic for a TTC app |
| AI chatbot / symptom checker | Existing Guide content covers what users ask; quality of competing chatbots is uneven and often behind paywall |
| Generic nutrition / habit / sleep tracking | Out of scope; focused TTC users don't miss it |
| Pregnancy mode | Separate scope — could be a future tab once TTC features are solid, not part of v1 |

## 8. Highest-priority follow-ups

In rough order of value:

1. **Persistence.** Move `loggedDays`, `skippedCycles`, daily-log entries,
   and last-used input values into `localStorage` so refresh doesn't wipe
   them. This is the single biggest gap. See the comment in `saveDailyLog()`
   at [fertility-tracker.html:712](fertility-tracker.html#L712).
2. **Notifications / reminders.** The reminder banner currently only shows
   when the app is open. A real reminder system (browser notifications or
   a service worker push, depending on deployment target) would deliver on
   the value of suggestion #3 from the review.
3. **BBT chart.** BBT entry exists but the input isn't yet graphed or
   used to confirm ovulation. The chart should overlay onto the cycle and
   flag the post-ovulation temperature rise.
4. **Cervical mucus history.** Same — the input exists but past values
   aren't surfaced anywhere.
5. **Export / share.** A "send my cycle data to my doctor" export
   (CSV or PDF) would meaningfully help users have informed conversations.
6. **Multi-cycle calendar view.** The current calendar is single-month.
   A multi-month or "next 90 days" view would help users plan around
   the fertile window.

## 9. Things not to do

- Don't introduce a build step, framework, or package manager without
  discussing first. The single-file design is a feature, not a constraint.
- Don't remove source citations from Guide / Best Practices content.
- Don't replace plain-language explanations with medical jargon.
- Don't add tracking, analytics, ads, or third-party scripts.
- Don't add medical-advice features (diagnosis, drug dosing, treatment
  recommendations) — the app educates and estimates; it does not
  prescribe.
- Don't soften the "not a medical device" footer disclaimer.

## 10. File layout

```
.
├── CLAUDE.md              — this file
├── fertility-tracker.html — the app (single file, ~1135 lines)
└── message (1).txt        — original chat history that shaped v1; keep for context
```

## 11. Where things live inside the HTML

| Concern | Location |
|---|---|
| CSS variables / theme | [fertility-tracker.html:11](fertility-tracker.html#L11) |
| Tab markup | [fertility-tracker.html:351](fertility-tracker.html#L351) |
| Reminder banner markup | [fertility-tracker.html:365](fertility-tracker.html#L365) |
| Cycle stats card | [fertility-tracker.html:381](fertility-tracker.html#L381) |
| Skip-cycle modal | [fertility-tracker.html:574](fertility-tracker.html#L574) |
| Date utilities | [fertility-tracker.html:624](fertility-tracker.html#L624) |
| `deriveStats()` (logged → cycle stats) | [fertility-tracker.html:736](fertility-tracker.html#L736) |
| `getCycleData()` (inputs → predicted dates) | [fertility-tracker.html:801](fertility-tracker.html#L801) |
| `updateBanner()` (phase-aware reminder) | [fertility-tracker.html:816](fertility-tracker.html#L816) |
| `calculate()` | [fertility-tracker.html:885](fertility-tracker.html#L885) |
| Calendar rendering | [fertility-tracker.html:939](fertility-tracker.html#L939) |
| History + pattern insights | [fertility-tracker.html:982](fertility-tracker.html#L982) |
| Guide content (`gData`) | [fertility-tracker.html:1056](fertility-tracker.html#L1056) |
| Best Practices content (`tData`) | [fertility-tracker.html:1075](fertility-tracker.html#L1075) |
