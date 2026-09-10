import { useState, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  loadAllAppData,
  exportProfileData,
  importProfileData,
  searchCoaches,
  watchMyCoachLinks,
  applyToCoach,
  withdrawCoachRequest,
  disconnectCoachLink,
} from "./storage.js";

export const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
@media print {
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  * { color: #14291F !important; background: #ffffff !important; border-color: #ccc !important; box-shadow: none !important; }
}
.print-only { display: none; }
.home-info-tooltip { display: none; }
/* Only show the hover tooltip on devices that actually have a mouse (hover: hover) — touchscreens
   don't get a real hover state, and some mobile browsers fake one on first-tap, which is more
   confusing than helpful. Tap-to-open still works everywhere via onClick regardless. */
@media (hover: hover) and (pointer: fine) {
  .home-info-btn:hover .home-info-tooltip { display: block; }
}`;

export const COLORS = {
  turfDark: "#14291F",
  turf: "#1D3A2B",
  fairway: "#2F6B4F",
  fairwayLight: "#4C8A68",
  cream: "#F1EAD6",
  creamDim: "#E4DBC2",
  flag: "#C1440E",
  sand: "#C9A66B",
};

// Real static asset (see public/logo.png) rather than an inline data URI — this is a normal
// deployed web app with a public folder, unlike the Claude-artifact demo this was designed
// alongside, which has to inline images as base64 since it has no separate asset pipeline.
export const LOGO_SRC = "/logo.png";
// Composite lockup: same icon, with PLAYER baked into the image itself (not a separate text
// badge) so it reads as one mark. Used on the prominent auth screen; the compact in-app header
// keeps the plain icon + a live PlayerBadge since baked-in text is illegible at 20px.
export const LOGO_PLAYER_SRC = "/logo-player.png";

export function PlayerBadge({ style }) {
  return (
    <div
      style={{
        display: "inline-block",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        letterSpacing: 1.5,
        color: COLORS.turfDark,
        background: COLORS.sand,
        borderRadius: 5,
        padding: "2px 7px",
        ...style,
      }}
    >
      PLAYER
    </div>
  );
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ===== Unit conversion (display layer only) =====
// Everything is stored and calculated internally in yards/feet, since that's what the sourced
// strokes-gained tables use. Metric mode converts at the edges: values typed in are converted to
// yards/feet before being stored, and stored yards/feet are converted to meters for display.
const YD_TO_M = 0.9144;
const FT_TO_M = 0.3048;

// Yard-scale distances (Range/Short Game target distances, windows) — whole-number display.
function ydsToUnitRound(yds, units) {
  return units === "metric" ? Math.round(yds * YD_TO_M) : Math.round(yds);
}
function unitToYdsRound(val, units) {
  return units === "metric" ? Math.round(val / YD_TO_M) : Math.round(val);
}
// Precise version (no rounding) for values that feed back into SG math, e.g. a typed carry distance.
function ydsToUnit(yds, units) {
  return units === "metric" ? yds * YD_TO_M : yds;
}
function unitToYds(val, units) {
  return units === "metric" ? val / YD_TO_M : val;
}

// Feet-scale distances (Putting windows/targets, short game result proximity).
function ftToUnitRound(ft, units) {
  return units === "metric" ? Math.round(ft * FT_TO_M) : Math.round(ft);
}
function unitToFtRound(val, units) {
  return units === "metric" ? Math.round(val / FT_TO_M) : Math.round(val);
}
function ftToUnit(ft, units) {
  return units === "metric" ? ft * FT_TO_M : ft;
}
function unitToFt(val, units) {
  return units === "metric" ? val / FT_TO_M : val;
}

function fmt1(v) {
  return Math.round(v * 10) / 10;
}

function longUnitLabel(units) {
  return units === "metric" ? "m" : "y";
}
function shortUnitLabel(units) {
  return units === "metric" ? "m" : "ft";
}

function randomTarget(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

// Fisher-Yates shuffle, used to randomize which distance lands at which position around the
// hole in Putting's "Around the Clock" drill (and available anywhere else a random order is
// needed) — returns a new array, leaves the input untouched.
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Green: within 5% of target. Amber: within 7%. Red: beyond that.
function ragStatus(diff, target) {
  if (!target) return "red";
  const pct = (diff / target) * 100;
  if (pct <= 5) return "green";
  if (pct <= 7) return "amber";
  return "red";
}

function ragColor(status) {
  if (status === "green") return COLORS.fairwayLight;
  if (status === "amber") return COLORS.sand;
  return COLORS.flag;
}

// Each screen's logical "parent" for the header's BACK button. A static map rather than a true
// navigation history stack — simpler and lower-risk given the app's fairly shallow, predictable
// screen hierarchy, though it means Back always returns to the same place regardless of how a
// screen was reached (e.g. Analysis always goes back to Home, even when opened via a section's
// "View analysis" link rather than the Home tile).
const BACK_MAP = {
  rangeChoose: "home",
  setup: "rangeChoose",
  practice: "setup",
  summary: "setup",
  teeaccuracy: "rangeChoose",
  teeAccuracyPractice: "teeaccuracy",
  teeAccuracySummary: "teeaccuracy",
  yardagesChoose: "home",
  wedgeMatrixSetup: "yardagesChoose",
  wedgeMatrixPractice: "wedgeMatrixSetup",
  wedgeMatrixResult: "wedgeMatrixSetup",
  gappingSetup: "yardagesChoose",
  gappingPractice: "gappingSetup",
  gappingResult: "gappingSetup",
  gappingManualClubs: "yardagesChoose",
  gappingManualEntry: "gappingManualClubs",
  shortgame: "home",
  shortGamePractice: "shortgame",
  shortGameSummary: "shortgame",
  puttingChoose: "home",
  puttingRandomSetup: "puttingChoose",
  puttingCourseSetup: "puttingChoose",
  puttingPractice: "puttingRandomSetup",
  // puttingSummary's actual back target depends on whether the just-finished session was random
  // practice or an on-course round (see the backTarget special-case near the Header render) —
  // this entry is just the fallback default.
  puttingSummary: "puttingRandomSetup",
  puttingClockIntro: "puttingChoose",
  puttingClockPlay: "puttingClockIntro",
  puttingClockSummary: "puttingClockIntro",
  puttingStartLineIntro: "puttingChoose",
  puttingStartLinePlay: "puttingStartLineIntro",
  puttingStartLineSummary: "puttingStartLineIntro",
  puttingPaceSetup: "puttingChoose",
  puttingPacePlay: "puttingPaceSetup",
  puttingPaceSummary: "puttingPaceSetup",
  analysis: "home",
  settings: "home",
  addCoach: "settings",
  competeChoose: "home",
  competeSetup: "competeChoose",
  competePlay: "competeSetup",
  competeSummary: "competeSetup",
  competeShortGameSetup: "competeChoose",
  competeShortGamePlay: "competeShortGameSetup",
  competeShortGameSummary: "competeShortGameSetup",
  competePuttingSetup: "competeChoose",
  competePuttingPlay: "competePuttingSetup",
  competePuttingSummary: "competePuttingSetup",
};

const TIMESCALES = [
  { key: "all", label: "ALL", months: null },
  { key: "12m", label: "12M", months: 12 },
  { key: "6m", label: "6M", months: 6 },
  { key: "3m", label: "3M", months: 3 },
  { key: "1m", label: "1M", months: 1 },
];

function filterByTimescale(sessions, key) {
  const scale = TIMESCALES.find((t) => t.key === key);
  if (!scale || scale.months === null) return sessions;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - scale.months);
  return sessions.filter((s) => new Date(s.date) >= cutoff);
}

// Group distances into 10y bands, e.g. "70-80"
function bucketFor(target) {
  const start = Math.floor(target / 10) * 10;
  return `${start}-${start + 10}`;
}

function bucketSortKey(label) {
  return parseInt(label.split("-")[0], 10);
}

// Flatten filtered sessions into shots tagged with date + distance bucket + miss %,
// sorted chronologically (oldest first) so we can look at trends over time.
function flattenShots(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.shots.forEach((sh) => {
        rows.push({
          date: s.date,
          target: sh.target,
          actual: sh.actual,
          signedMiss: sh.actual - sh.target, // negative = short of pin, positive = long
          diff: sh.diff,
          missPct: sh.target ? (sh.diff / sh.target) * 100 : 0,
          sg: sgForApproachShot(sh.target, sh.actual),
          bucket: bucketFor(sh.target),
        });
      });
    });
  return rows;
}

// ===== TEMP TEST DATA — remove this whole block (through generateFakeSessions) when asked =====
function generateFakeSessions(count = 18) {
  const now = new Date();
  const rangeOptions = [
    [50, 100],
    [75, 125],
    [100, 150],
    [50, 150],
    [125, 175],
    [150, 200],
  ];
  const shotCountOptions = [10, 20, 50];
  const sessions = [];
  const N = count;

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1); // 0 = oldest, 1 = newest
    const monthsAgo = 13 - progress * 13;
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    const shotCount = shotCountOptions[Math.floor(Math.random() * shotCountOptions.length)];
    const [minDist, maxDist] = rangeOptions[Math.floor(Math.random() * rangeOptions.length)];

    const shots = [];
    for (let s = 0; s < shotCount; s++) {
      const target = randomTarget(minDist, maxDist);
      let baseMissPct;
      if (target < 75) {
        baseMissPct = 4; // short game — consistently tight
      } else if (target < 125) {
        baseMissPct = 9 - progress * 4; // mid range — clear improvement over time (~9% -> ~5%)
      } else if (target < 175) {
        baseMissPct = 9.5 + progress * 1.5; // long range — slowly getting worse (~9.5% -> ~11%)
      } else {
        baseMissPct = 8.5;
      }
      const noise = (Math.random() - 0.5) * 4;
      const missPct = Math.max(0.5, baseMissPct + noise);
      const magnitude = (missPct / 100) * target;
      const sign = Math.random() < 0.5 ? -1 : 1;
      const actual = Math.max(0, Math.round(target + sign * magnitude));
      const diff = Math.abs(actual - target);
      shots.push({ target, actual, diff });
    }

    const totalDiff = shots.reduce((a, sh) => a + sh.diff, 0);
    const avgDiff = totalDiff / shots.length;

    sessions.push({
      id: uid(),
      date: date.toISOString(),
      shotCount: shots.length,
      minDist,
      maxDist,
      shots,
      totalDiff,
      avgDiff,
    });
  }

  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP TEST DATA =====

// ===== TEMP PUTTING TEST DATA — remove this whole block when asked =====
function generateFakePuttingSessions(count = 18) {
  const now = new Date();
  const rangeOptions = [
    [0, 10],
    [0, 20],
    [10, 30],
    [0, 30],
    [20, 40],
    [10, 40],
  ];
  const puttCountOptions = [9, 18, 27];
  const sessions = [];
  const N = count;

  // Draws a putt outcome (1/2/3) given a mean-strokes target, biased toward whole outcomes.
  function drawStrokes(meanStrokes) {
    const r = Math.random();
    if (meanStrokes <= 1.3) {
      // mostly 1-putts, occasional 2
      return r < 0.75 ? 1 : r < 0.98 ? 2 : 3;
    }
    if (meanStrokes <= 1.9) {
      return r < 0.35 ? 1 : r < 0.92 ? 2 : 3;
    }
    if (meanStrokes <= 2.3) {
      return r < 0.15 ? 1 : r < 0.78 ? 2 : 3;
    }
    return r < 0.08 ? 1 : r < 0.6 ? 2 : 3;
  }

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1); // 0 = oldest, 1 = newest
    const monthsAgo = 13 - progress * 13;
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    const puttCount = puttCountOptions[Math.floor(Math.random() * puttCountOptions.length)];
    const [minFt, maxFt] = rangeOptions[Math.floor(Math.random() * rangeOptions.length)];

    const putts = [];
    for (let p = 0; p < puttCount; p++) {
      const targetFt = randomTarget(minFt, maxFt);
      let meanStrokes;
      if (targetFt <= 10) {
        meanStrokes = 1.15; // short putts — consistently strong
      } else if (targetFt <= 20) {
        meanStrokes = 2.0 - progress * 0.45; // clear improvement over time (~2.0 -> ~1.55)
      } else if (targetFt <= 30) {
        meanStrokes = 2.15 + progress * 0.2; // slowly getting worse (~2.15 -> ~2.35)
      } else {
        meanStrokes = 2.3;
      }
      putts.push({ targetFt, strokes: drawStrokes(meanStrokes) });
    }

    const totalStrokes = putts.reduce((a, p) => a + p.strokes, 0);
    const avgStrokes = totalStrokes / putts.length;

    sessions.push({
      id: uid(),
      date: date.toISOString(),
      puttCount: putts.length,
      puttMinFt: minFt,
      puttMaxFt: maxFt,
      putts,
      totalStrokes,
      avgStrokes,
    });
  }

  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP PUTTING TEST DATA =====

// ===== TEMP ON-COURSE TEST DATA — remove this whole block when asked =====
function generateFakeCourseRounds(count = 10) {
  const now = new Date();
  const N = count;
  const rounds = [];

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1); // 0 = oldest, 1 = newest
    const monthsAgo = 5 - progress * 5; // spread over the last ~5 months
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    // Occasionally simulate a partially-logged round (a few holes skipped).
    const holesToLog = Math.random() < 0.15 ? 14 + Math.floor(Math.random() * 4) : 18;

    const putts = [];
    for (let h = 0; h < holesToLog; h++) {
      const r = Math.random();
      let targetFt;
      if (r < 0.25) targetFt = 2 + Math.floor(Math.random() * 6); // short, 2-8ft
      else if (r < 0.75) targetFt = 8 + Math.floor(Math.random() * 17); // mid, 8-25ft
      else targetFt = 25 + Math.floor(Math.random() * 25); // long, 25-50ft

      // Rough amateur-level make odds, gradually improving over the 5-month span.
      const baseline = pgaBaselinePutts(targetFt);
      const amateurPenalty = 0.18 - progress * 0.08;
      const missChance = Math.min(0.92, baseline - 1 + amateurPenalty);
      const rnd = Math.random();
      let strokes;
      if (rnd > missChance) strokes = 1;
      else if (rnd > missChance * 0.12) strokes = 2;
      else strokes = 3;

      // For sample data only: approximate the final putt distance so "feet made" has something
      // realistic to show — a made 1-putt is obviously from the target distance itself, and a
      // multi-putt clean-up is typically a short putt.
      const holedFromFt = strokes === 1 ? targetFt : 1 + Math.floor(Math.random() * 4);

      putts.push({ targetFt, strokes, holedFromFt });
    }

    const totalStrokes = putts.reduce((a, p) => a + p.strokes, 0);
    const avgStrokes = totalStrokes / putts.length;

    rounds.push({
      id: uid(),
      date: date.toISOString(),
      type: "course",
      puttCount: putts.length,
      puttMinFt: Math.min(...putts.map((p) => p.targetFt)),
      puttMaxFt: Math.max(...putts.map((p) => p.targetFt)),
      putts,
      totalStrokes,
      avgStrokes,
    });
  }

  return rounds.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP ON-COURSE TEST DATA =====

// ===== TEMP SHORT GAME TEST DATA — remove this whole block when asked =====
function generateFakeShortGameSessions(count = 15) {
  const now = new Date();
  const N = count;
  const sessions = [];
  const shotCountOptions = [9, 18, 27];
  const lieOptions = [
    ["fairway"],
    ["rough"],
    ["bunker"],
    ["fairway", "rough"],
    ["fairway", "rough", "bunker"],
  ];

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1);
    const monthsAgo = 6 - progress * 6;
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    const shotCount = shotCountOptions[Math.floor(Math.random() * shotCountOptions.length)];
    const lies = lieOptions[Math.floor(Math.random() * lieOptions.length)];
    const minYds = 5 + Math.floor(Math.random() * 10);
    const maxYds = minYds + 10 + Math.floor(Math.random() * 20);

    const shots = [];
    for (let s = 0; s < shotCount; s++) {
      const lie = lies[Math.floor(Math.random() * lies.length)];
      const target = randomTarget(minYds, maxYds);
      // Amateur-level proximity, gradually improving over time, worse from bunker/rough.
      const lieFactor = lie === "fairway" ? 1 : lie === "rough" ? 1.2 : 1.4;
      const baseProximityFt = target * 0.9 * lieFactor * (1.15 - progress * 0.35);
      const noise = (Math.random() - 0.3) * baseProximityFt * 0.6;
      const resultFt = Math.max(0.5, Math.round((baseProximityFt + noise) * 10) / 10);
      shots.push({ lie, target, resultFt });
    }

    sessions.push({
      id: uid(),
      date: date.toISOString(),
      shotCount: shots.length,
      minYds,
      maxYds,
      lies,
      shots,
      avgResultFt: avg(shots.map((s) => s.resultFt)),
    });
  }

  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP SHORT GAME TEST DATA =====

// ===== TEMP TEE ACCURACY TEST DATA — remove this whole block when asked =====
function generateFakeTeeSessions(count = 12) {
  const now = new Date();
  const N = count;
  const sessions = [];
  const shotCountOptions = [10, 20, 30];
  const clubSetOptions = [
    ["driver"],
    ["driver", "fairway"],
    ["driver", "fairway", "hybrid", "iron"],
  ];

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1);
    const monthsAgo = 5 - progress * 5;
    const date = new Date(now);
    date.setMonth(date.getMonth() - Math.floor(monthsAgo));
    date.setDate(1 + Math.floor(Math.random() * 27));

    const shotCount = shotCountOptions[Math.floor(Math.random() * shotCountOptions.length)];
    const clubs = clubSetOptions[Math.floor(Math.random() * clubSetOptions.length)];
    const fairwayWidth = 25 + Math.floor(Math.random() * 15);

    const shots = [];
    for (let s = 0; s < shotCount; s++) {
      const club = clubs[Math.floor(Math.random() * clubs.length)];
      // Amateur-level accuracy, gradually improving over time, worse with driver than irons.
      const clubMissFactor = club === "driver" ? 1.3 : club === "fairway" ? 1.1 : club === "hybrid" ? 0.95 : 0.8;
      const baseHitChance = (0.45 + progress * 0.25) / clubMissFactor;
      shots.push({ club, hit: Math.random() < Math.min(0.9, baseHitChance) });
    }

    const hitCount = shots.filter((s) => s.hit).length;
    sessions.push({
      id: uid(),
      date: date.toISOString(),
      shotCount: shots.length,
      fairwayWidth,
      clubs,
      shots,
      hitCount,
      hitPct: (hitCount / shots.length) * 100,
    });
  }

  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
// ===== END TEMP TEE ACCURACY TEST DATA =====

const YARDAGE_PRESETS = [
  { label: "All", min: 0, max: 300 },
  { label: "25-50", min: 25, max: 50 },
  { label: "50-75", min: 50, max: 75 },
  { label: "75-100", min: 75, max: 100 },
  { label: "100-125", min: 100, max: 125 },
  { label: "125-150", min: 125, max: 150 },
  { label: "150-175", min: 150, max: 175 },
  { label: "175-200", min: 175, max: 200 },
  { label: "200-225", min: 200, max: 225 },
];

// Per-session average miss %, restricted to shots within [filterMin, filterMax], sorted chronologically.
function sessionTrendData(sessions, filterMin, filterMax) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => {
      const shots = s.shots.filter((sh) => sh.target >= filterMin && sh.target <= filterMax);
      if (!shots.length) return null;
      return {
        date: s.date,
        dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        avgMissPct: avg(shots.map((sh) => (sh.target ? (sh.diff / sh.target) * 100 : 0))),
        avgMissYds: avg(shots.map((sh) => sh.diff)),
        avgSG: avg(shots.map((sh) => sgForApproachShot(sh.target, sh.actual))),
        shotCount: shots.length,
      };
    })
    .filter(Boolean);
}

// Average miss % per 10y distance band, restricted to [filterMin, filterMax].
function bucketChartData(sessions, filterMin, filterMax) {
  const rows = flattenShots(sessions).filter((r) => r.target >= filterMin && r.target <= filterMax);
  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });
  return Object.entries(byBucket)
    .map(([label, rs]) => ({
      label,
      avgMissPct: avg(rs.map((r) => r.missPct)),
      avgMissYds: avg(rs.map((r) => r.diff)),
      avgSG: avg(rs.map((r) => r.sg)),
      count: rs.length,
    }))
    .sort((a, b) => bucketSortKey(a.label) - bucketSortKey(b.label));
}

// ===== Putting-specific helpers =====
// Putting distance bands are fixed, in feet, per the user's spec (note the 20/21 gap is intentional).
const PUTTING_BAND_ORDER = { "0-10": 0, "10-20": 1, "21-30": 2, "30+": 3 };

const FEET_PRESETS = [
  { label: "All", min: 0, max: 100 },
  { label: "0-10", min: 0, max: 10 },
  { label: "10-20", min: 10, max: 20 },
  { label: "21-30", min: 21, max: 30 },
  { label: "30+", min: 30, max: 100 },
];

function puttingBucketFor(ft) {
  if (ft <= 10) return "0-10";
  if (ft <= 20) return "10-20";
  if (ft <= 30) return "21-30";
  return "30+";
}

function puttingBucketSortKey(label) {
  return PUTTING_BAND_ORDER[label] ?? 99;
}

// 1-putt = green, 2-putt = amber, 3-putt = red. Same RAG language as the Range section.
function ragStatusForPutts(strokes) {
  if (strokes <= 1) return "green";
  if (strokes === 2) return "amber";
  return "red";
}

// ===== Putting — Pace Control drill constants =====
// Fixed distance set the player selects from (order also drives display order everywhere).
const PACE_DISTANCES_FT = [10, 20, 30, 40];
// 0-3 point scale scored by proximity to the hole once the putt has finished rolling.
const PACE_POINT_OPTIONS = [
  { points: 0, label: "0 PTS", radiusLabel: "Outside 3ft" },
  { points: 1, label: "1 PT", radiusLabel: "Within 3ft" },
  { points: 2, label: "2 PTS", radiusLabel: "Within 2ft" },
  { points: 3, label: "3 PTS", radiusLabel: "Within 1ft or holed" },
];
function paceRagColor(pct) {
  if (pct >= 66) return COLORS.fairwayLight;
  if (pct >= 40) return COLORS.sand;
  return COLORS.flag;
}
function pacePointColor(points) {
  if (points === 3) return COLORS.fairwayLight;
  if (points === 2) return COLORS.sand;
  if (points === 1) return `${COLORS.sand}99`;
  return COLORS.flag;
}

// ===== PGA Tour putting baseline (strokes gained) =====
// Source: Mark Broadie, "Putts Gained: Measuring Putting on the PGA TOUR" (Columbia University,
// 2011), Figure 1 — average number of putts to hole out by distance, computed from PGA TOUR
// ShotLink data. This is the same baseline concept the PGA Tour's own Strokes Gained: Putting
// stat is built on. It's a ~2010 snapshot, not this year's exact numbers — the Tour recomputes
// its baseline every year internally but doesn't publish the raw curve.
const PGA_PUTTING_BASELINE = [
  [2, 1.01],
  [3, 1.05],
  [4, 1.14],
  [5, 1.24],
  [6, 1.34],
  [7, 1.43],
  [8, 1.5],
  [9, 1.56],
  [10, 1.61],
  [15, 1.78],
  [20, 1.87],
  [30, 1.98],
  [40, 2.06],
  [50, 2.14],
  [60, 2.21],
  [90, 2.36],
];

// Interpolates (log-linear, matching the log-scale x-axis of Broadie's own chart) between the
// table's sparse points to estimate the baseline for any distance, e.g. 11ft or 25ft.
function pgaBaselinePutts(ft) {
  const table = PGA_PUTTING_BASELINE;
  if (ft <= 0) return 1.0;

  const [firstD, firstP] = table[0];
  if (ft <= firstD) {
    // Anchor at (0ft, 1.0 putts) since a tap-in is essentially always a single putt.
    const t = ft / firstD;
    return 1.0 + t * (firstP - 1.0);
  }

  const [lastD, lastP] = table[table.length - 1];
  if (ft >= lastD) {
    const [prevD, prevP] = table[table.length - 2];
    const t = (Math.log(ft) - Math.log(prevD)) / (Math.log(lastD) - Math.log(prevD));
    return prevP + t * (lastP - prevP); // extrapolates the final segment's slope past 90ft
  }

  for (let i = 0; i < table.length - 1; i++) {
    const [d1, p1] = table[i];
    const [d2, p2] = table[i + 1];
    if (ft >= d1 && ft <= d2) {
      const t = (Math.log(ft) - Math.log(d1)) / (Math.log(d2) - Math.log(d1));
      return p1 + t * (p2 - p1);
    }
  }
  return lastP;
}

// ===== Handicap baseline offsets =====
// Source: round-level average strokes lost per round vs PGA Tour, by category and handicap
// (Mark Broadie's research, as summarized in published strokes-gained benchmark tables). This is
// round-level data, not a full distance-by-distance curve like the tour tables above — so it's
// converted to a flat per-shot offset using standard assumptions of ~9 approach shots, ~8 short
// game shots, and ~29 putts per round. That means the offset is the same regardless of how hard
// the individual shot was, which is a real simplification: a handicap golfer's gap to tour likely
// widens on harder shots. Treat "SG vs your baseline" as a useful approximation, not a precise
// distance-calibrated model the way the tour numbers are.
const HANDICAP_STROKES_LOST_PER_ROUND = {
  tour: { approach: 0, shortgame: 0, putting: 0 },
  scratch: { approach: -1.5, shortgame: -0.5, putting: -0.4 },
  "5": { approach: -3.0, shortgame: -1.0, putting: -0.8 },
  "10": { approach: -4.5, shortgame: -1.5, putting: -1.2 },
  "15": { approach: -6.0, shortgame: -2.0, putting: -1.5 },
  "20": { approach: -7.5, shortgame: -2.5, putting: -1.8 },
  "25": { approach: -9.0, shortgame: -3.0, putting: -2.2 },
  "30": { approach: -10.5, shortgame: -3.5, putting: -2.5 },
};
const SHOTS_PER_ROUND = { approach: 9, shortgame: 8, putting: 29 };

const BASELINE_OPTIONS = [
  { key: "tour", label: "PGA TOUR" },
  { key: "scratch", label: "SCRATCH" },
  { key: "5", label: "5 HCP" },
  { key: "10", label: "10 HCP" },
  { key: "15", label: "15 HCP" },
  { key: "20", label: "20 HCP" },
  { key: "25", label: "25 HCP" },
  { key: "30", label: "30 HCP" },
];

function computeOffsets(handicapKey) {
  const perRound = HANDICAP_STROKES_LOST_PER_ROUND[handicapKey] || HANDICAP_STROKES_LOST_PER_ROUND.tour;
  return {
    approach: perRound.approach / SHOTS_PER_ROUND.approach,
    shortgame: perRound.shortgame / SHOTS_PER_ROUND.shortgame,
    putting: perRound.putting / SHOTS_PER_ROUND.putting,
  };
}

// Module-level "current baseline" — read directly by the sgFor* functions below so every call
// site in the app picks up the active baseline without needing it threaded through as a prop.
// Kept in sync with React state (which drives persistence + re-renders) via applyBaseline().
let currentOffsets = computeOffsets("tour");
function applyBaseline(handicapKey) {
  currentOffsets = computeOffsets(handicapKey);
}

// Strokes gained for a single putt: baseline expected putts from this distance, minus what was
// actually taken, adjusted for the active baseline. Positive = better than baseline, negative = worse.
function sgForPutt(targetFt, strokes) {
  return pgaBaselinePutts(targetFt) - strokes - currentOffsets.putting;
}

// ===== PGA Tour approach-shot baseline (strokes gained), fairway lie =====
// Source: Mark Broadie, "Every Shot Counts" — sampled fairway baseline values (average strokes
// to hole out by distance), the same table structure PGA Tour Strokes Gained: Approach is built
// on. Sparser than the putting table (6 points vs 16), so treat this as a rougher approximation,
// especially between 100-160yd where the sampled points are unusually flat.
const FAIRWAY_APPROACH_BASELINE = [
  [20, 2.4],
  [80, 2.75],
  [100, 2.8],
  [160, 2.85],
  [180, 3.08],
  [200, 3.19],
];

// Same log-linear interpolation approach as the putting baseline.
function pgaBaselineApproach(yds) {
  const table = FAIRWAY_APPROACH_BASELINE;
  if (yds <= 0) return 1.0;

  const [firstD, firstP] = table[0];
  if (yds <= firstD) {
    // Extrapolate the trend of the table's own first two real sample points backward (same
    // log-linear method already used to extrapolate past the last point below), instead of
    // forcing a straight line down to an artificial "0 yards = 1.0 strokes" anchor — see the
    // matching comment in interpolateBaseline() for why that anchor was producing wrong results.
    const [secondD, secondP] = table[1];
    const t = (Math.log(yds) - Math.log(firstD)) / (Math.log(secondD) - Math.log(firstD));
    return Math.max(1.0, firstP + t * (secondP - firstP));
  }

  const [lastD, lastP] = table[table.length - 1];
  if (yds >= lastD) {
    const [prevD, prevP] = table[table.length - 2];
    const t = (Math.log(yds) - Math.log(prevD)) / (Math.log(lastD) - Math.log(prevD));
    return prevP + t * (lastP - prevP);
  }

  for (let i = 0; i < table.length - 1; i++) {
    const [d1, p1] = table[i];
    const [d2, p2] = table[i + 1];
    if (yds >= d1 && yds <= d2) {
      const t = (Math.log(yds) - Math.log(d1)) / (Math.log(d2) - Math.log(d1));
      return p1 + t * (p2 - p1);
    }
  }
  return lastP;
}

// Strokes gained for a single Range shot. Two simplifying assumptions for now:
// - the lie is always fairway (uses the fairway approach baseline for the starting distance)
// - the shot always ends up on the green (the miss distance is converted to feet and run through
//   the putting baseline, rather than a separate around-the-green/rough baseline)
// SG = baseline(start distance) - baseline(distance remaining) - 1
function sgForApproachShot(targetYds, actualYds) {
  const missYds = Math.abs(actualYds - targetYds);
  const missFt = missYds * 3;
  return pgaBaselineApproach(targetYds) - pgaBaselinePutts(missFt) - 1 - currentOffsets.approach;
}

// ===== PGA Tour short-game baselines (strokes gained), rough + sand lies =====
// Same source table as the fairway approach baseline (Broadie, "Every Shot Counts", sampled
// values) — this just uses the rough and sand columns instead of fairway.
const ROUGH_APPROACH_BASELINE = [
  [20, 2.59],
  [80, 2.96],
  [100, 3.02],
  [160, 3.08],
  [180, 3.31],
  [200, 3.42],
];
const SAND_APPROACH_BASELINE = [
  [20, 2.53],
  [80, 3.24],
  [100, 3.23],
  [160, 3.21],
  [180, 3.4],
  [200, 3.55],
];

// Shared log-linear interpolator (same shape as pgaBaselinePutts/pgaBaselineApproach above).
function interpolateBaseline(table, x) {
  if (x <= 0) return 1.0;
  const [firstD, firstP] = table[0];
  if (x <= firstD) {
    // Extrapolate the trend of the table's own first two real sample points backward (same
    // log-linear method already used to extrapolate past the last point below), rather than
    // forcing a straight line down to an artificial "0 yards = 1.0 strokes" anchor. That anchor
    // doesn't correspond to any real sampled data, and because both the rough and sand tables'
    // lowest real point sits at 20 yards, it dragged the entire 1-19 yard range — exactly the
    // range Short Game practice mostly uses (its window starts at 5 yards) — down to
    // unrealistically easy baseline values. That's what let a genuinely good short-game shot
    // (finishing within a foot, or holed) show as a breakeven or strokes-LOST result: not
    // anything about the shot, just an artifact of the curve's shape below its lowest real point.
    const [secondD, secondP] = table[1];
    const t = (Math.log(x) - Math.log(firstD)) / (Math.log(secondD) - Math.log(firstD));
    return Math.max(1.0, firstP + t * (secondP - firstP));
  }
  const [lastD, lastP] = table[table.length - 1];
  if (x >= lastD) {
    const [prevD, prevP] = table[table.length - 2];
    const t = (Math.log(x) - Math.log(prevD)) / (Math.log(lastD) - Math.log(prevD));
    return prevP + t * (lastP - prevP);
  }
  for (let i = 0; i < table.length - 1; i++) {
    const [d1, p1] = table[i];
    const [d2, p2] = table[i + 1];
    if (x >= d1 && x <= d2) {
      const t = (Math.log(x) - Math.log(d1)) / (Math.log(d2) - Math.log(d1));
      return p1 + t * (p2 - p1);
    }
  }
  return lastP;
}

function pgaBaselineRough(yds) {
  return interpolateBaseline(ROUGH_APPROACH_BASELINE, yds);
}
function pgaBaselineSand(yds) {
  return interpolateBaseline(SAND_APPROACH_BASELINE, yds);
}

const LIE_LABELS = { fairway: "FAIRWAY", rough: "ROUGH", bunker: "BUNKER" };
const CLUB_LABELS = { driver: "DRIVER", fairway: "FAIRWAY WOOD", hybrid: "HYBRID", iron: "IRON" };

// Fixed list, in shortest-to-longest order — this is both the selection order on setup and the
// order the guided practice flow works through, so it deliberately isn't alphabetical.
const WEDGE_CLUBS = [
  { key: "LW", label: "LOB WEDGE (LW)" },
  { key: "SW", label: "SAND WEDGE (SW)" },
  { key: "GW", label: "GAP WEDGE (GW)" },
  { key: "AW", label: "APPROACH WEDGE (AW)" },
  { key: "PW", label: "PITCHING WEDGE (PW)" },
  { key: "9I", label: "9 IRON" },
];
const WEDGE_SWINGS = [
  { key: "half", label: "1/2 SWING" },
  { key: "threeQuarter", label: "3/4 SWING" },
  { key: "full", label: "FULL SWING" },
];

// Builds the club × swing sequence the guided practice walks through, in the fixed shortest-to-
// longest order regardless of the order the user tapped the checkboxes in.
function buildWedgeComboSequence(selectedClubs, selectedSwings) {
  const sequence = [];
  WEDGE_CLUBS.filter((c) => selectedClubs.includes(c.key)).forEach((club) => {
    WEDGE_SWINGS.filter((s) => selectedSwings.includes(s.key)).forEach((swing) => {
      sequence.push({ clubKey: club.key, clubLabel: club.label, swingKey: swing.key, swingLabel: swing.label });
    });
  });
  return sequence;
}

// 5 shots: drop the single shortest and longest, average the remaining 3.
// 10 shots: drop the two shortest and two longest, average the remaining 6.
// Keeps the middle 60% of shots, dropping the rest split evenly between the shortest and longest
// ends (an odd leftover drops from the long side). Works for any shot count the user picks — with
// fewer than 3 shots there isn't enough data to trim meaningfully, so everything is kept. Returns
// shots in original entry order, each flagged included/excluded, so the result can be manually
// edited afterward without losing track of what the automatic pass decided.
function trimWedgeOutliersAndAverage(shots) {
  const n = shots.length;
  const keepCount = n < 3 ? n : Math.max(1, Math.round(n * 0.6));
  const dropTotal = n - keepCount;
  const dropLow = Math.floor(dropTotal / 2);
  const dropHigh = dropTotal - dropLow;

  const withIndex = shots.map((value, i) => ({ value, i }));
  const sortedByValue = [...withIndex].sort((a, b) => a.value - b.value);
  const droppedIndices = new Set([
    ...sortedByValue.slice(0, dropLow).map((s) => s.i),
    ...sortedByValue.slice(sortedByValue.length - dropHigh).map((s) => s.i),
  ]);

  const shotObjs = shots.map((value, i) => ({ value, included: !droppedIndices.has(i) }));
  const average = avg(shotObjs.filter((s) => s.included).map((s) => s.value));
  return { shots: shotObjs, average };
}

// Same keep/drop math as trimWedgeOutliersAndAverage, but count-only — used to show a live
// preview on the setup screen before any shots exist yet.
// NOTE: both this and trimWedgeOutliersAndAverage above are pure functions over a shot count /
// shot-value array — nothing about them is actually wedge-specific despite the name — so Gapping
// (full-swing clubs) reuses them as-is rather than duplicating the same trim math.
function wedgeTrimPreview(n) {
  const keepCount = n < 3 ? n : Math.max(1, Math.round(n * 0.6));
  const dropTotal = n - keepCount;
  const dropLow = Math.floor(dropTotal / 2);
  const dropHigh = dropTotal - dropLow;
  return { keepCount, dropLow, dropHigh };
}

// Fixed list, shortest-to-longest (9 Iron up through Driver) — this is the order the guided
// practice flow works through (test the short clubs first, finish on Driver) and, separately, the
// order results/PDF/PNG display in. 9 Wood was removed entirely per explicit user decision (no
// longer offered — old completed charts that already tested it keep their saved data untouched,
// since a finished chart stores each club's label as a literal snapshot, not a live lookup here).
// Wedges are deliberately excluded — they live in the Wedge Matrix, since wedges need
// half/three-quarter swing tracking that full-swing clubs here don't.
// Woods/irons/hybrids use short codes (3W, 4I, 3HY, ...) rather than spelled-out "3 WOOD" —
// deliberately compact so the selection grid on setup can run 3 columns and stay small.
const GAPPING_CLUBS = [
  { key: "9i", label: "9I", group: "iron" },
  { key: "8i", label: "8I", group: "iron" },
  { key: "7i", label: "7I", group: "iron" },
  { key: "6i", label: "6I", group: "iron" },
  { key: "5i", label: "5I", group: "iron" },
  { key: "4i", label: "4I", group: "iron" },
  { key: "3i", label: "3I", group: "iron" },
  { key: "2i", label: "2I", group: "iron" },
  { key: "1i", label: "1I", group: "iron" },
  { key: "4hy", label: "4HY", group: "hybrid" },
  { key: "3hy", label: "3HY", group: "hybrid" },
  { key: "2hy", label: "2HY", group: "hybrid" },
  { key: "7w", label: "7W", group: "wood" },
  { key: "5w", label: "5W", group: "wood" },
  { key: "4w", label: "4W", group: "wood" },
  { key: "3w", label: "3W", group: "wood" },
  { key: "minidriver", label: "MINI DR", group: "wood" },
  { key: "driver", label: "DRIVER", group: "driver" },
];

// The setup screen's selection grid is laid out by explicit hand-picked column groupings rather
// than derived from GAPPING_CLUBS' order above — that array's order is about practice/results
// sequence (shortest to longest), which the user deliberately wants decoupled from how the
// selection grid reads (e.g. Driver sits at the TOP of column 1 here, even though it practices
// LAST). Column contents per explicit user request; each key must exist in GAPPING_CLUBS.
const GAPPING_GRID_COLUMNS = [
  ["driver", "minidriver", "3w", "4w", "5w", "7w"],
  ["2hy", "3hy", "4hy", "1i", "2i", "3i"],
  ["4i", "5i", "6i", "7i", "8i", "9i"],
];

// Builds the guided practice sequence: fixed clubs first, shortest-to-longest in the order above
// (regardless of tap order — so practice always starts at 9 Iron and finishes at Driver), then
// any custom clubs appended afterward in the order they were added — position doesn't matter for
// a custom club, per explicit user decision.
function buildGappingSequence(selectedClubKeys, customClubs) {
  const fixed = GAPPING_CLUBS.filter((c) => selectedClubKeys.includes(c.key)).map((c) => ({
    clubKey: c.key,
    clubLabel: c.label,
  }));
  const custom = customClubs
    .filter((c) => selectedClubKeys.includes(c.key))
    .map((c) => ({ clubKey: c.key, clubLabel: c.label }));
  return [...fixed, ...custom];
}

// Builds the matrix as a standalone SVG string (generic fonts only, so nothing depends on the
// app's custom web fonts having loaded — canvas rasterization doesn't reliably wait for those).
function buildWedgeMatrixSVG(matrix, units) {
  const clubs = WEDGE_CLUBS.filter((c) => matrix.selectedClubs.includes(c.key));
  const swings = WEDGE_SWINGS.filter((s) => matrix.selectedSwings.includes(s.key));
  const unitLabel = longUnitLabel(units);

  const labelColW = 170;
  const colW = 120;
  const headerH = 54;
  const rowH = 58;
  const padding = 28;
  const titleH = 64;

  const width = padding * 2 + labelColW + colW * swings.length;
  const height = padding * 2 + titleH + headerH + rowH * clubs.length;

  const TURF_DARK = "#14291F";
  const TURF = "#1D3A2B";
  const CREAM = "#F1EAD6";
  const CREAM_DIM = "#E4DBC2";
  const FLAG = "#C1440E";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="${TURF_DARK}"/>`;
  svg += `<text x="${padding}" y="${padding + 24}" font-family="Georgia, serif" font-size="26" fill="${CREAM}" font-weight="bold">WEDGE MATRIX</text>`;
  svg += `<text x="${padding}" y="${padding + 46}" font-family="monospace" font-size="12" fill="${CREAM_DIM}">${new Date(
    matrix.date
  ).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · ${unitLabel === "y" ? "yards" : "meters"}</text>`;

  const gridTop = padding + titleH;
  svg += `<rect x="${padding}" y="${gridTop}" width="${labelColW}" height="${headerH}" fill="${TURF}" stroke="${CREAM_DIM}33"/>`;
  swings.forEach((s, si) => {
    const x = padding + labelColW + si * colW;
    svg += `<rect x="${x}" y="${gridTop}" width="${colW}" height="${headerH}" fill="${TURF}" stroke="${CREAM_DIM}33"/>`;
    svg += `<text x="${x + colW / 2}" y="${gridTop + headerH / 2 + 5}" font-family="monospace" font-size="12" fill="${CREAM_DIM}" text-anchor="middle">${s.label}</text>`;
  });

  clubs.forEach((c, ci) => {
    const y = gridTop + headerH + ci * rowH;
    // Full descriptive name minus the trailing "(XX)" code, shown as a smaller subtitle line so
    // the longer names (Approach Wedge, Pitching Wedge) never collide with the value columns.
    const fullName = c.label.replace(/\s*\([^)]*\)$/, "");
    svg += `<rect x="${padding}" y="${y}" width="${labelColW}" height="${rowH}" fill="${TURF}" stroke="${CREAM_DIM}33"/>`;
    svg += `<text x="${padding + 12}" y="${y + rowH / 2 - 5}" font-family="Georgia, serif" font-size="17" fill="${CREAM}" font-weight="bold">${c.key}</text>`;
    svg += `<text x="${padding + 12}" y="${y + rowH / 2 + 14}" font-family="monospace" font-size="9" fill="${CREAM_DIM}">${fullName}</text>`;
    swings.forEach((s, si) => {
      const x = padding + labelColW + si * colW;
      const key = `${c.key}-${s.key}`;
      const result = matrix.results[key];
      const value = result ? `${ydsToUnitRound(result.average, units)}${unitLabel}` : "—";
      svg += `<rect x="${x}" y="${y}" width="${colW}" height="${rowH}" fill="none" stroke="${CREAM_DIM}33"/>`;
      svg += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 6}" font-family="Georgia, serif" font-size="18" fill="${FLAG}" text-anchor="middle" font-weight="bold">${value}</text>`;
    });
  });

  svg += `</svg>`;
  return { svg, width, height };
}

function downloadWedgeMatrixPNG(matrix, units) {
  const { svg, width, height } = buildWedgeMatrixSVG(matrix, units);
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = `wedge-matrix-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(pngUrl);
    }, "image/png");
  };
  img.src = url;
}

// Single-column version of buildWedgeMatrixSVG — Gapping has no second dimension (no swing
// lengths), so it's one row per club rather than a club × swing grid.
function buildGappingChartSVG(chart, units) {
  // Reversed for display, same reasoning as GappingResultScreen above — chart.sequence stays
  // shortest-to-longest (shot-hitting order), but the PNG/PDF chart itself reads longest-to-shortest.
  const clubs = [...chart.sequence].reverse();
  const unitLabel = longUnitLabel(units);

  const labelColW = 260;
  const valueColW = 140;
  const rowH = 50;
  const padding = 28;
  const titleH = 64;

  const width = padding * 2 + labelColW + valueColW;
  const height = padding * 2 + titleH + rowH * clubs.length;

  const TURF_DARK = "#14291F";
  const TURF = "#1D3A2B";
  const CREAM = "#F1EAD6";
  const CREAM_DIM = "#E4DBC2";
  const FLAG = "#C1440E";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="${TURF_DARK}"/>`;
  svg += `<text x="${padding}" y="${padding + 24}" font-family="Georgia, serif" font-size="26" fill="${CREAM}" font-weight="bold">GAPPING CHART</text>`;
  svg += `<text x="${padding}" y="${padding + 46}" font-family="monospace" font-size="12" fill="${CREAM_DIM}">${new Date(
    chart.date
  ).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · ${unitLabel === "y" ? "yards" : "meters"}</text>`;

  const gridTop = padding + titleH;
  clubs.forEach((c, i) => {
    const y = gridTop + i * rowH;
    const result = chart.results[c.clubKey];
    const value = result ? `${ydsToUnitRound(result.average, units)}${unitLabel}` : "—";
    svg += `<rect x="${padding}" y="${y}" width="${labelColW}" height="${rowH}" fill="${TURF}" stroke="${CREAM_DIM}33"/>`;
    svg += `<text x="${padding + 14}" y="${y + rowH / 2 + 6}" font-family="Georgia, serif" font-size="16" fill="${CREAM}" font-weight="bold">${c.clubLabel}</text>`;
    svg += `<rect x="${padding + labelColW}" y="${y}" width="${valueColW}" height="${rowH}" fill="none" stroke="${CREAM_DIM}33"/>`;
    svg += `<text x="${padding + labelColW + valueColW / 2}" y="${y + rowH / 2 + 6}" font-family="Georgia, serif" font-size="18" fill="${FLAG}" text-anchor="middle" font-weight="bold">${value}</text>`;
  });

  svg += `</svg>`;
  return { svg, width, height };
}

function downloadGappingPNG(chart, units) {
  const { svg, width, height } = buildGappingChartSVG(chart, units);
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = `gapping-chart-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(pngUrl);
    }, "image/png");
  };
  img.src = url;
}

function shortGameBaseline(lie, yds) {
  if (lie === "rough") return pgaBaselineRough(yds);
  if (lie === "bunker") return pgaBaselineSand(yds);
  return pgaBaselineApproach(yds);
}

// Strokes gained for a short-game shot. Same assumptions as the Range: the shot is assumed to
// finish on the green, so the ending baseline (when not holed) comes from the putting curve. The
// starting baseline depends on the lie the shot was played from.
// resultFt === 0 means "Holed it" — the ball finished IN the hole, not "0 feet away and needing a
// putt". Those are different things: pgaBaselinePutts(0) deliberately returns 1.0 (a tap-in still
// costs a stroke) for the Range's "landed exactly at the target distance" case, but reusing that
// here for a holed shot double-counted a putt that was never played, making every holed shot look
// roughly a full stroke worse than it should. A holed shot needs 0 further strokes, full stop.
function sgForShortGameShot(lie, targetYds, resultFt) {
  const remainingStrokes = resultFt <= 0 ? 0 : pgaBaselinePutts(resultFt);
  return shortGameBaseline(lie, targetYds) - remainingStrokes - 1 - currentOffsets.shortgame;
}

function flattenPutts(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.putts.forEach((p) => {
        rows.push({
          date: s.date,
          targetFt: p.targetFt,
          strokes: p.strokes,
          sg: sgForPutt(p.targetFt, p.strokes),
          bucket: puttingBucketFor(p.targetFt),
        });
      });
    });
  return rows;
}

function puttingSessionTrendData(sessions, filterMin, filterMax) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => {
      const putts = s.putts.filter((p) => p.targetFt >= filterMin && p.targetFt <= filterMax);
      if (!putts.length) return null;
      return {
        date: s.date,
        dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        avgStrokes: avg(putts.map((p) => p.strokes)),
        avgSG: avg(putts.map((p) => sgForPutt(p.targetFt, p.strokes))),
        puttCount: putts.length,
      };
    })
    .filter(Boolean);
}

function puttingBucketChartData(sessions, filterMin, filterMax) {
  const rows = flattenPutts(sessions).filter((r) => r.targetFt >= filterMin && r.targetFt <= filterMax);
  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });
  return Object.entries(byBucket)
    .map(([label, rs]) => ({
      label,
      avgStrokes: avg(rs.map((r) => r.strokes)),
      avgSG: avg(rs.map((r) => r.sg)),
      count: rs.length,
    }))
    .sort((a, b) => puttingBucketSortKey(a.label) - puttingBucketSortKey(b.label));
}

// SG >= 0 = at or better than PGA Tour average from that distance. Small negative is close;
// a bigger negative gap means real strokes lost to the field.
function sgRagColor(avgSG) {
  if (avgSG >= 0) return COLORS.fairwayLight;
  if (avgSG >= -0.15) return COLORS.sand;
  return COLORS.flag;
}

// A hole is complete once its most recent putt attempt actually went in — everything before
// that in the array was a miss that needed a follow-up putt. A hole explicitly marked "no putt"
// (chipped in from off the green) is also complete, with no putt data attached at all.
function isHoleComplete(hole) {
  if (hole.noPutt) return true;
  return hole.putts && hole.putts.length > 0 && hole.putts[hole.putts.length - 1].made === true;
}

// ===== On-course round stats (kept separate from practice-session analysis) =====
function courseRoundStats(session) {
  // session.putts has one entry PER HOLE ({targetFt, strokes, holedFromFt}) — session.putts.length
  // is the number of holes played, not the number of putts taken. The actual total is the sum of
  // strokes across every hole.
  const totalPutts = session.putts.reduce((a, p) => a + p.strokes, 0);
  const ftMade = session.putts.reduce((a, p) => {
    // holedFromFt is the exact distance of whichever putt actually went in — recorded for every
    // round logged with the per-putt entry flow. Older rounds recorded before that existed only
    // have a single distance+strokes pair, so they fall back to the old approximation (only
    // counting holes that went in on the very first putt).
    if (p.holedFromFt != null) return a + p.holedFromFt;
    return a + (p.strokes === 1 ? p.targetFt : 0);
  }, 0);
  const totalSG = session.putts.reduce((a, p) => a + sgForPutt(p.targetFt, p.strokes), 0);
  const avgSG = totalPutts ? totalSG / totalPutts : 0;
  return { totalPutts, ftMade, totalSG, avgSG };
}

function courseRoundTrendData(sessions) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => {
      const stats = courseRoundStats(s);
      return {
        date: s.date,
        dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        ...stats,
      };
    });
}

function computePuttingAnalysis(sessions) {
  const rows = flattenPutts(sessions);
  if (rows.length === 0) return null;

  const overallAvgStrokes = avg(rows.map((r) => r.strokes));
  const overallAvgSG = avg(rows.map((r) => r.sg));
  const onePuttPct = (rows.filter((r) => r.strokes <= 1).length / rows.length) * 100;
  const threePuttPct = (rows.filter((r) => r.strokes >= 3).length / rows.length) * 100;

  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  // Positive trendDelta = SG improved (went up) from earlier to later putts in the period.
  const trendDelta =
    firstHalf.length && secondHalf.length ? avg(secondHalf.map((r) => r.sg)) - avg(firstHalf.map((r) => r.sg)) : 0;

  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });

  const buckets = Object.entries(byBucket).map(([label, bucketRows]) => {
    const bMid = Math.floor(bucketRows.length / 2);
    const bFirst = bucketRows.slice(0, bMid);
    const bSecond = bucketRows.slice(bMid);
    const improvement =
      bFirst.length >= 2 && bSecond.length >= 2 ? avg(bSecond.map((r) => r.sg)) - avg(bFirst.map((r) => r.sg)) : null;
    return {
      label,
      count: bucketRows.length,
      avgStrokes: avg(bucketRows.map((r) => r.strokes)),
      avgSG: avg(bucketRows.map((r) => r.sg)),
      improvement,
    };
  });

  buckets.sort((a, b) => puttingBucketSortKey(a.label) - puttingBucketSortKey(b.label));

  const withEnoughData = buckets.filter((b) => b.count >= 3);
  const strengths = [...withEnoughData].sort((a, b) => b.avgSG - a.avgSG).slice(0, 2);
  const weaknesses = [...withEnoughData].sort((a, b) => a.avgSG - b.avgSG).slice(0, 2);

  const withImprovement = buckets.filter((b) => b.improvement !== null);
  const mostImproved = [...withImprovement].sort((a, b) => b.improvement - a.improvement).filter((b) => b.improvement > 0.05).slice(0, 2);
  const regressing = [...withImprovement].sort((a, b) => a.improvement - b.improvement).filter((b) => b.improvement < -0.05).slice(0, 2);

  return {
    sessionCount: sessions.length,
    puttCount: rows.length,
    overallAvgStrokes,
    overallAvgSG,
    onePuttPct,
    threePuttPct,
    trendDelta,
    buckets,
    strengths,
    weaknesses,
    mostImproved,
    regressing,
  };
}

// ===== Random Practice putting — break-of-putt breakdown =====
// Optional, per-session: when a Random Practice session is logged with "include break?" turned on,
// each putt is tagged with which way it broke (left-to-right / straight / right-to-left). Only
// putts that actually carry a break tag are included here — older sessions, and sessions where the
// feature was left off, simply have no break-tagged putts and this analysis returns null for them.
const PUTT_BREAK_LABELS = { ltr: "Left to right", straight: "Straight", rtl: "Right to left" };
const PUTT_BREAK_ORDER = { ltr: 0, straight: 1, rtl: 2 };
// Button options for the live break-of-putt picker (PuttingPracticeScreen) — same three values as
// PUTT_BREAK_LABELS above, just pre-shaped as an array for .map() with all-caps button copy.
const PUTT_BREAK_OPTIONS = [
  { key: "ltr", label: "LEFT TO RIGHT" },
  { key: "straight", label: "STRAIGHT" },
  { key: "rtl", label: "RIGHT TO LEFT" },
];

function flattenPuttsWithBreak(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.putts.forEach((p) => {
        if (p.break == null) return; // no break tag on this putt — skip
        rows.push({
          date: s.date,
          targetFt: p.targetFt,
          strokes: p.strokes,
          sg: sgForPutt(p.targetFt, p.strokes),
          breakDir: p.break,
        });
      });
    });
  return rows;
}

function computePuttingBreakAnalysis(sessions) {
  const rows = flattenPuttsWithBreak(sessions);
  if (rows.length === 0) return null;

  const byBreak = {};
  rows.forEach((r) => {
    if (!byBreak[r.breakDir]) byBreak[r.breakDir] = [];
    byBreak[r.breakDir].push(r);
  });

  const buckets = Object.entries(byBreak).map(([breakDir, breakRows]) => ({
    label: PUTT_BREAK_LABELS[breakDir] || breakDir,
    breakDir,
    count: breakRows.length,
    avgStrokes: avg(breakRows.map((r) => r.strokes)),
    avgSG: avg(breakRows.map((r) => r.sg)),
  }));

  buckets.sort((a, b) => (PUTT_BREAK_ORDER[a.breakDir] ?? 99) - (PUTT_BREAK_ORDER[b.breakDir] ?? 99));

  const withEnoughData = buckets.filter((b) => b.count >= 3);
  const strengths = [...withEnoughData].sort((a, b) => b.avgSG - a.avgSG).slice(0, 2);
  const weaknesses = [...withEnoughData].sort((a, b) => a.avgSG - b.avgSG).slice(0, 2);

  return {
    puttCount: rows.length,
    buckets,
    strengths,
    weaknesses,
  };
}

function computeAnalysis(sessions) {
  const rows = flattenShots(sessions);
  if (rows.length === 0) return null;

  const overallAvgMissPct = avg(rows.map((r) => r.missPct));
  const overallAvgMissYds = avg(rows.map((r) => r.diff));
  const overallAvgSG = avg(rows.map((r) => r.sg));

  // Overall trend: compare first half vs second half chronologically. Positive = SG improved.
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  const trendDelta =
    firstHalf.length && secondHalf.length ? avg(secondHalf.map((r) => r.sg)) - avg(firstHalf.map((r) => r.sg)) : 0;

  // Group by distance bucket.
  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });

  const buckets = Object.entries(byBucket).map(([label, bucketRows]) => {
    const bMid = Math.floor(bucketRows.length / 2);
    const bFirst = bucketRows.slice(0, bMid);
    const bSecond = bucketRows.slice(bMid);
    const improvement =
      bFirst.length >= 2 && bSecond.length >= 2 ? avg(bSecond.map((r) => r.sg)) - avg(bFirst.map((r) => r.sg)) : null;
    return {
      label,
      count: bucketRows.length,
      avgMissPct: avg(bucketRows.map((r) => r.missPct)),
      avgMissYds: avg(bucketRows.map((r) => r.diff)),
      avgSG: avg(bucketRows.map((r) => r.sg)),
      improvement,
    };
  });

  buckets.sort((a, b) => bucketSortKey(a.label) - bucketSortKey(b.label));

  const withEnoughData = buckets.filter((b) => b.count >= 3);
  const strengths = [...withEnoughData].sort((a, b) => b.avgSG - a.avgSG).slice(0, 2);
  const weaknesses = [...withEnoughData].sort((a, b) => a.avgSG - b.avgSG).slice(0, 2);

  const withImprovement = buckets.filter((b) => b.improvement !== null);
  const mostImproved = [...withImprovement].sort((a, b) => b.improvement - a.improvement).filter((b) => b.improvement > 0.05).slice(0, 2);
  const regressing = [...withImprovement].sort((a, b) => a.improvement - b.improvement).filter((b) => b.improvement < -0.05).slice(0, 2);

  return {
    sessionCount: sessions.length,
    shotCount: rows.length,
    overallAvgMissPct,
    overallAvgMissYds,
    overallAvgSG,
    trendDelta,
    buckets,
    strengths,
    weaknesses,
    mostImproved,
    regressing,
  };
}

// ===== Range self-rating mode (no distance measuring device) =====
// No SG or miss-distance is possible without a measured outcome, so this mirrors computeAnalysis's
// shape but ranks distance bands by average self-rating (1-5) instead of strokes gained.
function ratingRagColor(avgRating) {
  if (avgRating >= 4) return COLORS.fairwayLight;
  if (avgRating >= 2.5) return COLORS.sand;
  return COLORS.flag;
}

function flattenRatingShots(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.shots.forEach((sh) => {
        rows.push({ date: s.date, target: sh.target, rating: sh.rating, bucket: bucketFor(sh.target) });
      });
    });
  return rows;
}

function ratingSessionTrendData(sessions) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => ({
      date: s.date,
      dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      avgRating: avg(s.shots.map((sh) => sh.rating)),
      shotCount: s.shots.length,
    }));
}

function computeRangeRatingAnalysis(sessions) {
  const rows = flattenRatingShots(sessions);
  if (rows.length === 0) return null;

  const overallAvgRating = avg(rows.map((r) => r.rating));
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  const trendDelta =
    firstHalf.length && secondHalf.length ? avg(secondHalf.map((r) => r.rating)) - avg(firstHalf.map((r) => r.rating)) : 0;

  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });

  const buckets = Object.entries(byBucket).map(([label, bucketRows]) => {
    const bMid = Math.floor(bucketRows.length / 2);
    const bFirst = bucketRows.slice(0, bMid);
    const bSecond = bucketRows.slice(bMid);
    const improvement =
      bFirst.length >= 2 && bSecond.length >= 2 ? avg(bSecond.map((r) => r.rating)) - avg(bFirst.map((r) => r.rating)) : null;
    return {
      label,
      count: bucketRows.length,
      avgRating: avg(bucketRows.map((r) => r.rating)),
      improvement,
    };
  });

  buckets.sort((a, b) => bucketSortKey(a.label) - bucketSortKey(b.label));

  const withEnoughData = buckets.filter((b) => b.count >= 3);
  const strengths = [...withEnoughData].sort((a, b) => b.avgRating - a.avgRating).slice(0, 2);
  const weaknesses = [...withEnoughData].sort((a, b) => a.avgRating - b.avgRating).slice(0, 2);

  const withImprovement = buckets.filter((b) => b.improvement !== null);
  const mostImproved = [...withImprovement].sort((a, b) => b.improvement - a.improvement).filter((b) => b.improvement > 0.2).slice(0, 2);
  const regressing = [...withImprovement].sort((a, b) => a.improvement - b.improvement).filter((b) => b.improvement < -0.2).slice(0, 2);

  return {
    sessionCount: sessions.length,
    shotCount: rows.length,
    overallAvgRating,
    trendDelta,
    buckets,
    strengths,
    weaknesses,
    mostImproved,
    regressing,
  };
}

function RatingBucketRow({ bucket }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: COLORS.cream }}>{bucket.label}y</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>{bucket.count} shots</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: ratingRagColor(bucket.avgRating) }}>
          {bucket.avgRating.toFixed(1)}/5
        </div>
        {bucket.improvement !== null && bucket.improvement !== undefined && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: bucket.improvement > 0 ? COLORS.fairwayLight : COLORS.flag,
            }}
          >
            {bucket.improvement > 0 ? "▲" : "▼"} {Math.abs(bucket.improvement).toFixed(1)}
          </div>
        )}
      </div>
    </div>
  );
}

function RatingInsightCard({ title, subtitle, items, emptyText }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, padding: "6px 0" }}>
            {emptyText}
          </div>
        ) : (
          items.map((b, i) => (
            <div key={b.label} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <RatingBucketRow bucket={b} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ===== Post-session feedback ("that was your 2nd best session ever") =====
// Ranks the just-finished session against comparable past sessions on a single metric, and
// turns that ranking into a short, honest headline. Ties (equal metric values) are ranked by
// whichever comes first in the array, which is fine here since exact ties are rare with
// floating-point SG/rating averages.
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function rankSession(currentId, sessions, metricFn) {
  const withMetrics = sessions
    .map((s) => ({ id: s.id, metric: metricFn(s) }))
    .filter((s) => typeof s.metric === "number" && !isNaN(s.metric));
  if (withMetrics.length === 0) return null;

  withMetrics.sort((a, b) => b.metric - a.metric); // descending — higher metric is better throughout this app
  const rank = withMetrics.findIndex((s) => s.id === currentId) + 1;
  if (rank === 0) return null; // current session's metric was invalid/filtered out

  const current = withMetrics[rank - 1];
  const others = withMetrics.filter((s) => s.id !== currentId);
  const othersAvg = others.length ? avg(others.map((o) => o.metric)) : null;

  return { rank, total: withMetrics.length, currentMetric: current.metric, othersAvg };
}

// valueFmt formats a raw metric number for display (e.g. formatSG, or `${x.toFixed(1)}/5`).
function buildSessionFeedback(ranking, valueFmt) {
  if (!ranking) return null;
  const { rank, total, currentMetric, othersAvg } = ranking;

  if (total === 1) {
    return {
      headline: "FIRST SESSION LOGGED",
      detail: "This is your baseline — future sessions will be compared against it.",
      tone: "neutral",
    };
  }
  if (rank === 1) {
    return {
      headline: "★ BEST SESSION EVER",
      detail: `Your best of ${total} sessions — ${valueFmt(currentMetric)}.`,
      tone: "great",
    };
  }
  if (rank <= 3) {
    return {
      headline: `★ ${ordinal(rank)} BEST SESSION`,
      detail: `Out of ${total} sessions so far — ${valueFmt(currentMetric)}.`,
      tone: "great",
    };
  }
  if (othersAvg !== null && currentMetric > othersAvg) {
    return {
      headline: "BETTER THAN YOUR AVERAGE",
      detail: `${valueFmt(currentMetric)} vs your average of ${valueFmt(othersAvg)} across ${total - 1} past sessions.`,
      tone: "good",
    };
  }
  if (othersAvg !== null && Math.abs(currentMetric - othersAvg) < 1e-9) {
    return {
      headline: "RIGHT AT YOUR AVERAGE",
      detail: `${valueFmt(currentMetric)}, matching your average across ${total - 1} past sessions.`,
      tone: "neutral",
    };
  }
  return {
    headline: "SESSION LOGGED",
    detail:
      othersAvg !== null
        ? `${valueFmt(currentMetric)} vs your average of ${valueFmt(othersAvg)} — every session still adds data.`
        : "Logged and saved.",
    tone: "below",
  };
}

function SessionFeedbackBanner({ feedback }) {
  if (!feedback) return null;
  const toneColors = {
    great: { border: COLORS.fairwayLight, bg: `${COLORS.fairway}55` },
    good: { border: COLORS.fairwayLight, bg: `${COLORS.fairway}33` },
    neutral: { border: `${COLORS.creamDim}33`, bg: "transparent" },
    below: { border: `${COLORS.creamDim}33`, bg: "transparent" },
  };
  const c = toneColors[feedback.tone] || toneColors.neutral;
  return (
    <Card style={{ marginBottom: 10, border: `1px solid ${c.border}`, background: c.bg }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
        {feedback.headline}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
        {feedback.detail}
      </div>
    </Card>
  );
}

// Sums each player's points across all completed rounds of a Compete session.
function computeCompeteTotals(players, roundResults) {
  const totals = {};
  players.forEach((p) => (totals[p] = 0));
  roundResults.forEach((r) => {
    (r.standings || []).forEach((s) => {
      totals[s.player] = (totals[s.player] || 0) + s.points;
    });
  });
  return totals;
}

// Always PGA Tour baseline, ignoring whatever handicap baseline is currently selected in
// Settings — used specifically for Putting Compete's end-of-game SG summary, per explicit request.
function sgForPuttTourOnly(targetFt, strokes) {
  return pgaBaselinePutts(targetFt) - strokes;
}

// Ranks a round's entries by proximity (ascending = better) and assigns Compete's scaled points:
// with N players, 1st gets (N-1) points, 2nd gets (N-2), ..., last gets 0.
function rankCompeteByProximity(entries, valueKey) {
  const sorted = [...entries].sort((a, b) => a[valueKey] - b[valueKey]);
  const n = sorted.length;
  return sorted.map((e, i) => ({ ...e, rank: i + 1, points: n - 1 - i }));
}

// Sums each player's total putts across all holes of a Putting Compete session (lower is better).
function computePuttCompeteTallies(players, holeResults) {
  const totals = {};
  players.forEach((p) => (totals[p] = 0));
  holeResults.forEach((h) => {
    h.putts.forEach((entry) => {
      totals[entry.player] = (totals[entry.player] || 0) + entry.strokes;
    });
  });
  return totals;
}

export default function GolfPracticeApp({ onSwitchProfile, profileName, profileId, profileHandicap }) {
  const [screen, setScreen] = useState("home"); // home | setup | practice | summary | analysis | shortgame | putting | puttingPractice | puttingSummary
  const [shotCount, setShotCount] = useState(10);
  const [minDist, setMinDist] = useState(50);
  const [maxDist, setMaxDist] = useState(150);
  const [shots, setShots] = useState([]); // {target, actual, diff} or {target, rating}
  const [editingShotIndex, setEditingShotIndex] = useState(null);
  const [currentSessionMode, setCurrentSessionMode] = useState("distance"); // mode locked in when this session started
  const [rangeSessionFeedback, setRangeSessionFeedback] = useState(null);
  const [currentTarget, setCurrentTarget] = useState(null);
  const [actualInput, setActualInput] = useState("");
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [activeSaved, setActiveSaved] = useState(null); // saved in-progress session, if any
  const [analysisSection, setAnalysisSection] = useState("range"); // range | shortgame | putting

  // ===== Compete (Range) state =====
  const [competePlayers, setCompetePlayers] = useState(() => [profileName || "", ""]);
  const [competeRounds, setCompeteRounds] = useState(5);
  const [competeMinDist, setCompeteMinDist] = useState(75);
  const [competeMaxDist, setCompeteMaxDist] = useState(150);
  const [competeMode, setCompeteMode] = useState("distance"); // distance | closest
  const [competeRoundResults, setCompeteRoundResults] = useState([]); // completed rounds this competition
  const [competeCurrentTarget, setCompeteCurrentTarget] = useState(null);
  const [competeCurrentPlayerIdx, setCompeteCurrentPlayerIdx] = useState(0);
  const [competeRoundEntries, setCompeteRoundEntries] = useState([]); // {player, distance} — distance mode only
  const [competeDistanceInput, setCompeteDistanceInput] = useState("");
  const [competeRoundComplete, setCompeteRoundComplete] = useState(false);
  const [competeRoundStandings, setCompeteRoundStandings] = useState([]); // this round's ranked results, for the confirmation screen
  const [competeHistory, setCompeteHistory] = useState([]);
  const [competeLoaded, setCompeteLoaded] = useState(false);
  const [competeEditingIndex, setCompeteEditingIndex] = useState(null); // which past round is being amended, if any
  // Tracks which competeHistory entry the just-finished CompeteSummaryScreen corresponds to, so an
  // edit made there (after the competition is fully over) can be written back into the *saved*
  // history entry too, not just the local in-memory round list.
  const [competeSummarySessionId, setCompeteSummarySessionId] = useState(null);
  const [competeSummaryEditingIndex, setCompeteSummaryEditingIndex] = useState(null);

  // ===== Compete (Short Game) state =====
  const [sgCompetePlayers, setSgCompetePlayers] = useState(() => [profileName || "", ""]);
  const [sgCompeteRounds, setSgCompeteRounds] = useState(9);
  const [sgCompeteMinYds, setSgCompeteMinYds] = useState(10);
  const [sgCompeteMaxYds, setSgCompeteMaxYds] = useState(30);
  const [sgCompeteLies, setSgCompeteLies] = useState([]);
  const [sgCompeteMode, setSgCompeteMode] = useState("distance"); // distance | closest
  const [sgCompeteRoundResults, setSgCompeteRoundResults] = useState([]);
  const [sgCompeteCurrentShot, setSgCompeteCurrentShot] = useState(null); // {lie, target}
  const [sgCompeteCurrentPlayerIdx, setSgCompeteCurrentPlayerIdx] = useState(0);
  const [sgCompeteResultInput, setSgCompeteResultInput] = useState("");
  const [sgCompeteRoundEntries, setSgCompeteRoundEntries] = useState([]); // {player, resultFt}
  const [sgCompeteRoundComplete, setSgCompeteRoundComplete] = useState(false);
  const [sgCompeteRoundStandings, setSgCompeteRoundStandings] = useState([]);
  const [sgCompeteHistory, setSgCompeteHistory] = useState([]);
  const [sgCompeteLoaded, setSgCompeteLoaded] = useState(false);
  const [sgCompeteEditingIndex, setSgCompeteEditingIndex] = useState(null);
  const [sgCompeteSummarySessionId, setSgCompeteSummarySessionId] = useState(null);
  const [sgCompeteSummaryEditingIndex, setSgCompeteSummaryEditingIndex] = useState(null);

  // ===== Compete (Putting) state — tally of putts taken, no per-hole points =====
  const [puttCompetePlayers, setPuttCompetePlayers] = useState(() => [profileName || "", ""]);
  const [puttCompeteHoles, setPuttCompeteHoles] = useState(9);
  const [puttCompeteMinFt, setPuttCompeteMinFt] = useState(3);
  const [puttCompeteMaxFt, setPuttCompeteMaxFt] = useState(20);
  const [puttCompeteHoleResults, setPuttCompeteHoleResults] = useState([]); // [{target, putts:[{player,strokes}]}]
  const [puttCompeteCurrentTarget, setPuttCompeteCurrentTarget] = useState(null);
  const [puttCompeteCurrentPlayerIdx, setPuttCompeteCurrentPlayerIdx] = useState(0);
  const [puttCompeteHoleEntries, setPuttCompeteHoleEntries] = useState([]); // {player, strokes} — this hole in progress
  const [puttCompeteHoleComplete, setPuttCompeteHoleComplete] = useState(false);
  const [puttCompeteHistory, setPuttCompeteHistory] = useState([]);
  const [puttCompeteLoaded, setPuttCompeteLoaded] = useState(false);
  const [puttCompeteEditingIndex, setPuttCompeteEditingIndex] = useState(null);
  const [puttCompeteSummarySessionId, setPuttCompeteSummarySessionId] = useState(null);
  const [puttCompeteSummaryEditingIndex, setPuttCompeteSummaryEditingIndex] = useState(null);
  const [baselineHandicap, setBaselineHandicapRaw] = useState("tour");
  const [units, setUnitsRaw] = useState("imperial"); // imperial | metric
  const [rangeTrackingMode, setRangeTrackingModeRaw] = useState(null); // null (unanswered) | distance | rating
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const inputRef = useRef(null);

  // ===== Putting section state =====
  const [puttCount, setPuttCount] = useState(9);
  const [puttMinFt, setPuttMinFt] = useState(3);
  const [puttMaxFt, setPuttMaxFt] = useState(20);
  const [puttIncludeBreak, setPuttIncludeBreak] = useState(false);
  const [puttCurrentBreak, setPuttCurrentBreak] = useState(null); // "ltr" | "straight" | "rtl" | null
  const [putts, setPutts] = useState([]); // {targetFt, strokes, break?}
  const [puttEditingShotIndex, setPuttEditingShotIndex] = useState(null);
  const [puttSessionFeedback, setPuttSessionFeedback] = useState(null);
  const [puttSummaryIsOnCourse, setPuttSummaryIsOnCourse] = useState(false);
  const [puttSummaryChipIns, setPuttSummaryChipIns] = useState(0);
  const [puttCurrentTarget, setPuttCurrentTarget] = useState(null);
  const [puttHistory, setPuttHistory] = useState([]);
  const [puttLoaded, setPuttLoaded] = useState(false);
  const [puttStorageError, setPuttStorageError] = useState(false);
  const [puttActiveSaved, setPuttActiveSaved] = useState(null);

  // ===== On-course putting tracker state =====
  const [onCourseHoles, setOnCourseHoles] = useState(() => Array.from({ length: 18 }, () => ({ putts: [] })));

  // ===== Putting — "Around the Clock" state =====
  // One putt from every distance 3-10ft (8 total), laid out as spokes at random positions around
  // a central hole. Kept entirely separate from the puttHistory/onCourseHoles state above (own
  // storage key, own history array) rather than folding into puttHistory's existing
  // type !== "course" / type === "course" split, which is relied on in several other places
  // (Home's sample-data counts, the practice/course Analysis tabs, session-ranking feedback) —
  // a third type there would mean touching all of those. This is simpler and lower-risk, at the
  // cost of Around the Clock having its own (simpler) history list rather than the full trend
  // charts the other two modes get.
  const [clockPutts, setClockPutts] = useState([]); // [{targetFt, angleDeg, strokes: null|1|2}]
  const [clockPendingIndex, setClockPendingIndex] = useState(null); // index awaiting a made/missed answer
  const [clockHistory, setClockHistory] = useState([]);
  const [clockLoaded, setClockLoaded] = useState(false);
  const [clockStorageError, setClockStorageError] = useState(false);

  // ===== Putting — "Start Line" gate drill state =====
  // 10 putts through a 15in gate set 15in in front of the putter — a start-line/face-control
  // drill, not a distance drill, so there's nothing to randomize and nothing per-putt to record:
  // the player just plays all 10 for real, then enters the one number at the end. Own storage
  // key + own (very small) history list, same reasoning as Around the Clock above.
  const [startLineMadeInput, setStartLineMadeInput] = useState(""); // entry field, while on the play screen
  const [startLineHistory, setStartLineHistory] = useState([]);
  const [startLineLoaded, setStartLineLoaded] = useState(false);
  const [startLineStorageError, setStartLineStorageError] = useState(false);

  // ===== Putting — "Pace Control" state =====
  // Player picks which of 10/20/30/40ft to include and 3 or 5 putts per distance; those putts are
  // built into one shuffled queue at START, then scored putt-by-putt on a 0-3 point scale (radius
  // to the hole) rather than made/missed. Own storage key + own history list, same pattern as
  // Around the Clock / Start Line above.
  const [paceSelectedDistances, setPaceSelectedDistances] = useState([]); // subset of PACE_DISTANCES_FT
  const [pacePuttsPerDistance, setPacePuttsPerDistance] = useState(5); // 3 | 5
  const [pacePutts, setPacePutts] = useState([]); // [{targetFt, points: null|0|1|2|3}], built + shuffled at start
  const [paceCurrentIndex, setPaceCurrentIndex] = useState(0);
  const [paceHistory, setPaceHistory] = useState([]);
  const [paceLoaded, setPaceLoaded] = useState(false);
  const [paceStorageError, setPaceStorageError] = useState(false);

  // ===== Short Game section state =====
  // ===== Tee Accuracy state =====
  const [teeShotCount, setTeeShotCount] = useState(10);
  const [teeFairwayWidth, setTeeFairwayWidth] = useState(30); // yds — a reasonable "average" estimate, adjustable
  const [teeClubs, setTeeClubs] = useState([]);
  const [teeShots, setTeeShots] = useState([]); // {club, hit}
  const [teeEditingShotIndex, setTeeEditingShotIndex] = useState(null);
  const [teeCurrentClub, setTeeCurrentClub] = useState(null);
  const [teeHistory, setTeeHistory] = useState([]);
  const [teeLoaded, setTeeLoaded] = useState(false);
  const [teeStorageError, setTeeStorageError] = useState(false);

  // ===== Wedge Matrix state =====
  const [wedgeSelectedClubs, setWedgeSelectedClubs] = useState([]);
  const [wedgeSelectedSwings, setWedgeSelectedSwings] = useState([]);
  const [wedgeShotsPerCombo, setWedgeShotsPerCombo] = useState(5);
  const [wedgeSequence, setWedgeSequence] = useState([]); // built at start, fixed for the whole matrix
  const [wedgeComboIndex, setWedgeComboIndex] = useState(0);
  const [wedgeCurrentShots, setWedgeCurrentShots] = useState([]); // distances collected so far for the in-progress combo
  const [wedgeDistanceInput, setWedgeDistanceInput] = useState("");
  const [wedgeComboComplete, setWedgeComboComplete] = useState(false); // showing the just-finished combo's average before moving on
  const [wedgeResults, setWedgeResults] = useState({}); // { "LW-half": {average, kept, excludedLow, excludedHigh}, ... }
  const [wedgeActiveMatrix, setWedgeActiveMatrix] = useState(null); // in-progress matrix, for resume
  const [wedgeMatrixHistory, setWedgeMatrixHistory] = useState([]); // every completed matrix, most recent first
  const [wedgeViewingMatrix, setWedgeViewingMatrix] = useState(null); // whichever matrix the result screen is currently showing
  const [wedgeLoaded, setWedgeLoaded] = useState(false);
  const wedgeInputRef = useRef(null);

  // ===== Gapping state (full-swing clubs — same process as Wedge Matrix, minus the swing-length
  // dimension: one shot sequence per club, not per club × swing) =====
  const [gappingSelectedClubs, setGappingSelectedClubs] = useState([]);
  const [gappingCustomClubs, setGappingCustomClubs] = useState([]); // [{key, label}], user-added, persisted across sessions
  const [gappingShotsPerClub, setGappingShotsPerClub] = useState(5);
  const [gappingSequence, setGappingSequence] = useState([]); // built at start, fixed for the whole chart
  const [gappingClubIndex, setGappingClubIndex] = useState(0);
  const [gappingCurrentShots, setGappingCurrentShots] = useState([]); // distances collected so far for the in-progress club
  const [gappingDistanceInput, setGappingDistanceInput] = useState("");
  const [gappingClubComplete, setGappingClubComplete] = useState(false); // showing the just-finished club's average before moving on
  const [gappingResults, setGappingResults] = useState({}); // { driver: {average, shots}, ... }
  const [gappingActiveChart, setGappingActiveChart] = useState(null); // in-progress chart, for resume
  const [gappingHistory, setGappingHistory] = useState([]); // every completed chart, most recent first
  const [gappingViewingChart, setGappingViewingChart] = useState(null); // whichever chart the result screen is currently showing
  const [gappingLoaded, setGappingLoaded] = useState(false);
  const gappingInputRef = useRef(null);
  // Manual entry — an alternate way to compile the same Gapping chart for someone who already
  // knows their numbers, skipping the shot-by-shot testing flow. Shares club selection
  // (gappingSelectedClubs/gappingCustomClubs) and the sequence-building/storage with the tested
  // flow above; only the values here are unique to this path.
  const [gappingManualValues, setGappingManualValues] = useState({}); // { clubKey: "245" }, raw text inputs

  const [shortShotCount, setShortShotCount] = useState(9);
  const [shortMinYds, setShortMinYds] = useState(10);
  const [shortMaxYds, setShortMaxYds] = useState(30);
  const [shortLies, setShortLies] = useState([]);
  const [shortShots, setShortShots] = useState([]); // {lie, target, resultFt}
  const [shortEditingShotIndex, setShortEditingShotIndex] = useState(null);
  const [shortCurrentShot, setShortCurrentShot] = useState(null); // {lie, target}
  const [shortHistory, setShortHistory] = useState([]);
  const [shortLoaded, setShortLoaded] = useState(false);
  const [shortStorageError, setShortStorageError] = useState(false);
  const [shortActiveSaved, setShortActiveSaved] = useState(null);
  const [shortSessionFeedback, setShortSessionFeedback] = useState(null);
  const [shortResultInput, setShortResultInput] = useState("");

  // ===== Add Coach: live subscription to every coachLinks doc naming this player (any status),
  // so Settings can show "pending" / "connected" / "declined" against each coach without a
  // manual refresh. Separate Firestore collection from this profile's own app data above, so it
  // gets its own small effect rather than folding into the consolidated load below. =====
  const [myCoachLinks, setMyCoachLinks] = useState([]);
  useEffect(() => {
    if (!profileId) return;
    const unsub = watchMyCoachLinks(profileId, setMyCoachLinks);
    return unsub;
  }, [profileId]);

  // Single consolidated load — fetches every stored key for this profile in one parallel batch
  // (loadAllAppDataDemo), rather than 7 separate effects each doing their own round-trip(s).
  useEffect(() => {
    (async () => {
      const data = await loadAllAppData();

      if (data["golf:sessions"]) {
        try {
          setHistory(JSON.parse(data["golf:sessions"]));
        } catch (e) {
          // corrupt or unexpected data — ignore, start fresh
        }
      }
      if (data["golf:activeSession"]) {
        try {
          setActiveSaved(JSON.parse(data["golf:activeSession"]));
        } catch (e) {}
      }
      setLoaded(true);

      if (data["putting:sessions"]) {
        try {
          setPuttHistory(JSON.parse(data["putting:sessions"]));
        } catch (e) {}
      }
      if (data["putting:activeSession"]) {
        try {
          setPuttActiveSaved(JSON.parse(data["putting:activeSession"]));
        } catch (e) {}
      }
      if (data["putting:activeRound"]) {
        try {
          const parsed = JSON.parse(data["putting:activeRound"]);
          // Guard against stale data saved before the on-course entry format changed to
          // per-putt tracking — old rounds had {distanceFt, strokes} per hole instead of a
          // putts array. Rather than crash on the shape mismatch, just discard it: it's only
          // an in-progress round, nothing in permanent history is at risk.
          const looksCurrent = Array.isArray(parsed) && parsed.every((h) => Array.isArray(h.putts));
          if (looksCurrent) {
            setOnCourseHoles(parsed);
          } else {
            window.storage.delete("putting:activeRound", false).catch(() => {});
          }
        } catch (e) {}
      }
      setPuttLoaded(true);

      if (data["putting:clockSessions"]) {
        try {
          setClockHistory(JSON.parse(data["putting:clockSessions"]));
        } catch (e) {}
      }
      setClockLoaded(true);

      // Start Line and Pace Control are newer than the consolidated loadAllAppData() key list
      // above, so they're fetched individually here rather than via `data` — same window.storage
      // API, just not (yet) folded into that batch.
      try {
        const startLineRes = await window.storage.get("putting:startLineSessions", false);
        if (startLineRes && startLineRes.value) setStartLineHistory(JSON.parse(startLineRes.value));
      } catch (e) {}
      setStartLineLoaded(true);

      try {
        const paceRes = await window.storage.get("putting:paceSessions", false);
        if (paceRes && paceRes.value) setPaceHistory(JSON.parse(paceRes.value));
      } catch (e) {}
      setPaceLoaded(true);

      if (data["tee:sessions"]) {
        try {
          setTeeHistory(JSON.parse(data["tee:sessions"]));
        } catch (e) {}
      }
      setTeeLoaded(true);

      if (data["wedgematrix:active"]) {
        try {
          const active = JSON.parse(data["wedgematrix:active"]);
          setWedgeActiveMatrix(active);
        } catch (e) {}
      }
      if (data["wedgematrix:completed"]) {
        try {
          const parsed = JSON.parse(data["wedgematrix:completed"]);
          // Migrate gracefully from the earlier version, which stored one matrix object rather
          // than a history array — wrap it so nothing already saved gets lost.
          setWedgeMatrixHistory(Array.isArray(parsed) ? parsed : [parsed]);
        } catch (e) {}
      }
      setWedgeLoaded(true);

      if (data["gapping:active"]) {
        try {
          const active = JSON.parse(data["gapping:active"]);
          setGappingActiveChart(active);
        } catch (e) {}
      }
      if (data["gapping:completed"]) {
        try {
          const parsed = JSON.parse(data["gapping:completed"]);
          setGappingHistory(Array.isArray(parsed) ? parsed : [parsed]);
        } catch (e) {}
      }
      if (data["gapping:customClubs"]) {
        try {
          const parsed = JSON.parse(data["gapping:customClubs"]);
          setGappingCustomClubs(Array.isArray(parsed) ? parsed : []);
        } catch (e) {}
      }
      setGappingLoaded(true);

      if (data["shortgame:sessions"]) {
        try {
          setShortHistory(JSON.parse(data["shortgame:sessions"]));
        } catch (e) {}
      }
      if (data["shortgame:activeSession"]) {
        try {
          setShortActiveSaved(JSON.parse(data["shortgame:activeSession"]));
        } catch (e) {}
      }
      setShortLoaded(true);

      if (data["settings:preferences"]) {
        try {
          const prefs = JSON.parse(data["settings:preferences"]);
          if (prefs.baselineHandicap) {
            setBaselineHandicapRaw(prefs.baselineHandicap);
            applyBaseline(prefs.baselineHandicap);
          }
          if (prefs.units) setUnitsRaw(prefs.units);
          if (prefs.rangeTrackingMode) setRangeTrackingModeRaw(prefs.rangeTrackingMode);
        } catch (e) {}
      }
      setSettingsLoaded(true);

      if (data["compete:sessions"]) {
        try {
          setCompeteHistory(JSON.parse(data["compete:sessions"]));
        } catch (e) {}
      }
      setCompeteLoaded(true);

      if (data["compete:shortgame:sessions"]) {
        try {
          setSgCompeteHistory(JSON.parse(data["compete:shortgame:sessions"]));
        } catch (e) {}
      }
      setSgCompeteLoaded(true);

      if (data["compete:putting:sessions"]) {
        try {
          setPuttCompeteHistory(JSON.parse(data["compete:putting:sessions"]));
        } catch (e) {}
      }
      setPuttCompeteLoaded(true);
    })();
  }, []);

  async function persistSettings(next) {
    try {
      await window.storage.set(
        "settings:preferences",
        JSON.stringify({ baselineHandicap, units, rangeTrackingMode, ...next }),
        false
      );
    } catch (e) {
      // non-fatal
    }
  }

  async function updateBaselineHandicap(key) {
    setBaselineHandicapRaw(key);
    applyBaseline(key);
    persistSettings({ baselineHandicap: key });
  }

  async function updateUnits(u) {
    setUnitsRaw(u);
    persistSettings({ units: u });
  }

  async function updateRangeTrackingMode(mode) {
    setRangeTrackingModeRaw(mode);
    persistSettings({ rangeTrackingMode: mode });
  }

  async function persistActiveSession(state) {
    setActiveSaved(state);
    try {
      await window.storage.set("golf:activeSession", JSON.stringify(state), false);
    } catch (e) {
      // non-fatal — practice can continue without cross-session resume
    }
  }

  async function clearActiveSession() {
    try {
      await window.storage.delete("golf:activeSession", false);
    } catch (e) {
      // nothing to clear
    }
    setActiveSaved(null);
  }

  useEffect(() => {
    if (screen === "practice" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [screen, shots.length]);

  function startSession() {
    const target = randomTarget(minDist, maxDist);
    setShots([]);
    setCurrentTarget(target);
    setActualInput("");
    setCurrentSessionMode(rangeTrackingMode);
    setScreen("practice");
    persistActiveSession({ shotCount, minDist, maxDist, shots: [], currentTarget: target, mode: rangeTrackingMode });
  }

  function resumeSession() {
    if (!activeSaved) return;
    setShotCount(activeSaved.shotCount);
    setMinDist(activeSaved.minDist);
    setMaxDist(activeSaved.maxDist);
    setShots(activeSaved.shots);
    setCurrentTarget(activeSaved.currentTarget);
    setActualInput("");
    setCurrentSessionMode(activeSaved.mode || "distance");
    setScreen("practice");
  }

  function discardSavedSession() {
    clearActiveSession();
  }

  function submitShot() {
    const actual = unitToYds(parseFloat(actualInput), units);
    if (isNaN(actual) || actual < 0) return;
    const diff = Math.abs(actual - currentTarget);
    const newShots = [...shots, { target: currentTarget, actual, diff }];
    setShots(newShots);
    setActualInput("");
    // Keep the numeric keypad open for the next shot rather than making the user tap the
    // field again every time — refocus happens synchronously within this same tap/click, which
    // is what lets mobile browsers keep the keyboard up instead of dismissing it.
    if (inputRef.current) inputRef.current.focus();

    if (newShots.length >= shotCount) {
      finishSession(newShots);
    } else {
      const nextTarget = randomTarget(minDist, maxDist);
      setCurrentTarget(nextTarget);
      persistActiveSession({ shotCount, minDist, maxDist, shots: newShots, currentTarget: nextTarget, mode: "distance" });
    }
  }

  function submitRating(rating) {
    const newShots = [...shots, { target: currentTarget, rating }];
    setShots(newShots);

    if (newShots.length >= shotCount) {
      finishSession(newShots);
    } else {
      const nextTarget = randomTarget(minDist, maxDist);
      setCurrentTarget(nextTarget);
      persistActiveSession({ shotCount, minDist, maxDist, shots: newShots, currentTarget: nextTarget, mode: "rating" });
    }
  }

  function saveShotEdit(updatedShot) {
    const newShots = shots.map((s, i) => (i === editingShotIndex ? updatedShot : s));
    setShots(newShots);
    setEditingShotIndex(null);
    persistActiveSession({
      shotCount,
      minDist,
      maxDist,
      shots: newShots,
      currentTarget,
      mode: updatedShot.rating !== undefined ? "rating" : "distance",
    });
  }

  function exitToMenu() {
    // progress is already autosaved after each shot — just leave the screen
    setScreen("setup");
  }

  async function finishSession(finalShots) {
    const isRatingMode = finalShots.length > 0 && finalShots[0].rating !== undefined;
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      mode: isRatingMode ? "rating" : "distance",
      shotCount: finalShots.length,
      minDist,
      maxDist,
      shots: finalShots,
      ...(isRatingMode
        ? { avgRating: avg(finalShots.map((s) => s.rating)) }
        : {
            totalDiff: finalShots.reduce((a, s) => a + s.diff, 0),
            avgDiff: avg(finalShots.map((s) => s.diff)),
          }),
    };
    const newHistory = [session, ...history];
    setHistory(newHistory);

    const comparable = newHistory.filter((s) => (isRatingMode ? s.mode === "rating" : s.mode !== "rating"));
    const metricFn = isRatingMode
      ? (s) => avg(s.shots.map((sh) => sh.rating))
      : (s) => avg(s.shots.map((sh) => sgForApproachShot(sh.target, sh.actual)));
    const valueFmt = isRatingMode ? (v) => `${v.toFixed(1)}/5` : formatSG;
    setRangeSessionFeedback(buildSessionFeedback(rankSession(session.id, comparable, metricFn), valueFmt));

    setScreen("summary");
    try {
      await window.storage.set("golf:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStorageError(true);
    }
    clearActiveSession();
  }

  function resetToSetup() {
    setShots([]);
    setCurrentTarget(null);
    setScreen("setup");
  }

  function goHome() {
    setScreen("home");
  }

  async function deleteRangeSession(id) {
    const newHistory = history.filter((s) => s.id !== id);
    setHistory(newHistory);
    try {
      await window.storage.set("golf:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStorageError(true);
    }
  }

  // Corrects a shot within an already-completed (historical) Range session — either mode. Mirrors
  // the cached-field formulas in finishSession() exactly so AVG SG/AVG MISS (distance mode) or AVG
  // RATING (rating mode) never go stale after the edit.
  async function editRangeSessionShot(sessionId, shotIndex, updatedShot) {
    const newHistory = history.map((s) => {
      if (s.id !== sessionId) return s;
      const newShots = s.shots.map((sh, i) => (i === shotIndex ? updatedShot : sh));
      const isRatingMode = s.mode === "rating";
      return {
        ...s,
        shots: newShots,
        ...(isRatingMode
          ? { avgRating: avg(newShots.map((sh) => sh.rating)) }
          : {
              totalDiff: newShots.reduce((a, sh) => a + sh.diff, 0),
              avgDiff: avg(newShots.map((sh) => sh.diff)),
            }),
      };
    });
    setHistory(newHistory);
    try {
      await window.storage.set("golf:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStorageError(true);
    }
  }

  // TEMP: loads generated sample sessions for testing. Remove this handler when asked.
  async function loadTestSessions() {
    const fake = generateFakeSessions();
    const newHistory = [...fake, ...history];
    setHistory(newHistory);
    try {
      await window.storage.set("golf:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStorageError(true);
    }
  }

  async function clearAllRangeSessions() {
    setHistory([]);
    try {
      await window.storage.set("golf:sessions", JSON.stringify([]), false);
    } catch (e) {
      setStorageError(true);
    }
  }

  // ===== Putting handlers =====
  async function persistActivePutting(state) {
    setPuttActiveSaved(state);
    try {
      await window.storage.set("putting:activeSession", JSON.stringify(state), false);
    } catch (e) {
      // non-fatal
    }
  }

  async function clearActivePutting() {
    try {
      await window.storage.delete("putting:activeSession", false);
    } catch (e) {
      // nothing to clear
    }
    setPuttActiveSaved(null);
  }

  function startPuttingSession() {
    const target = randomTarget(puttMinFt, puttMaxFt);
    setPutts([]);
    setPuttCurrentTarget(target);
    setPuttCurrentBreak(null);
    setScreen("puttingPractice");
    persistActivePutting({ puttCount, puttMinFt, puttMaxFt, puttIncludeBreak, putts: [], puttCurrentTarget: target });
  }

  function resumePuttingSession() {
    if (!puttActiveSaved) return;
    setPuttCount(puttActiveSaved.puttCount);
    setPuttMinFt(puttActiveSaved.puttMinFt);
    setPuttMaxFt(puttActiveSaved.puttMaxFt);
    setPuttIncludeBreak(!!puttActiveSaved.puttIncludeBreak);
    setPutts(puttActiveSaved.putts);
    setPuttCurrentTarget(puttActiveSaved.puttCurrentTarget);
    setPuttCurrentBreak(null);
    setScreen("puttingPractice");
  }

  function discardSavedPutting() {
    clearActivePutting();
  }

  function submitPutt(strokes) {
    const newPutts = [...putts, { targetFt: puttCurrentTarget, strokes, ...(puttIncludeBreak ? { break: puttCurrentBreak } : {}) }];
    setPutts(newPutts);

    if (newPutts.length >= puttCount) {
      finishPuttingSession(newPutts);
    } else {
      const nextTarget = randomTarget(puttMinFt, puttMaxFt);
      setPuttCurrentTarget(nextTarget);
      setPuttCurrentBreak(null);
      persistActivePutting({ puttCount, puttMinFt, puttMaxFt, puttIncludeBreak, putts: newPutts, puttCurrentTarget: nextTarget });
    }
  }

  function savePuttShotEdit(updatedShot) {
    const newPutts = putts.map((p, i) => (i === puttEditingShotIndex ? updatedShot : p));
    setPutts(newPutts);
    setPuttEditingShotIndex(null);
    persistActivePutting({ puttCount, puttMinFt, puttMaxFt, puttIncludeBreak, putts: newPutts, puttCurrentTarget });
  }

  function exitPuttingToMenu() {
    setScreen("puttingRandomSetup");
  }

  async function finishPuttingSession(finalPutts) {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      type: "practice",
      puttCount: finalPutts.length,
      puttMinFt,
      puttMaxFt,
      includeBreak: puttIncludeBreak,
      putts: finalPutts,
      totalStrokes: finalPutts.reduce((a, p) => a + p.strokes, 0),
      avgStrokes: avg(finalPutts.map((p) => p.strokes)),
    };
    const newHistory = [session, ...puttHistory];
    setPuttHistory(newHistory);

    const comparable = newHistory.filter((s) => s.type !== "course");
    const metricFn = (s) => avg(s.putts.map((p) => sgForPutt(p.targetFt, p.strokes)));
    setPuttSessionFeedback(buildSessionFeedback(rankSession(session.id, comparable, metricFn), formatSG));
    setPuttSummaryIsOnCourse(false);

    setScreen("puttingSummary");
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
    clearActivePutting();
  }

  // Shared "new session" handler for PuttingSummaryScreen, which covers both Random Practice and
  // On Course rounds — routes back to whichever setup screen actually applies (mirrors the
  // backTarget special-case next to the Header render).
  function resetToPuttingSetup() {
    setPutts([]);
    setPuttCurrentTarget(null);
    setPuttCurrentBreak(null);
    setScreen(puttSummaryIsOnCourse ? "puttingCourseSetup" : "puttingRandomSetup");
  }

  // ===== On-course round handlers =====
  async function persistOnCourseHoles(holes) {
    try {
      await window.storage.set("putting:activeRound", JSON.stringify(holes), false);
    } catch (e) {
      // non-fatal
    }
  }

  function updateOnCourseHole(index, field, value) {
    const next = onCourseHoles.map((h, i) => (i === index ? { ...h, [field]: value } : h));
    setOnCourseHoles(next);
    persistOnCourseHoles(next);
  }

  async function clearOnCourseRound() {
    const fresh = Array.from({ length: 18 }, () => ({ putts: [] }));
    setOnCourseHoles(fresh);
    try {
      await window.storage.delete("putting:activeRound", false);
    } catch (e) {
      // nothing to clear
    }
  }

  async function finishOnCourseRound() {
    const completed = onCourseHoles.filter(isHoleComplete);
    if (completed.length === 0) return;
    const puttedHoles = completed.filter((h) => !h.noPutt);
    const chipIns = completed.filter((h) => h.noPutt).length;
    if (puttedHoles.length === 0) return; // every completed hole was a chip-in — nothing to compute putting stats from
    const finalPutts = puttedHoles.map((h) => ({
      targetFt: h.putts[0].distanceFt,
      strokes: h.putts.length,
      holedFromFt: h.putts[h.putts.length - 1].distanceFt,
    }));
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      type: "course",
      puttCount: finalPutts.length,
      puttMinFt: Math.min(...finalPutts.map((p) => p.targetFt)),
      puttMaxFt: Math.max(...finalPutts.map((p) => p.targetFt)),
      putts: finalPutts,
      totalStrokes: finalPutts.reduce((a, p) => a + p.strokes, 0),
      avgStrokes: avg(finalPutts.map((p) => p.strokes)),
      chipIns, // holes chipped in from off the green — tracked separately, not part of putt stats
      holesPlayed: completed.length, // puttedHoles + chipIns, for context
    };
    const newHistory = [session, ...puttHistory];
    setPuttHistory(newHistory);
    setPutts(finalPutts);

    const comparable = newHistory.filter((s) => s.type === "course");
    const metricFn = (s) => avg(s.putts.map((p) => sgForPutt(p.targetFt, p.strokes)));
    setPuttSessionFeedback(buildSessionFeedback(rankSession(session.id, comparable, metricFn), formatSG));
    setPuttSummaryIsOnCourse(true);
    setPuttSummaryChipIns(chipIns);

    setScreen("puttingSummary");
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
    const fresh = Array.from({ length: 18 }, () => ({ putts: [] }));
    setOnCourseHoles(fresh);
    try {
      await window.storage.delete("putting:activeRound", false);
    } catch (e) {
      // nothing to clear
    }
  }

  async function deletePuttingSession(id) {
    const newHistory = puttHistory.filter((s) => s.id !== id);
    setPuttHistory(newHistory);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  // Corrects one putt/hole entry within an already-completed Putting session — used for BOTH
  // practice sessions and on-course rounds, since both live in puttHistory and share the
  // totalStrokes/avgStrokes cached fields (mirrors finishPuttingSession()/finishOnCourseRound()).
  //
  // On-course entries additionally carry `holedFromFt` (exact distance the ball actually went in
  // from — only ever captured live, per-putt). The simple targetFt+strokes editor used here can't
  // reconstruct that precisely after an edit, so: a 1-putt is unambiguous (holed from the target
  // distance itself); anything else falls back to the same graceful approximation courseRoundStats
  // already uses for pre-rework historical data (holedFromFt == null).
  async function editPuttingSessionPutt(sessionId, puttIndex, updatedPutt) {
    const newHistory = puttHistory.map((s) => {
      if (s.id !== sessionId) return s;
      const newPutts = s.putts.map((p, i) => {
        if (i !== puttIndex) return p;
        if (s.type === "course") {
          return {
            ...p,
            targetFt: updatedPutt.targetFt,
            strokes: updatedPutt.strokes,
            holedFromFt: updatedPutt.strokes === 1 ? updatedPutt.targetFt : null,
          };
        }
        return updatedPutt;
      });
      return {
        ...s,
        putts: newPutts,
        totalStrokes: newPutts.reduce((a, p) => a + p.strokes, 0),
        avgStrokes: avg(newPutts.map((p) => p.strokes)),
      };
    });
    setPuttHistory(newHistory);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  // ===== Putting — "Around the Clock" handlers =====
  // One putt from each of 3,4,5,6,7,8,9,10ft, laid out as 8 spokes around a central hole at 8
  // evenly-spaced "clock" positions (45° apart) — which distance lands at which position is
  // reshuffled every round, which is the "random around the hole" part; the positions themselves
  // stay evenly spaced (plus a little jitter) so labels never visually collide.
  function startClockRound() {
    const distances = [3, 4, 5, 6, 7, 8, 9, 10];
    const basePositions = shuffleArray([0, 45, 90, 135, 180, 225, 270, 315]);
    const fresh = distances.map((ft, i) => ({
      targetFt: ft,
      // ±8° jitter off the evenly-spaced clock position so it doesn't look mechanically
      // perfect, while still guaranteeing enough separation that two markers can never overlap
      // even in the worst case (the two shortest distances, 3ft and 4ft, landing next to each
      // other with minimal jitter — checked against PuttingClockPlayScreen's radius/marker size).
      angleDeg: basePositions[i] + (Math.random() * 16 - 8),
      strokes: null,
    }));
    setClockPutts(fresh);
    setClockPendingIndex(null);
    setScreen("puttingClockPlay");
  }

  // Opens the made/missed prompt for one spoke — only unanswered spokes respond, so re-tapping
  // an already-answered one (or a stray tap while the prompt for a different spoke is open) does
  // nothing rather than letting you overwrite a result via the wrong prompt.
  function openClockPutt(index) {
    if (clockPutts[index]?.strokes !== null) return;
    setClockPendingIndex(index);
  }

  function cancelClockPrompt() {
    setClockPendingIndex(null);
  }

  // Records made (1 putt) or missed (assumed 2 — see the miss-scoring note on sgForPutt's call
  // below) for whichever spoke is currently pending, then either opens the next spoke or, once
  // all 8 are answered, finishes the round.
  function recordClockPutt(made) {
    if (clockPendingIndex === null) return;
    const newPutts = clockPutts.map((p, i) => (i === clockPendingIndex ? { ...p, strokes: made ? 1 : 2 } : p));
    setClockPutts(newPutts);
    setClockPendingIndex(null);
    if (newPutts.every((p) => p.strokes !== null)) {
      finishClockRound(newPutts);
    }
  }

  async function finishClockRound(finalPutts) {
    const made = finalPutts.filter((p) => p.strokes === 1).length;
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      type: "clock",
      puttCount: finalPutts.length,
      puttMinFt: 3,
      puttMaxFt: 10,
      putts: finalPutts.map((p) => ({ targetFt: p.targetFt, strokes: p.strokes })),
      totalStrokes: finalPutts.reduce((a, p) => a + p.strokes, 0),
      avgStrokes: avg(finalPutts.map((p) => p.strokes)),
      made,
    };
    const newHistory = [session, ...clockHistory];
    setClockHistory(newHistory);
    setScreen("puttingClockSummary");
    try {
      await window.storage.set("putting:clockSessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setClockStorageError(true);
    }
  }

  function exitClockRound() {
    setScreen("puttingClockIntro");
  }

  async function deleteClockSession(id) {
    const newHistory = clockHistory.filter((s) => s.id !== id);
    setClockHistory(newHistory);
    try {
      await window.storage.set("putting:clockSessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setClockStorageError(true);
    }
  }

  // Corrects one putt within an already-completed Around the Clock round (e.g. fat-fingered
  // made/missed) — mirrors editPuttingSessionPutt, minus the on-course-only holedFromFt handling
  // that doesn't apply here, plus keeping the cached `made` count in sync.
  async function editClockSessionPutt(sessionId, puttIndex, updatedPutt) {
    const newHistory = clockHistory.map((s) => {
      if (s.id !== sessionId) return s;
      const newPutts = s.putts.map((p, i) => (i === puttIndex ? updatedPutt : p));
      return {
        ...s,
        putts: newPutts,
        totalStrokes: newPutts.reduce((a, p) => a + p.strokes, 0),
        avgStrokes: avg(newPutts.map((p) => p.strokes)),
        made: newPutts.filter((p) => p.strokes === 1).length,
      };
    });
    setClockHistory(newHistory);
    try {
      await window.storage.set("putting:clockSessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setClockStorageError(true);
    }
  }

  // TEMP: loads generated sample putting sessions for testing. Remove this handler when asked.
  async function loadTestPuttingSessions() {
    const fake = generateFakePuttingSessions();
    const newHistory = [...fake, ...puttHistory];
    setPuttHistory(newHistory);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  async function clearAllPuttingPracticeSessions() {
    const kept = puttHistory.filter((s) => s.type === "course");
    setPuttHistory(kept);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(kept), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  // TEMP: loads generated sample on-course rounds for testing. Remove this handler when asked.
  async function loadTestCourseRounds() {
    const fake = generateFakeCourseRounds();
    const newHistory = [...fake, ...puttHistory];
    setPuttHistory(newHistory);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  async function clearAllPuttingCourseSessions() {
    const kept = puttHistory.filter((s) => s.type !== "course");
    setPuttHistory(kept);
    try {
      await window.storage.set("putting:sessions", JSON.stringify(kept), false);
    } catch (e) {
      setPuttStorageError(true);
    }
  }

  async function clearAllPuttingClockSessions() {
    setClockHistory([]);
    try {
      await window.storage.set("putting:clockSessions", JSON.stringify([]), false);
    } catch (e) {
      setClockStorageError(true);
    }
  }

  // ===== Putting — Start Line handlers =====
  function startStartLineDrill() {
    setStartLineMadeInput("");
    setScreen("puttingStartLinePlay");
  }

  async function submitStartLineDrill() {
    const parsed = parseInt(startLineMadeInput, 10);
    const made = Math.max(0, Math.min(10, isNaN(parsed) ? 0 : parsed));
    const session = { id: uid(), date: new Date().toISOString(), made, total: 10 };
    const newHistory = [session, ...startLineHistory];
    setStartLineHistory(newHistory);
    setScreen("puttingStartLineSummary");
    try {
      await window.storage.set("putting:startLineSessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStartLineStorageError(true);
    }
  }

  function exitStartLineDrill() {
    setScreen("puttingStartLineIntro");
  }

  async function deleteStartLineSession(id) {
    const newHistory = startLineHistory.filter((s) => s.id !== id);
    setStartLineHistory(newHistory);
    try {
      await window.storage.set("putting:startLineSessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStartLineStorageError(true);
    }
  }

  // Corrects a past round's made-count (e.g. the "wrong figure entered" complaint that started
  // this whole edit-everywhere push) — clamped the same way the original submit is.
  async function editStartLineSession(sessionId, newMade) {
    const parsed = parseInt(newMade, 10);
    const clamped = Math.max(0, Math.min(10, isNaN(parsed) ? 0 : parsed));
    const newHistory = startLineHistory.map((s) => (s.id === sessionId ? { ...s, made: clamped } : s));
    setStartLineHistory(newHistory);
    try {
      await window.storage.set("putting:startLineSessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setStartLineStorageError(true);
    }
  }

  async function clearAllStartLineSessions() {
    setStartLineHistory([]);
    try {
      await window.storage.set("putting:startLineSessions", JSON.stringify([]), false);
    } catch (e) {
      setStartLineStorageError(true);
    }
  }

  // ===== Putting — Pace Control handlers =====
  function togglePaceDistance(ft) {
    setPaceSelectedDistances((prev) => (prev.includes(ft) ? prev.filter((d) => d !== ft) : [...prev, ft]));
  }

  function startPaceDrill() {
    const queue = [];
    paceSelectedDistances.forEach((ft) => {
      for (let i = 0; i < pacePuttsPerDistance; i++) queue.push({ targetFt: ft, points: null });
    });
    setPacePutts(shuffleArray(queue));
    setPaceCurrentIndex(0);
    setScreen("puttingPacePlay");
  }

  function recordPacePutt(points) {
    const newPutts = pacePutts.map((p, i) => (i === paceCurrentIndex ? { ...p, points } : p));
    setPacePutts(newPutts);
    if (paceCurrentIndex + 1 >= newPutts.length) {
      finishPaceDrill(newPutts);
    } else {
      setPaceCurrentIndex(paceCurrentIndex + 1);
    }
  }

  async function finishPaceDrill(finalPutts) {
    const totalPoints = finalPutts.reduce((a, p) => a + (p.points || 0), 0);
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      distances: [...paceSelectedDistances].sort((a, b) => a - b),
      puttsPerDistance: pacePuttsPerDistance,
      putts: finalPutts,
      totalPoints,
      maxPoints: finalPutts.length * 3,
    };
    const newHistory = [session, ...paceHistory];
    setPaceHistory(newHistory);
    setScreen("puttingPaceSummary");
    try {
      await window.storage.set("putting:paceSessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPaceStorageError(true);
    }
  }

  function exitPaceDrill() {
    setScreen("puttingPaceSetup");
  }

  async function deletePaceSession(id) {
    const newHistory = paceHistory.filter((s) => s.id !== id);
    setPaceHistory(newHistory);
    try {
      await window.storage.set("putting:paceSessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPaceStorageError(true);
    }
  }

  // Corrects one putt's points within an already-completed Pace Control round, recomputing the
  // cached totalPoints the summary/analysis screens read — same "don't let edits go stale" rule
  // as every other historical-edit handler in this file.
  async function editPacePuttPoints(sessionId, puttIndex, newPoints) {
    const clamped = Math.max(0, Math.min(3, newPoints));
    const newHistory = paceHistory.map((s) => {
      if (s.id !== sessionId) return s;
      const newPutts = s.putts.map((p, i) => (i === puttIndex ? { ...p, points: clamped } : p));
      const totalPoints = newPutts.reduce((a, p) => a + (p.points || 0), 0);
      return { ...s, putts: newPutts, totalPoints };
    });
    setPaceHistory(newHistory);
    try {
      await window.storage.set("putting:paceSessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setPaceStorageError(true);
    }
  }

  async function clearAllPaceSessions() {
    setPaceHistory([]);
    try {
      await window.storage.set("putting:paceSessions", JSON.stringify([]), false);
    } catch (e) {
      setPaceStorageError(true);
    }
  }

  // ===== Short Game handlers =====
  function toggleShortLie(lie) {
    setShortLies((prev) => {
      if (prev.includes(lie)) return prev.filter((l) => l !== lie);
      return [...prev, lie];
    });
  }

  function randomShortShot(lies, minYds, maxYds) {
    const lie = lies[Math.floor(Math.random() * lies.length)];
    const target = randomTarget(minYds, maxYds);
    return { lie, target };
  }

  async function persistActiveShortGame(state) {
    setShortActiveSaved(state);
    try {
      await window.storage.set("shortgame:activeSession", JSON.stringify(state), false);
    } catch (e) {
      // non-fatal
    }
  }

  async function clearActiveShortGame() {
    try {
      await window.storage.delete("shortgame:activeSession", false);
    } catch (e) {
      // nothing to clear
    }
    setShortActiveSaved(null);
  }

  function startShortGameSession() {
    const first = randomShortShot(shortLies, shortMinYds, shortMaxYds);
    setShortShots([]);
    setShortCurrentShot(first);
    setShortResultInput("");
    setScreen("shortGamePractice");
    persistActiveShortGame({ shortShotCount, shortMinYds, shortMaxYds, shortLies, shortShots: [], shortCurrentShot: first });
  }

  function resumeShortGameSession() {
    if (!shortActiveSaved) return;
    setShortShotCount(shortActiveSaved.shortShotCount);
    setShortMinYds(shortActiveSaved.shortMinYds);
    setShortMaxYds(shortActiveSaved.shortMaxYds);
    setShortLies(shortActiveSaved.shortLies);
    setShortShots(shortActiveSaved.shortShots);
    setShortCurrentShot(shortActiveSaved.shortCurrentShot);
    setShortResultInput("");
    setScreen("shortGamePractice");
  }

  function discardSavedShortGame() {
    clearActiveShortGame();
  }

  function rerollShortGameShot() {
    const next = randomShortShot(shortLies, shortMinYds, shortMaxYds);
    setShortCurrentShot(next);
    persistActiveShortGame({
      shortShotCount,
      shortMinYds,
      shortMaxYds,
      shortLies,
      shortShots,
      shortCurrentShot: next,
    });
  }

  function submitShortGameShot(overrideFt) {
    const resultFt = overrideFt !== undefined ? overrideFt : unitToFt(parseFloat(shortResultInput), units);
    if (isNaN(resultFt) || resultFt < 0) return;
    const newShots = [...shortShots, { lie: shortCurrentShot.lie, target: shortCurrentShot.target, resultFt }];
    setShortShots(newShots);
    setShortResultInput("");

    if (newShots.length >= shortShotCount) {
      finishShortGameSession(newShots);
    } else {
      const next = randomShortShot(shortLies, shortMinYds, shortMaxYds);
      setShortCurrentShot(next);
      persistActiveShortGame({
        shortShotCount,
        shortMinYds,
        shortMaxYds,
        shortLies,
        shortShots: newShots,
        shortCurrentShot: next,
      });
    }
  }

  function saveShortGameShotEdit(updatedShot) {
    const newShots = shortShots.map((s, i) => (i === shortEditingShotIndex ? updatedShot : s));
    setShortShots(newShots);
    setShortEditingShotIndex(null);
    persistActiveShortGame({
      shortShotCount,
      shortMinYds,
      shortMaxYds,
      shortLies,
      shortShots: newShots,
      shortCurrentShot,
    });
  }

  function exitShortGameToMenu() {
    setScreen("shortgame");
  }

  async function finishShortGameSession(finalShots) {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      shotCount: finalShots.length,
      minYds: shortMinYds,
      maxYds: shortMaxYds,
      lies: shortLies,
      shots: finalShots,
      avgResultFt: avg(finalShots.map((s) => s.resultFt)),
    };
    const newHistory = [session, ...shortHistory];
    setShortHistory(newHistory);

    const metricFn = (s) => avg(s.shots.map((sh) => sgForShortGameShot(sh.lie, sh.target, sh.resultFt)));
    setShortSessionFeedback(buildSessionFeedback(rankSession(session.id, newHistory, metricFn), formatSG));

    setScreen("shortGameSummary");
    try {
      await window.storage.set("shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setShortStorageError(true);
    }
    clearActiveShortGame();
  }

  function resetToShortGameSetup() {
    setShortShots([]);
    setShortCurrentShot(null);
    setScreen("shortgame");
  }

  async function deleteShortGameSession(id) {
    const newHistory = shortHistory.filter((s) => s.id !== id);
    setShortHistory(newHistory);
    try {
      await window.storage.set("shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setShortStorageError(true);
    }
  }

  // Corrects a shot within an already-completed Short Game session — mirrors finishShortGameSession()'s
  // avgResultFt formula so the cached stat never goes stale after the edit.
  async function editShortGameSessionShot(sessionId, shotIndex, updatedShot) {
    const newHistory = shortHistory.map((s) => {
      if (s.id !== sessionId) return s;
      const newShots = s.shots.map((sh, i) => (i === shotIndex ? updatedShot : sh));
      return { ...s, shots: newShots, avgResultFt: avg(newShots.map((sh) => sh.resultFt)) };
    });
    setShortHistory(newHistory);
    try {
      await window.storage.set("shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setShortStorageError(true);
    }
  }

  // ===== Compete (Range) handlers =====
  function updateCompetePlayerName(idx, name) {
    setCompetePlayers((prev) => prev.map((p, i) => (i === idx ? name : p)));
  }

  function addCompetePlayer() {
    setCompetePlayers((prev) => (prev.length < 4 ? [...prev, ""] : prev));
  }

  function removeCompetePlayer(idx) {
    setCompetePlayers((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));
  }

  // Points per round: with N players, 1st gets (N-1) points, 2nd gets (N-2), ..., last gets 0.
  // Only meaningful in distance mode, where every player's proximity is actually measured.
  function rankCompeteEntries(entries, target) {
    const sorted = [...entries].sort((a, b) => Math.abs(a.distance - target) - Math.abs(b.distance - target));
    const n = sorted.length;
    return sorted.map((e, i) => ({ ...e, diff: Math.abs(e.distance - target), rank: i + 1, points: n - 1 - i }));
  }

  function startCompete() {
    const validPlayers = competePlayers.map((p) => p.trim()).filter(Boolean);
    if (validPlayers.length < 2) return;
    const target = randomTarget(competeMinDist, competeMaxDist);
    setCompetePlayers(validPlayers);
    setCompeteRoundResults([]);
    setCompeteCurrentTarget(target);
    setCompeteCurrentPlayerIdx(0);
    setCompeteRoundEntries([]);
    setCompeteDistanceInput("");
    setCompeteRoundComplete(false);
    setCompeteRoundStandings([]);
    setScreen("competePlay");
  }

  function submitCompeteDistance() {
    const val = unitToYds(parseFloat(competeDistanceInput), units);
    if (isNaN(val) || val < 0) return;
    const player = competePlayers[competeCurrentPlayerIdx];
    const newEntries = [...competeRoundEntries, { player, distance: val }];
    setCompeteRoundEntries(newEntries);
    setCompeteDistanceInput("");

    if (competeCurrentPlayerIdx + 1 < competePlayers.length) {
      setCompeteCurrentPlayerIdx(competeCurrentPlayerIdx + 1);
    } else {
      const standings = rankCompeteEntries(newEntries, competeCurrentTarget);
      setCompeteRoundResults((prev) => [...prev, { target: competeCurrentTarget, entries: newEntries, standings }]);
      setCompeteRoundStandings(standings);
      setCompeteRoundComplete(true);
    }
  }

  function selectClosestPlayer(player) {
    // Closest-only mode: no distances entered, so only a flat 1pt to the tapped player is possible —
    // there's no data to rank 2nd/3rd/4th the way distance mode can.
    const standings = competePlayers.map((p) => ({ player: p, points: p === player ? 1 : 0, rank: p === player ? 1 : null }));
    setCompeteRoundResults((prev) => [...prev, { target: competeCurrentTarget, winner: player, standings }]);
    setCompeteRoundStandings(standings);
    setCompeteRoundComplete(true);
  }

  function nextCompeteRound() {
    if (competeRoundResults.length >= competeRounds) {
      finishCompete();
      return;
    }
    const target = randomTarget(competeMinDist, competeMaxDist);
    setCompeteCurrentTarget(target);
    setCompeteCurrentPlayerIdx(0);
    setCompeteRoundEntries([]);
    setCompeteDistanceInput("");
    setCompeteRoundComplete(false);
    setCompeteRoundStandings([]);
  }

  async function finishCompete() {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      mode: competeMode,
      players: competePlayers,
      minDist: competeMinDist,
      maxDist: competeMaxDist,
      rounds: competeRoundResults,
    };
    const newHistory = [session, ...competeHistory];
    setCompeteHistory(newHistory);
    setCompeteSummarySessionId(session.id);
    setScreen("competeSummary");
    try {
      await window.storage.set("compete:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal — summary still shows from local state
    }
  }

  // Amends a round from the *finished* Summary screen (as opposed to saveCompeteRoundEdit, which
  // only ever runs mid-competition, before a history entry exists). Updates both the live round
  // list this screen renders from and the saved competeHistory entry, so the correction survives —
  // otherwise it would look fixed here but silently revert next time this competition was opened.
  async function saveCompeteRoundEditFromSummary(updatedRound) {
    const idx = competeSummaryEditingIndex;
    const newRoundResults = competeRoundResults.map((r, i) => (i === idx ? updatedRound : r));
    setCompeteRoundResults(newRoundResults);
    setCompeteSummaryEditingIndex(null);
    if (!competeSummarySessionId) return;
    const newHistory = competeHistory.map((s) => (s.id === competeSummarySessionId ? { ...s, rounds: newRoundResults } : s));
    setCompeteHistory(newHistory);
    try {
      await window.storage.set("compete:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function exitCompeteEarly() {
    finishCompete();
  }

  function resetCompeteToSetup() {
    setScreen("competeSetup");
  }

  async function deleteCompeteSession(id) {
    const newHistory = competeHistory.filter((s) => s.id !== id);
    setCompeteHistory(newHistory);
    try {
      await window.storage.set("compete:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function saveCompeteRoundEdit(updatedRound) {
    setCompeteRoundResults((prev) => prev.map((r, i) => (i === competeEditingIndex ? updatedRound : r)));
    setCompeteEditingIndex(null);
  }

  // ===== Compete (Short Game) handlers =====
  function updateSgCompetePlayerName(idx, name) {
    setSgCompetePlayers((prev) => prev.map((p, i) => (i === idx ? name : p)));
  }
  function addSgCompetePlayer() {
    setSgCompetePlayers((prev) => (prev.length < 4 ? [...prev, ""] : prev));
  }
  function removeSgCompetePlayer(idx) {
    setSgCompetePlayers((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));
  }
  function toggleSgCompeteLie(lie) {
    setSgCompeteLies((prev) => (prev.includes(lie) ? prev.filter((l) => l !== lie) : [...prev, lie]));
  }
  function randomSgCompeteShot() {
    const lie = sgCompeteLies[Math.floor(Math.random() * sgCompeteLies.length)];
    const target = randomTarget(sgCompeteMinYds, sgCompeteMaxYds);
    return { lie, target };
  }

  function startSgCompete() {
    const validPlayers = sgCompetePlayers.map((p) => p.trim()).filter(Boolean);
    if (validPlayers.length < 2) return;
    setSgCompetePlayers(validPlayers);
    setSgCompeteRoundResults([]);
    setSgCompeteCurrentShot(randomSgCompeteShot());
    setSgCompeteCurrentPlayerIdx(0);
    setSgCompeteRoundEntries([]);
    setSgCompeteResultInput("");
    setSgCompeteRoundComplete(false);
    setSgCompeteRoundStandings([]);
    setScreen("competeShortGamePlay");
  }

  function submitSgCompeteDistance() {
    const val = unitToFt(parseFloat(sgCompeteResultInput), units);
    if (isNaN(val) || val < 0) return;
    const player = sgCompetePlayers[sgCompeteCurrentPlayerIdx];
    const newEntries = [...sgCompeteRoundEntries, { player, resultFt: val }];
    setSgCompeteRoundEntries(newEntries);
    setSgCompeteResultInput("");

    if (sgCompeteCurrentPlayerIdx + 1 < sgCompetePlayers.length) {
      setSgCompeteCurrentPlayerIdx(sgCompeteCurrentPlayerIdx + 1);
    } else {
      const standings = rankCompeteByProximity(newEntries, "resultFt");
      setSgCompeteRoundResults((prev) => [...prev, { lie: sgCompeteCurrentShot.lie, target: sgCompeteCurrentShot.target, entries: newEntries, standings }]);
      setSgCompeteRoundStandings(standings);
      setSgCompeteRoundComplete(true);
    }
  }

  function selectSgCompeteClosest(player) {
    const standings = sgCompetePlayers.map((p) => ({ player: p, points: p === player ? 1 : 0, rank: p === player ? 1 : null }));
    setSgCompeteRoundResults((prev) => [...prev, { lie: sgCompeteCurrentShot.lie, target: sgCompeteCurrentShot.target, winner: player, standings }]);
    setSgCompeteRoundStandings(standings);
    setSgCompeteRoundComplete(true);
  }

  function nextSgCompeteRound() {
    if (sgCompeteRoundResults.length >= sgCompeteRounds) {
      finishSgCompete();
      return;
    }
    setSgCompeteCurrentShot(randomSgCompeteShot());
    setSgCompeteCurrentPlayerIdx(0);
    setSgCompeteRoundEntries([]);
    setSgCompeteResultInput("");
    setSgCompeteRoundComplete(false);
    setSgCompeteRoundStandings([]);
  }

  async function finishSgCompete() {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      mode: sgCompeteMode,
      players: sgCompetePlayers,
      minYds: sgCompeteMinYds,
      maxYds: sgCompeteMaxYds,
      lies: sgCompeteLies,
      rounds: sgCompeteRoundResults,
    };
    const newHistory = [session, ...sgCompeteHistory];
    setSgCompeteHistory(newHistory);
    setSgCompeteSummarySessionId(session.id);
    setScreen("competeShortGameSummary");
    try {
      await window.storage.set("compete:shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  // Same idea as saveCompeteRoundEditFromSummary, for Short Game Compete.
  async function saveSgCompeteRoundEditFromSummary(updatedRound) {
    const idx = sgCompeteSummaryEditingIndex;
    const newRoundResults = sgCompeteRoundResults.map((r, i) => (i === idx ? updatedRound : r));
    setSgCompeteRoundResults(newRoundResults);
    setSgCompeteSummaryEditingIndex(null);
    if (!sgCompeteSummarySessionId) return;
    const newHistory = sgCompeteHistory.map((s) => (s.id === sgCompeteSummarySessionId ? { ...s, rounds: newRoundResults } : s));
    setSgCompeteHistory(newHistory);
    try {
      await window.storage.set("compete:shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function exitSgCompeteEarly() {
    finishSgCompete();
  }

  function resetSgCompeteToSetup() {
    setScreen("competeShortGameSetup");
  }

  async function deleteSgCompeteSession(id) {
    const newHistory = sgCompeteHistory.filter((s) => s.id !== id);
    setSgCompeteHistory(newHistory);
    try {
      await window.storage.set("compete:shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function saveSgCompeteRoundEdit(updatedRound) {
    setSgCompeteRoundResults((prev) => prev.map((r, i) => (i === sgCompeteEditingIndex ? updatedRound : r)));
    setSgCompeteEditingIndex(null);
  }

  // ===== Compete (Putting) handlers — tally of putts taken, SG shown only at the end =====
  function updatePuttCompetePlayerName(idx, name) {
    setPuttCompetePlayers((prev) => prev.map((p, i) => (i === idx ? name : p)));
  }
  function addPuttCompetePlayer() {
    setPuttCompetePlayers((prev) => (prev.length < 4 ? [...prev, ""] : prev));
  }
  function removePuttCompetePlayer(idx) {
    setPuttCompetePlayers((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));
  }

  function startPuttCompete() {
    const validPlayers = puttCompetePlayers.map((p) => p.trim()).filter(Boolean);
    if (validPlayers.length < 2) return;
    setPuttCompetePlayers(validPlayers);
    setPuttCompeteHoleResults([]);
    setPuttCompeteCurrentTarget(randomTarget(puttCompeteMinFt, puttCompeteMaxFt));
    setPuttCompeteCurrentPlayerIdx(0);
    setPuttCompeteHoleEntries([]);
    setPuttCompeteHoleComplete(false);
    setScreen("competePuttingPlay");
  }

  function submitPuttCompeteStrokes(n) {
    const player = puttCompetePlayers[puttCompeteCurrentPlayerIdx];
    const newEntries = [...puttCompeteHoleEntries, { player, strokes: n }];
    setPuttCompeteHoleEntries(newEntries);

    if (puttCompeteCurrentPlayerIdx + 1 < puttCompetePlayers.length) {
      setPuttCompeteCurrentPlayerIdx(puttCompeteCurrentPlayerIdx + 1);
    } else {
      setPuttCompeteHoleResults((prev) => [...prev, { target: puttCompeteCurrentTarget, putts: newEntries }]);
      setPuttCompeteHoleComplete(true);
    }
  }

  function nextPuttCompeteHole() {
    if (puttCompeteHoleResults.length >= puttCompeteHoles) {
      finishPuttCompete();
      return;
    }
    setPuttCompeteCurrentTarget(randomTarget(puttCompeteMinFt, puttCompeteMaxFt));
    setPuttCompeteCurrentPlayerIdx(0);
    setPuttCompeteHoleEntries([]);
    setPuttCompeteHoleComplete(false);
  }

  async function finishPuttCompete() {
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      players: puttCompetePlayers,
      minFt: puttCompeteMinFt,
      maxFt: puttCompeteMaxFt,
      holes: puttCompeteHoleResults,
    };
    const newHistory = [session, ...puttCompeteHistory];
    setPuttCompeteHistory(newHistory);
    setPuttCompeteSummarySessionId(session.id);
    setScreen("competePuttingSummary");
    try {
      await window.storage.set("compete:putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  // Same idea as saveCompeteRoundEditFromSummary, for Putting Compete (holes, not rounds).
  async function savePuttCompeteHoleEditFromSummary(updatedHole) {
    const idx = puttCompeteSummaryEditingIndex;
    const newHoleResults = puttCompeteHoleResults.map((h, i) => (i === idx ? updatedHole : h));
    setPuttCompeteHoleResults(newHoleResults);
    setPuttCompeteSummaryEditingIndex(null);
    if (!puttCompeteSummarySessionId) return;
    const newHistory = puttCompeteHistory.map((s) => (s.id === puttCompeteSummarySessionId ? { ...s, holes: newHoleResults } : s));
    setPuttCompeteHistory(newHistory);
    try {
      await window.storage.set("compete:putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function exitPuttCompeteEarly() {
    finishPuttCompete();
  }

  function resetPuttCompeteToSetup() {
    setScreen("competePuttingSetup");
  }

  async function deletePuttCompeteSession(id) {
    const newHistory = puttCompeteHistory.filter((s) => s.id !== id);
    setPuttCompeteHistory(newHistory);
    try {
      await window.storage.set("compete:putting:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function savePuttCompeteHoleEdit(updatedHole) {
    setPuttCompeteHoleResults((prev) => prev.map((h, i) => (i === puttCompeteEditingIndex ? updatedHole : h)));
    setPuttCompeteEditingIndex(null);
  }

  // ===== Tee Accuracy handlers =====
  function toggleTeeClub(club) {
    setTeeClubs((prev) => (prev.includes(club) ? prev.filter((c) => c !== club) : [...prev, club]));
  }

  function randomTeeClub() {
    return teeClubs[Math.floor(Math.random() * teeClubs.length)];
  }

  function startTeeSession() {
    setTeeShots([]);
    setTeeCurrentClub(randomTeeClub());
    setScreen("teeAccuracyPractice");
  }

  function submitTeeShot(hit) {
    const newShots = [...teeShots, { club: teeCurrentClub, hit }];
    setTeeShots(newShots);
    if (newShots.length >= teeShotCount) {
      finishTeeSession(newShots);
    } else {
      setTeeCurrentClub(randomTeeClub());
    }
  }

  function saveTeeShotEdit(updatedShot) {
    const newShots = teeShots.map((s, i) => (i === teeEditingShotIndex ? updatedShot : s));
    setTeeShots(newShots);
    setTeeEditingShotIndex(null);
  }

  async function finishTeeSession(finalShots) {
    const hitCount = finalShots.filter((s) => s.hit).length;
    const session = {
      id: uid(),
      date: new Date().toISOString(),
      shotCount: finalShots.length,
      fairwayWidth: teeFairwayWidth,
      clubs: teeClubs,
      shots: finalShots,
      hitCount,
      hitPct: (hitCount / finalShots.length) * 100,
    };
    const newHistory = [session, ...teeHistory];
    setTeeHistory(newHistory);
    setScreen("teeAccuracySummary");
    try {
      await window.storage.set("tee:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setTeeStorageError(true);
    }
  }

  function resetTeeToSetup() {
    setTeeShots([]);
    setTeeCurrentClub(null);
    setScreen("teeaccuracy");
  }

  async function deleteTeeSession(id) {
    const newHistory = teeHistory.filter((s) => s.id !== id);
    setTeeHistory(newHistory);
    try {
      await window.storage.set("tee:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setTeeStorageError(true);
    }
  }

  // Corrects a shot within an already-completed Tee Accuracy session — mirrors finishTeeSession()'s
  // hitCount/hitPct formula so the cached stats never go stale after the edit.
  async function editTeeSessionShot(sessionId, shotIndex, updatedShot) {
    const newHistory = teeHistory.map((s) => {
      if (s.id !== sessionId) return s;
      const newShots = s.shots.map((sh, i) => (i === shotIndex ? updatedShot : sh));
      const hitCount = newShots.filter((sh) => sh.hit).length;
      return { ...s, shots: newShots, hitCount, hitPct: (hitCount / newShots.length) * 100 };
    });
    setTeeHistory(newHistory);
    try {
      await window.storage.set("tee:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setTeeStorageError(true);
    }
  }

  // TEMP: loads generated sample short game sessions for testing. Remove this handler when asked.
  async function loadTestShortGameSessions() {
    const fake = generateFakeShortGameSessions();
    const newHistory = [...fake, ...shortHistory];
    setShortHistory(newHistory);
    try {
      await window.storage.set("shortgame:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setShortStorageError(true);
    }
  }

  async function clearAllShortGameSessions() {
    setShortHistory([]);
    try {
      await window.storage.set("shortgame:sessions", JSON.stringify([]), false);
    } catch (e) {
      setShortStorageError(true);
    }
  }

  // TEMP: loads generated sample tee accuracy sessions for testing. Remove this handler when asked.
  async function loadTestTeeSessions() {
    const fake = generateFakeTeeSessions();
    const newHistory = [...fake, ...teeHistory];
    setTeeHistory(newHistory);
    try {
      await window.storage.set("tee:sessions", JSON.stringify(newHistory), false);
    } catch (e) {
      setTeeStorageError(true);
    }
  }

  async function clearAllTeeSessions() {
    setTeeHistory([]);
    try {
      await window.storage.set("tee:sessions", JSON.stringify([]), false);
    } catch (e) {
      setTeeStorageError(true);
    }
  }

  // ===== Wedge Matrix handlers =====
  function toggleWedgeClub(key) {
    setWedgeSelectedClubs((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function toggleWedgeSwing(key) {
    setWedgeSelectedSwings((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function persistActiveWedgeMatrix(state) {
    setWedgeActiveMatrix(state);
    try {
      await window.storage.set("wedgematrix:active", JSON.stringify(state), false);
    } catch (e) {
      // non-fatal — progress just won't resume if the tab closes before the next save
    }
  }

  async function clearActiveWedgeMatrixStorage() {
    setWedgeActiveMatrix(null);
    try {
      await window.storage.delete("wedgematrix:active", false);
    } catch (e) {
      // nothing to clear
    }
  }

  function startWedgeMatrix() {
    const sequence = buildWedgeComboSequence(wedgeSelectedClubs, wedgeSelectedSwings);
    if (sequence.length === 0) return;
    setWedgeSequence(sequence);
    setWedgeComboIndex(0);
    setWedgeCurrentShots([]);
    setWedgeDistanceInput("");
    setWedgeComboComplete(false);
    setWedgeResults({});
    setScreen("wedgeMatrixPractice");
    persistActiveWedgeMatrix({
      selectedClubs: wedgeSelectedClubs,
      selectedSwings: wedgeSelectedSwings,
      shotsPerCombo: wedgeShotsPerCombo,
      sequence,
      comboIndex: 0,
      currentShots: [],
      results: {},
    });
  }

  function resumeWedgeMatrix() {
    if (!wedgeActiveMatrix) return;
    setWedgeSelectedClubs(wedgeActiveMatrix.selectedClubs);
    setWedgeSelectedSwings(wedgeActiveMatrix.selectedSwings);
    setWedgeShotsPerCombo(wedgeActiveMatrix.shotsPerCombo);
    setWedgeSequence(wedgeActiveMatrix.sequence);
    setWedgeComboIndex(wedgeActiveMatrix.comboIndex);
    setWedgeCurrentShots(wedgeActiveMatrix.currentShots);
    setWedgeResults(wedgeActiveMatrix.results);
    setWedgeDistanceInput("");
    setWedgeComboComplete(false);
    setScreen("wedgeMatrixPractice");
  }

  async function discardActiveWedgeMatrix() {
    await clearActiveWedgeMatrixStorage();
    setWedgeComboIndex(0);
    setWedgeCurrentShots([]);
    setWedgeResults({});
    setWedgeSequence([]);
  }

  function submitWedgeShot() {
    const val = unitToYds(parseFloat(wedgeDistanceInput), units);
    if (isNaN(val) || val < 0) return;
    const newShots = [...wedgeCurrentShots, val];
    setWedgeCurrentShots(newShots);
    setWedgeDistanceInput("");
    if (wedgeInputRef.current) wedgeInputRef.current.focus();

    if (newShots.length >= wedgeShotsPerCombo) {
      const combo = wedgeSequence[wedgeComboIndex];
      const comboKey = `${combo.clubKey}-${combo.swingKey}`;
      const trimmed = trimWedgeOutliersAndAverage(newShots);
      const newResults = { ...wedgeResults, [comboKey]: trimmed };
      setWedgeResults(newResults);
      setWedgeComboComplete(true);
      persistActiveWedgeMatrix({
        selectedClubs: wedgeSelectedClubs,
        selectedSwings: wedgeSelectedSwings,
        shotsPerCombo: wedgeShotsPerCombo,
        sequence: wedgeSequence,
        comboIndex: wedgeComboIndex,
        currentShots: newShots,
        results: newResults,
      });
    } else {
      persistActiveWedgeMatrix({
        selectedClubs: wedgeSelectedClubs,
        selectedSwings: wedgeSelectedSwings,
        shotsPerCombo: wedgeShotsPerCombo,
        sequence: wedgeSequence,
        comboIndex: wedgeComboIndex,
        currentShots: newShots,
        results: wedgeResults,
      });
    }
  }

  // Manually override which shots count toward a combo's average — lets someone override the
  // automatic 60%-keep rule, e.g. to exclude a shot that was clearly mishit even if it wasn't
  // the statistical shortest/longest, or to bring back one the automatic pass dropped.
  function toggleWedgeShotIncluded(comboKey, shotIndex) {
    const result = wedgeResults[comboKey];
    if (!result) return;
    const targetShot = result.shots[shotIndex];
    const includedCount = result.shots.filter((s) => s.included).length;
    // Never allow the last remaining included shot to be switched off — an average with zero
    // shots behind it would misleadingly show as 0, not "no data".
    if (targetShot.included && includedCount <= 1) return;
    const newShots = result.shots.map((s, i) => (i === shotIndex ? { ...s, included: !s.included } : s));
    const newAverage = avg(newShots.filter((s) => s.included).map((s) => s.value));
    const newResults = { ...wedgeResults, [comboKey]: { shots: newShots, average: newAverage } };
    setWedgeResults(newResults);
    persistActiveWedgeMatrix({
      selectedClubs: wedgeSelectedClubs,
      selectedSwings: wedgeSelectedSwings,
      shotsPerCombo: wedgeShotsPerCombo,
      sequence: wedgeSequence,
      comboIndex: wedgeComboIndex,
      currentShots: wedgeCurrentShots,
      results: newResults,
    });
  }

  // Reopens shot entry for the combo that was JUST completed, in case the yardages hit so far
  // don't look trustworthy and the user wants a bigger sample before moving on. Restores the raw
  // values already hit (dropping any manual include/exclude — a fresh shot count means a fresh
  // automatic trim) so submitWedgeShot()'s existing "length >= shotsPerCombo" check re-triggers
  // immediately after the very next shot, re-running trimWedgeOutliersAndAverage over the whole,
  // now-larger sample. No changes needed to submitWedgeShot() itself — this just puts the combo
  // back into its "still collecting shots" state with a head start.
  function addAnotherWedgeShot() {
    const combo = wedgeSequence[wedgeComboIndex];
    const comboKey = `${combo.clubKey}-${combo.swingKey}`;
    const result = wedgeResults[comboKey];
    if (!result) return;
    const existingValues = result.shots.map((s) => s.value);
    setWedgeCurrentShots(existingValues);
    setWedgeComboComplete(false);
    setWedgeDistanceInput("");
    persistActiveWedgeMatrix({
      selectedClubs: wedgeSelectedClubs,
      selectedSwings: wedgeSelectedSwings,
      shotsPerCombo: wedgeShotsPerCombo,
      sequence: wedgeSequence,
      comboIndex: wedgeComboIndex,
      currentShots: existingValues,
      results: wedgeResults,
    });
  }

  async function nextWedgeCombo() {
    if (wedgeComboIndex + 1 >= wedgeSequence.length) {
      const completed = {
        id: uid(),
        date: new Date().toISOString(),
        selectedClubs: wedgeSelectedClubs,
        selectedSwings: wedgeSelectedSwings,
        shotsPerCombo: wedgeShotsPerCombo,
        sequence: wedgeSequence,
        results: wedgeResults,
      };
      const newHistory = [completed, ...wedgeMatrixHistory];
      setWedgeMatrixHistory(newHistory);
      setWedgeViewingMatrix(completed);
      try {
        await window.storage.set("wedgematrix:completed", JSON.stringify(newHistory), false);
      } catch (e) {
        // non-fatal — the matrix is still shown from local state
      }
      await clearActiveWedgeMatrixStorage();
      setScreen("wedgeMatrixResult");
    } else {
      const nextIndex = wedgeComboIndex + 1;
      setWedgeComboIndex(nextIndex);
      setWedgeCurrentShots([]);
      setWedgeComboComplete(false);
      setWedgeDistanceInput("");
      persistActiveWedgeMatrix({
        selectedClubs: wedgeSelectedClubs,
        selectedSwings: wedgeSelectedSwings,
        shotsPerCombo: wedgeShotsPerCombo,
        sequence: wedgeSequence,
        comboIndex: nextIndex,
        currentShots: [],
        results: wedgeResults,
      });
    }
  }

  function exitWedgeMatrixEarly() {
    // progress is already autosaved after each shot — just leave the screen
    setScreen("wedgeMatrixSetup");
  }

  function viewWedgeMatrixFromHistory(matrix) {
    setWedgeViewingMatrix(matrix);
    setScreen("wedgeMatrixResult");
  }

  // Shared plumbing for correcting a FINISHED matrix (whether just-completed or opened from
  // history — by the time either is on screen it already lives in wedgeMatrixHistory, since
  // nextWedgeCombo() adds it there before switching to the result screen). `updateFn` gets the
  // target shot plus its combo's full shot list, and returns the replacement shot, or `null` to
  // veto the change (used by the include/exclude guard below).
  async function updateWedgeMatrixHistoryShot(matrixId, comboKey, shotIndex, updateFn) {
    let blocked = false;
    let updatedMatrixForViewing = null;
    const newHistory = wedgeMatrixHistory.map((m) => {
      if (m.id !== matrixId) return m;
      const result = m.results[comboKey];
      if (!result) return m;
      const targetShot = result.shots[shotIndex];
      const updated = updateFn(targetShot, result.shots);
      if (updated === null) {
        blocked = true;
        return m;
      }
      const newShots = result.shots.map((s, i) => (i === shotIndex ? updated : s));
      const newAverage = avg(newShots.filter((s) => s.included).map((s) => s.value));
      const newMatrix = { ...m, results: { ...m.results, [comboKey]: { shots: newShots, average: newAverage } } };
      updatedMatrixForViewing = newMatrix;
      return newMatrix;
    });
    if (blocked) return;
    setWedgeMatrixHistory(newHistory);
    // Keep whatever's currently on screen in sync, whether it arrived via history or via just
    // finishing the matrix — wedgeViewingMatrix is a snapshot, not looked up live from history.
    if (wedgeViewingMatrix && wedgeViewingMatrix.id === matrixId && updatedMatrixForViewing) {
      setWedgeViewingMatrix(updatedMatrixForViewing);
    }
    try {
      await window.storage.set("wedgematrix:completed", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  // Manual include/exclude override, same rule as the live toggleWedgeShotIncluded (never allow
  // the last remaining included shot to be switched off), but for a matrix that's already finished.
  function toggleWedgeHistoryShotIncluded(matrixId, comboKey, shotIndex) {
    updateWedgeMatrixHistoryShot(matrixId, comboKey, shotIndex, (shot, allShots) => {
      const includedCount = allShots.filter((s) => s.included).length;
      if (shot.included && includedCount <= 1) return null;
      return { ...shot, included: !shot.included };
    });
  }

  // Corrects a shot's actual carry value after the matrix is finished (e.g. a mis-typed distance)
  // — the piece that was missing before: the include/exclude toggle could hide a bad shot from the
  // average, but there was no way to fix the value itself once the combo screen was left behind.
  function editWedgeHistoryShotValue(matrixId, comboKey, shotIndex, newValue) {
    updateWedgeMatrixHistoryShot(matrixId, comboKey, shotIndex, (shot) => ({ ...shot, value: newValue }));
  }

  async function deleteWedgeMatrixFromHistory(id) {
    const newHistory = wedgeMatrixHistory.filter((m) => m.id !== id);
    setWedgeMatrixHistory(newHistory);
    try {
      await window.storage.set("wedgematrix:completed", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function startNewWedgeMatrix() {
    setScreen("wedgeMatrixSetup");
  }

  // ===== Gapping handlers (same shape as the Wedge Matrix handlers above, minus the swing
  // dimension — a "combo" here is just a club) =====
  function toggleGappingClub(key) {
    setGappingSelectedClubs((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function addGappingCustomClub(label) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const club = { key: `custom-${uid()}`, label: trimmed.toUpperCase() };
    const newCustomClubs = [...gappingCustomClubs, club];
    setGappingCustomClubs(newCustomClubs);
    setGappingSelectedClubs((prev) => [...prev, club.key]);
    try {
      await window.storage.set("gapping:customClubs", JSON.stringify(newCustomClubs), false);
    } catch (e) {
      // non-fatal — custom club still works for this session, just won't persist
    }
  }

  async function removeGappingCustomClub(key) {
    const newCustomClubs = gappingCustomClubs.filter((c) => c.key !== key);
    setGappingCustomClubs(newCustomClubs);
    setGappingSelectedClubs((prev) => prev.filter((k) => k !== key));
    try {
      await window.storage.set("gapping:customClubs", JSON.stringify(newCustomClubs), false);
    } catch (e) {
      // non-fatal
    }
  }

  async function persistActiveGappingChart(state) {
    setGappingActiveChart(state);
    try {
      await window.storage.set("gapping:active", JSON.stringify(state), false);
    } catch (e) {
      // non-fatal — progress just won't resume if the tab closes before the next save
    }
  }

  async function clearActiveGappingChartStorage() {
    setGappingActiveChart(null);
    try {
      await window.storage.delete("gapping:active", false);
    } catch (e) {
      // nothing to clear
    }
  }

  function startGappingChart() {
    const sequence = buildGappingSequence(gappingSelectedClubs, gappingCustomClubs);
    if (sequence.length === 0) return;
    setGappingSequence(sequence);
    setGappingClubIndex(0);
    setGappingCurrentShots([]);
    setGappingDistanceInput("");
    setGappingClubComplete(false);
    setGappingResults({});
    setScreen("gappingPractice");
    persistActiveGappingChart({
      selectedClubs: gappingSelectedClubs,
      customClubs: gappingCustomClubs,
      shotsPerClub: gappingShotsPerClub,
      sequence,
      clubIndex: 0,
      currentShots: [],
      results: {},
    });
  }

  function resumeGappingChart() {
    if (!gappingActiveChart) return;
    setGappingSelectedClubs(gappingActiveChart.selectedClubs);
    setGappingShotsPerClub(gappingActiveChart.shotsPerClub);
    setGappingSequence(gappingActiveChart.sequence);
    setGappingClubIndex(gappingActiveChart.clubIndex);
    setGappingCurrentShots(gappingActiveChart.currentShots);
    setGappingResults(gappingActiveChart.results);
    setGappingDistanceInput("");
    setGappingClubComplete(false);
    setScreen("gappingPractice");
  }

  async function discardActiveGappingChart() {
    await clearActiveGappingChartStorage();
    setGappingClubIndex(0);
    setGappingCurrentShots([]);
    setGappingResults({});
    setGappingSequence([]);
  }

  function submitGappingShot() {
    const val = unitToYds(parseFloat(gappingDistanceInput), units);
    if (isNaN(val) || val < 0) return;
    const newShots = [...gappingCurrentShots, val];
    setGappingCurrentShots(newShots);
    setGappingDistanceInput("");
    if (gappingInputRef.current) gappingInputRef.current.focus();

    if (newShots.length >= gappingShotsPerClub) {
      const club = gappingSequence[gappingClubIndex];
      const trimmed = trimWedgeOutliersAndAverage(newShots);
      const newResults = { ...gappingResults, [club.clubKey]: trimmed };
      setGappingResults(newResults);
      setGappingClubComplete(true);
      persistActiveGappingChart({
        selectedClubs: gappingSelectedClubs,
        customClubs: gappingCustomClubs,
        shotsPerClub: gappingShotsPerClub,
        sequence: gappingSequence,
        clubIndex: gappingClubIndex,
        currentShots: newShots,
        results: newResults,
      });
    } else {
      persistActiveGappingChart({
        selectedClubs: gappingSelectedClubs,
        customClubs: gappingCustomClubs,
        shotsPerClub: gappingShotsPerClub,
        sequence: gappingSequence,
        clubIndex: gappingClubIndex,
        currentShots: newShots,
        results: gappingResults,
      });
    }
  }

  function toggleGappingShotIncluded(clubKey, shotIndex) {
    const result = gappingResults[clubKey];
    if (!result) return;
    const targetShot = result.shots[shotIndex];
    const includedCount = result.shots.filter((s) => s.included).length;
    if (targetShot.included && includedCount <= 1) return;
    const newShots = result.shots.map((s, i) => (i === shotIndex ? { ...s, included: !s.included } : s));
    const newAverage = avg(newShots.filter((s) => s.included).map((s) => s.value));
    const newResults = { ...gappingResults, [clubKey]: { shots: newShots, average: newAverage } };
    setGappingResults(newResults);
    persistActiveGappingChart({
      selectedClubs: gappingSelectedClubs,
      customClubs: gappingCustomClubs,
      shotsPerClub: gappingShotsPerClub,
      sequence: gappingSequence,
      clubIndex: gappingClubIndex,
      currentShots: gappingCurrentShots,
      results: newResults,
    });
  }

  // Same "hit more shots" mechanism as addAnotherWedgeShot() — restores the raw values already
  // hit for the just-finished club and drops back into shot-entry mode, so the very next shot
  // re-triggers the finalize branch in submitGappingShot() and re-trims over the bigger sample.
  function addAnotherGappingShot() {
    const club = gappingSequence[gappingClubIndex];
    const result = gappingResults[club.clubKey];
    if (!result) return;
    const existingValues = result.shots.map((s) => s.value);
    setGappingCurrentShots(existingValues);
    setGappingClubComplete(false);
    setGappingDistanceInput("");
    persistActiveGappingChart({
      selectedClubs: gappingSelectedClubs,
      customClubs: gappingCustomClubs,
      shotsPerClub: gappingShotsPerClub,
      sequence: gappingSequence,
      clubIndex: gappingClubIndex,
      currentShots: existingValues,
      results: gappingResults,
    });
  }

  async function nextGappingClub() {
    if (gappingClubIndex + 1 >= gappingSequence.length) {
      const completed = {
        id: uid(),
        date: new Date().toISOString(),
        selectedClubs: gappingSelectedClubs,
        customClubs: gappingCustomClubs,
        shotsPerClub: gappingShotsPerClub,
        sequence: gappingSequence,
        results: gappingResults,
      };
      const newHistory = [completed, ...gappingHistory];
      setGappingHistory(newHistory);
      setGappingViewingChart(completed);
      try {
        await window.storage.set("gapping:completed", JSON.stringify(newHistory), false);
      } catch (e) {
        // non-fatal — the chart is still shown from local state
      }
      await clearActiveGappingChartStorage();
      setScreen("gappingResult");
    } else {
      const nextIndex = gappingClubIndex + 1;
      setGappingClubIndex(nextIndex);
      setGappingCurrentShots([]);
      setGappingClubComplete(false);
      setGappingDistanceInput("");
      persistActiveGappingChart({
        selectedClubs: gappingSelectedClubs,
        customClubs: gappingCustomClubs,
        shotsPerClub: gappingShotsPerClub,
        sequence: gappingSequence,
        clubIndex: nextIndex,
        currentShots: [],
        results: gappingResults,
      });
    }
  }

  function exitGappingEarly() {
    setScreen("gappingSetup");
  }

  function viewGappingChartFromHistory(chart) {
    setGappingViewingChart(chart);
    setScreen("gappingResult");
  }

  async function updateGappingHistoryShot(chartId, clubKey, shotIndex, updateFn) {
    let blocked = false;
    let updatedChartForViewing = null;
    const newHistory = gappingHistory.map((m) => {
      if (m.id !== chartId) return m;
      const result = m.results[clubKey];
      if (!result) return m;
      const targetShot = result.shots[shotIndex];
      const updated = updateFn(targetShot, result.shots);
      if (updated === null) {
        blocked = true;
        return m;
      }
      const newShots = result.shots.map((s, i) => (i === shotIndex ? updated : s));
      const newAverage = avg(newShots.filter((s) => s.included).map((s) => s.value));
      const newChart = { ...m, results: { ...m.results, [clubKey]: { shots: newShots, average: newAverage } } };
      updatedChartForViewing = newChart;
      return newChart;
    });
    if (blocked) return;
    setGappingHistory(newHistory);
    if (gappingViewingChart && gappingViewingChart.id === chartId && updatedChartForViewing) {
      setGappingViewingChart(updatedChartForViewing);
    }
    try {
      await window.storage.set("gapping:completed", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function toggleGappingHistoryShotIncluded(chartId, clubKey, shotIndex) {
    updateGappingHistoryShot(chartId, clubKey, shotIndex, (shot, allShots) => {
      const includedCount = allShots.filter((s) => s.included).length;
      if (shot.included && includedCount <= 1) return null;
      return { ...shot, included: !shot.included };
    });
  }

  function editGappingHistoryShotValue(chartId, clubKey, shotIndex, newValue) {
    updateGappingHistoryShot(chartId, clubKey, shotIndex, (shot) => ({ ...shot, value: newValue }));
  }

  async function deleteGappingChartFromHistory(id) {
    const newHistory = gappingHistory.filter((m) => m.id !== id);
    setGappingHistory(newHistory);
    try {
      await window.storage.set("gapping:completed", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal
    }
  }

  function startNewGappingChart() {
    setScreen("gappingSetup");
  }

  // ===== Manual Gapping entry — same club selection + sequence builder as the tested flow, but
  // skips straight to one figure per club instead of shot-by-shot testing. Produces a chart in the
  // exact same shape (via trimWedgeOutliersAndAverage on a single-value array) so it saves to
  // "gapping:completed" alongside tested charts and reuses GappingResultScreen unchanged. =====
  function proceedToGappingManualEntry() {
    const sequence = buildGappingSequence(gappingSelectedClubs, gappingCustomClubs);
    if (sequence.length === 0) return;
    setGappingSequence(sequence);
    setGappingManualValues({});
    setScreen("gappingManualEntry");
  }

  function updateGappingManualValue(clubKey, value) {
    setGappingManualValues((prev) => ({ ...prev, [clubKey]: value }));
  }

  async function saveGappingManualChart() {
    // Only clubs with a valid entered figure make it into the saved chart — a club left blank is
    // simply not included, rather than saved as an empty "—" row.
    const filled = gappingSequence.filter((c) => {
      const raw = gappingManualValues[c.clubKey];
      return raw !== undefined && raw !== "" && !isNaN(parseFloat(raw)) && parseFloat(raw) >= 0;
    });
    if (filled.length === 0) return;
    const results = {};
    filled.forEach((c) => {
      const val = unitToYds(parseFloat(gappingManualValues[c.clubKey]), units);
      results[c.clubKey] = trimWedgeOutliersAndAverage([val]);
    });
    const completed = {
      id: uid(),
      date: new Date().toISOString(),
      selectedClubs: filled.map((c) => c.clubKey),
      customClubs: gappingCustomClubs,
      shotsPerClub: 1,
      sequence: filled,
      results,
      enteredManually: true,
    };
    const newHistory = [completed, ...gappingHistory];
    setGappingHistory(newHistory);
    setGappingViewingChart(completed);
    try {
      await window.storage.set("gapping:completed", JSON.stringify(newHistory), false);
    } catch (e) {
      // non-fatal — the chart is still shown from local state
    }
    setScreen("gappingResult");
  }

  function exitGappingManualEarly() {
    setScreen("yardagesChoose");
  }

  // Adds 10 sample sessions to every section in one go, rather than loading each area separately.
  async function loadSampleDataForAllSections() {
    const newRangeHistory = [...generateFakeSessions(10), ...history];
    setHistory(newRangeHistory);

    const newTeeHistory = [...generateFakeTeeSessions(10), ...teeHistory];
    setTeeHistory(newTeeHistory);

    const newShortHistory = [...generateFakeShortGameSessions(10), ...shortHistory];
    setShortHistory(newShortHistory);

    const newPuttHistory = [...generateFakePuttingSessions(10), ...generateFakeCourseRounds(10), ...puttHistory];
    setPuttHistory(newPuttHistory);

    try {
      await Promise.all([
        window.storage.set("golf:sessions", JSON.stringify(newRangeHistory), false),
        window.storage.set("tee:sessions", JSON.stringify(newTeeHistory), false),
        window.storage.set("shortgame:sessions", JSON.stringify(newShortHistory), false),
        window.storage.set("putting:sessions", JSON.stringify(newPuttHistory), false),
      ]);
    } catch (e) {
      // non-fatal — sessions are still shown from local state even if a write failed
    }
  }

  // Wipes every section's session history in one go — the counterpart to the "add 10 to every
  // section" button above.
  async function clearAllSampleDataForAllSections() {
    setHistory([]);
    setTeeHistory([]);
    setShortHistory([]);
    setPuttHistory([]);
    try {
      await Promise.all([
        window.storage.set("golf:sessions", JSON.stringify([]), false),
        window.storage.set("tee:sessions", JSON.stringify([]), false),
        window.storage.set("shortgame:sessions", JSON.stringify([]), false),
        window.storage.set("putting:sessions", JSON.stringify([]), false),
      ]);
    } catch (e) {
      // non-fatal
    }
  }

  const runningTotal = shots.reduce((a, s) => a + s.diff, 0);
  const runningAvg = avg(shots.map((s) => s.diff));
  const puttRunningAvg = avg(putts.map((p) => p.strokes));

  // Putting's summary screen is shared by both Random Practice and On Course rounds, so its
  // actual "back" destination depends on which one just finished — everywhere else BACK_MAP's
  // static lookup is enough.
  const backTarget =
    screen === "puttingSummary"
      ? puttSummaryIsOnCourse
        ? "puttingCourseSetup"
        : "puttingRandomSetup"
      : BACK_MAP[screen] || "home";

  return (
    <div
      style={{
        fontFamily: "'Inter', sans-serif",
        background: `radial-gradient(circle at 20% 0%, ${COLORS.turf} 0%, ${COLORS.turfDark} 60%)`,
        minHeight: "100vh",
        color: COLORS.cream,
        display: "flex",
        justifyContent: "center",
        padding: "16px 16px",
      }}
    >
      <style>{FONT_IMPORT}</style>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <Header
          screen={screen}
          onSettings={() => setScreen("settings")}
          onHome={goHome}
          onBack={() => setScreen(backTarget)}
          backDestination={backTarget}
        />

        {screen === "rangeChoose" && <RangeChooseScreen onNavigate={(s) => setScreen(s)} />}

        {screen === "yardagesChoose" && <YardagesChooseScreen onNavigate={(s) => setScreen(s)} />}

        {screen === "setup" && settingsLoaded && rangeTrackingMode === null && (
          <RangeOnboardingScreen onAnswer={updateRangeTrackingMode} />
        )}

        {screen === "setup" && (!settingsLoaded || rangeTrackingMode !== null) && (
          <SetupScreen
            shotCount={shotCount}
            setShotCount={setShotCount}
            minDist={minDist}
            maxDist={maxDist}
            setMinDist={setMinDist}
            setMaxDist={setMaxDist}
            onStart={startSession}
            activeSaved={activeSaved}
            onResume={resumeSession}
            onDiscard={discardSavedSession}
            onLoadTestData={loadTestSessions}
            onViewAnalysis={() => {
              setAnalysisSection("range");
              setScreen("analysis");
            }}
            units={units}
          />
        )}

        {screen === "practice" && currentTarget !== null && (
          <PracticeScreen
            shots={shots}
            shotCount={shotCount}
            currentTarget={currentTarget}
            minDist={minDist}
            maxDist={maxDist}
            actualInput={actualInput}
            setActualInput={setActualInput}
            onSubmit={submitShot}
            onSubmitRating={submitRating}
            runningTotal={runningTotal}
            runningAvg={runningAvg}
            inputRef={inputRef}
            onExit={exitToMenu}
            units={units}
            mode={currentSessionMode}
            editingShotIndex={editingShotIndex}
            onStartEditShot={setEditingShotIndex}
            onSaveEditShot={saveShotEdit}
            onCancelEditShot={() => setEditingShotIndex(null)}
          />
        )}

        {screen === "summary" && shots.length > 0 && (
          <SummaryScreen
            shots={shots}
            minDist={minDist}
            maxDist={maxDist}
            onNewSession={resetToSetup}
            storageError={storageError}
            units={units}
            feedback={rangeSessionFeedback}
          />
        )}

        {screen === "home" && <HomeScreen onNavigate={(s) => setScreen(s)} />}

        {screen === "analysis" && (
          <AnalysisScreen
            section={analysisSection}
            onSectionChange={setAnalysisSection}
            rangeHistory={history}
            rangeLoaded={loaded}
            onDeleteRangeSession={deleteRangeSession}
            onEditRangeSessionShot={editRangeSessionShot}
            puttingHistory={puttHistory}
            puttingLoaded={puttLoaded}
            onDeletePuttingSession={deletePuttingSession}
            onEditPuttingSessionShot={editPuttingSessionPutt}
            clockHistory={clockHistory}
            clockLoaded={clockLoaded}
            onDeleteClockSession={deleteClockSession}
            onEditClockSessionShot={editClockSessionPutt}
            startLineHistory={startLineHistory}
            startLineLoaded={startLineLoaded}
            onDeleteStartLineSession={deleteStartLineSession}
            onEditStartLineSession={editStartLineSession}
            paceHistory={paceHistory}
            paceLoaded={paceLoaded}
            onDeletePaceSession={deletePaceSession}
            onEditPacePutt={editPacePuttPoints}
            shortGameHistory={shortHistory}
            shortGameLoaded={shortLoaded}
            onDeleteShortGameSession={deleteShortGameSession}
            onEditShortGameSessionShot={editShortGameSessionShot}
            teeHistory={teeHistory}
            teeLoaded={teeLoaded}
            onDeleteTeeSession={deleteTeeSession}
            onEditTeeSessionShot={editTeeSessionShot}
            onBack={goHome}
            profileName={profileName}
            profileHandicap={profileHandicap}
            baselineHandicap={baselineHandicap}
            units={units}
          />
        )}

        {screen === "settings" && (
          <SettingsScreen
            baselineHandicap={baselineHandicap}
            onSetBaseline={updateBaselineHandicap}
            units={units}
            onSetUnits={updateUnits}
            rangeTrackingMode={rangeTrackingMode}
            onSetRangeTrackingMode={updateRangeTrackingMode}
            onBack={goHome}
            profileName={profileName}
            onSwitchProfile={onSwitchProfile}
            onExportData={() => exportProfileData(profileId, profileName || "profile")}
            onImportData={async (file) => {
              try {
                const count = await importProfileData(profileId, file);
                alert(`Imported ${count} record(s). Reloading to pick up the restored data…`);
                window.location.reload();
              } catch (e) {
                alert(e.message || "Couldn't import that file.");
              }
            }}
            sampleDataAreas={[
              { key: "range", label: "Range", count: history.length, onClear: clearAllRangeSessions },
              { key: "teeaccuracy", label: "Tee Accuracy", count: teeHistory.length, onClear: clearAllTeeSessions },
              { key: "shortgame", label: "Short Game", count: shortHistory.length, onClear: clearAllShortGameSessions },
              {
                key: "putting",
                label: "Putting — Practice",
                count: puttHistory.filter((s) => s.type !== "course").length,
                onClear: clearAllPuttingPracticeSessions,
              },
              {
                key: "puttingcourse",
                label: "Putting — On Course",
                count: puttHistory.filter((s) => s.type === "course").length,
                onClear: clearAllPuttingCourseSessions,
              },
              {
                key: "puttingclock",
                label: "Putting — Around the Clock",
                count: clockHistory.length,
                onClear: clearAllPuttingClockSessions,
              },
              {
                key: "puttingstartline",
                label: "Putting — Start Line",
                count: startLineHistory.length,
                onClear: clearAllStartLineSessions,
              },
              {
                key: "puttingpace",
                label: "Putting — Pace Control",
                count: paceHistory.length,
                onClear: clearAllPaceSessions,
              },
            ]}
            onLoadAllSampleData={loadSampleDataForAllSections}
            onClearAllSampleData={clearAllSampleDataForAllSections}
            myCoachLinks={myCoachLinks}
            onOpenAddCoach={() => setScreen("addCoach")}
            onDisconnectCoach={async (coachId) => {
              try {
                await disconnectCoachLink(profileId, coachId);
              } catch (e) {
                alert(e.message || "Couldn't disconnect — try again.");
              }
            }}
          />
        )}

        {screen === "addCoach" && (
          <AddCoachScreen
            profileId={profileId}
            profileName={profileName}
            myCoachLinks={myCoachLinks}
            onBack={() => setScreen("settings")}
          />
        )}

        {screen === "teeaccuracy" && (
          <TeeAccuracySetupScreen
            shotCount={teeShotCount}
            setShotCount={setTeeShotCount}
            fairwayWidth={teeFairwayWidth}
            setFairwayWidth={setTeeFairwayWidth}
            clubs={teeClubs}
            onToggleClub={toggleTeeClub}
            onStart={startTeeSession}
            units={units}
            history={teeHistory}
            loaded={teeLoaded}
            onDeleteSession={deleteTeeSession}
            onViewAnalysis={() => {
              setAnalysisSection("teeaccuracy");
              setScreen("analysis");
            }}
          />
        )}

        {screen === "teeAccuracyPractice" && teeCurrentClub !== null && (
          <TeeAccuracyPracticeScreen
            shots={teeShots}
            shotCount={teeShotCount}
            currentClub={teeCurrentClub}
            fairwayWidth={teeFairwayWidth}
            onSubmit={submitTeeShot}
            onExit={resetTeeToSetup}
            units={units}
            editingShotIndex={teeEditingShotIndex}
            onStartEditShot={setTeeEditingShotIndex}
            onSaveEditShot={saveTeeShotEdit}
            onCancelEditShot={() => setTeeEditingShotIndex(null)}
          />
        )}

        {screen === "teeAccuracySummary" && teeShots.length > 0 && (
          <TeeAccuracySummaryScreen
            shots={teeShots}
            fairwayWidth={teeFairwayWidth}
            onNewSession={resetTeeToSetup}
            storageError={teeStorageError}
            units={units}
          />
        )}

        {screen === "wedgeMatrixSetup" && (
          <WedgeMatrixSetupScreen
            selectedClubs={wedgeSelectedClubs}
            onToggleClub={toggleWedgeClub}
            selectedSwings={wedgeSelectedSwings}
            onToggleSwing={toggleWedgeSwing}
            shotsPerCombo={wedgeShotsPerCombo}
            setShotsPerCombo={setWedgeShotsPerCombo}
            onStart={startWedgeMatrix}
            activeMatrix={wedgeActiveMatrix}
            onResume={resumeWedgeMatrix}
            onDiscard={discardActiveWedgeMatrix}
            history={wedgeMatrixHistory}
            loaded={wedgeLoaded}
            onViewMatrix={viewWedgeMatrixFromHistory}
            onDeleteMatrix={deleteWedgeMatrixFromHistory}
            units={units}
          />
        )}

        {screen === "wedgeMatrixPractice" && wedgeSequence.length > 0 && (
          <WedgeMatrixPracticeScreen
            sequence={wedgeSequence}
            comboIndex={wedgeComboIndex}
            currentShots={wedgeCurrentShots}
            shotsPerCombo={wedgeShotsPerCombo}
            distanceInput={wedgeDistanceInput}
            setDistanceInput={setWedgeDistanceInput}
            onSubmitShot={submitWedgeShot}
            comboComplete={wedgeComboComplete}
            results={wedgeResults}
            onNextCombo={nextWedgeCombo}
            onToggleShot={toggleWedgeShotIncluded}
            onAddShot={addAnotherWedgeShot}
            onExitEarly={exitWedgeMatrixEarly}
            units={units}
            inputRef={wedgeInputRef}
          />
        )}

        {screen === "wedgeMatrixResult" && wedgeViewingMatrix && (
          <WedgeMatrixResultScreen
            matrix={wedgeViewingMatrix}
            units={units}
            onNewMatrix={startNewWedgeMatrix}
            onToggleShot={(comboKey, shotIndex) => toggleWedgeHistoryShotIncluded(wedgeViewingMatrix.id, comboKey, shotIndex)}
            onEditShotValue={(comboKey, shotIndex, newValue) =>
              editWedgeHistoryShotValue(wedgeViewingMatrix.id, comboKey, shotIndex, newValue)
            }
          />
        )}

        {screen === "gappingSetup" && (
          <GappingSetupScreen
            selectedClubs={gappingSelectedClubs}
            onToggleClub={toggleGappingClub}
            customClubs={gappingCustomClubs}
            onAddCustomClub={addGappingCustomClub}
            onRemoveCustomClub={removeGappingCustomClub}
            shotsPerClub={gappingShotsPerClub}
            setShotsPerClub={setGappingShotsPerClub}
            onStart={startGappingChart}
            activeChart={gappingActiveChart}
            onResume={resumeGappingChart}
            onDiscard={discardActiveGappingChart}
            history={gappingHistory}
            loaded={gappingLoaded}
            onViewChart={viewGappingChartFromHistory}
            onDeleteChart={deleteGappingChartFromHistory}
            units={units}
          />
        )}

        {screen === "gappingPractice" && gappingSequence.length > 0 && (
          <GappingPracticeScreen
            sequence={gappingSequence}
            clubIndex={gappingClubIndex}
            currentShots={gappingCurrentShots}
            shotsPerClub={gappingShotsPerClub}
            distanceInput={gappingDistanceInput}
            setDistanceInput={setGappingDistanceInput}
            onSubmitShot={submitGappingShot}
            clubComplete={gappingClubComplete}
            results={gappingResults}
            onNextClub={nextGappingClub}
            onToggleShot={toggleGappingShotIncluded}
            onAddShot={addAnotherGappingShot}
            onExitEarly={exitGappingEarly}
            units={units}
            inputRef={gappingInputRef}
          />
        )}

        {screen === "gappingResult" && gappingViewingChart && (
          <GappingResultScreen
            chart={gappingViewingChart}
            units={units}
            onNewChart={startNewGappingChart}
            onToggleShot={(clubKey, shotIndex) => toggleGappingHistoryShotIncluded(gappingViewingChart.id, clubKey, shotIndex)}
            onEditShotValue={(clubKey, shotIndex, newValue) =>
              editGappingHistoryShotValue(gappingViewingChart.id, clubKey, shotIndex, newValue)
            }
          />
        )}

        {screen === "gappingManualClubs" && (
          <GappingManualClubsScreen
            selectedClubs={gappingSelectedClubs}
            onToggleClub={toggleGappingClub}
            customClubs={gappingCustomClubs}
            onAddCustomClub={addGappingCustomClub}
            onRemoveCustomClub={removeGappingCustomClub}
            onContinue={proceedToGappingManualEntry}
          />
        )}

        {screen === "gappingManualEntry" && gappingSequence.length > 0 && (
          <GappingManualEntryScreen
            sequence={gappingSequence}
            values={gappingManualValues}
            onChangeValue={updateGappingManualValue}
            onSave={saveGappingManualChart}
            onExit={exitGappingManualEarly}
            units={units}
          />
        )}

        {screen === "competeChoose" && <CompeteChooseScreen onNavigate={(s) => setScreen(s)} />}

        {screen === "competeSetup" && (
          <CompeteSetupScreen
            players={competePlayers}
            onUpdatePlayerName={updateCompetePlayerName}
            onAddPlayer={addCompetePlayer}
            onRemovePlayer={removeCompetePlayer}
            rounds={competeRounds}
            setRounds={setCompeteRounds}
            minDist={competeMinDist}
            maxDist={competeMaxDist}
            setMinDist={setCompeteMinDist}
            setMaxDist={setCompeteMaxDist}
            mode={competeMode}
            setMode={setCompeteMode}
            onStart={startCompete}
            units={units}
            history={competeHistory}
            loaded={competeLoaded}
            onDeleteSession={deleteCompeteSession}
          />
        )}

        {screen === "competePlay" && competeCurrentTarget !== null && (
          <CompetePlayScreen
            players={competePlayers}
            roundResults={competeRoundResults}
            totalRounds={competeRounds}
            target={competeCurrentTarget}
            mode={competeMode}
            currentPlayerIdx={competeCurrentPlayerIdx}
            distanceInput={competeDistanceInput}
            setDistanceInput={setCompeteDistanceInput}
            onSubmitDistance={submitCompeteDistance}
            onSelectClosest={selectClosestPlayer}
            roundComplete={competeRoundComplete}
            roundStandings={competeRoundStandings}
            onNextRound={nextCompeteRound}
            onExitEarly={exitCompeteEarly}
            units={units}
            editingIndex={competeEditingIndex}
            onStartEdit={setCompeteEditingIndex}
            onSaveEdit={saveCompeteRoundEdit}
            onCancelEdit={() => setCompeteEditingIndex(null)}
          />
        )}

        {screen === "competeSummary" && competeRoundResults.length > 0 && (
          <CompeteSummaryScreen
            players={competePlayers}
            mode={competeMode}
            roundResults={competeRoundResults}
            minDist={competeMinDist}
            maxDist={competeMaxDist}
            units={units}
            onNewCompetition={resetCompeteToSetup}
            editingIndex={competeSummaryEditingIndex}
            onStartEdit={setCompeteSummaryEditingIndex}
            onSaveEdit={saveCompeteRoundEditFromSummary}
            onCancelEdit={() => setCompeteSummaryEditingIndex(null)}
          />
        )}

        {screen === "competeShortGameSetup" && (
          <ShortGameCompeteSetupScreen
            players={sgCompetePlayers}
            onUpdatePlayerName={updateSgCompetePlayerName}
            onAddPlayer={addSgCompetePlayer}
            onRemovePlayer={removeSgCompetePlayer}
            rounds={sgCompeteRounds}
            setRounds={setSgCompeteRounds}
            minYds={sgCompeteMinYds}
            maxYds={sgCompeteMaxYds}
            setMinYds={setSgCompeteMinYds}
            setMaxYds={setSgCompeteMaxYds}
            lies={sgCompeteLies}
            onToggleLie={toggleSgCompeteLie}
            mode={sgCompeteMode}
            setMode={setSgCompeteMode}
            onStart={startSgCompete}
            units={units}
            history={sgCompeteHistory}
            loaded={sgCompeteLoaded}
            onDeleteSession={deleteSgCompeteSession}
          />
        )}

        {screen === "competeShortGamePlay" && sgCompeteCurrentShot !== null && (
          <ShortGameCompetePlayScreen
            players={sgCompetePlayers}
            roundResults={sgCompeteRoundResults}
            totalRounds={sgCompeteRounds}
            currentShot={sgCompeteCurrentShot}
            mode={sgCompeteMode}
            currentPlayerIdx={sgCompeteCurrentPlayerIdx}
            resultInput={sgCompeteResultInput}
            setResultInput={setSgCompeteResultInput}
            onSubmitDistance={submitSgCompeteDistance}
            onSelectClosest={selectSgCompeteClosest}
            roundComplete={sgCompeteRoundComplete}
            roundStandings={sgCompeteRoundStandings}
            onNextRound={nextSgCompeteRound}
            onExitEarly={exitSgCompeteEarly}
            units={units}
            editingIndex={sgCompeteEditingIndex}
            onStartEdit={setSgCompeteEditingIndex}
            onSaveEdit={saveSgCompeteRoundEdit}
            onCancelEdit={() => setSgCompeteEditingIndex(null)}
          />
        )}

        {screen === "competeShortGameSummary" && sgCompeteRoundResults.length > 0 && (
          <ShortGameCompeteSummaryScreen
            players={sgCompetePlayers}
            mode={sgCompeteMode}
            roundResults={sgCompeteRoundResults}
            units={units}
            onNewCompetition={resetSgCompeteToSetup}
            editingIndex={sgCompeteSummaryEditingIndex}
            onStartEdit={setSgCompeteSummaryEditingIndex}
            onSaveEdit={saveSgCompeteRoundEditFromSummary}
            onCancelEdit={() => setSgCompeteSummaryEditingIndex(null)}
          />
        )}

        {screen === "competePuttingSetup" && (
          <PuttingCompeteSetupScreen
            players={puttCompetePlayers}
            onUpdatePlayerName={updatePuttCompetePlayerName}
            onAddPlayer={addPuttCompetePlayer}
            onRemovePlayer={removePuttCompetePlayer}
            holes={puttCompeteHoles}
            setHoles={setPuttCompeteHoles}
            minFt={puttCompeteMinFt}
            maxFt={puttCompeteMaxFt}
            setMinFt={setPuttCompeteMinFt}
            setMaxFt={setPuttCompeteMaxFt}
            onStart={startPuttCompete}
            units={units}
            history={puttCompeteHistory}
            loaded={puttCompeteLoaded}
            onDeleteSession={deletePuttCompeteSession}
          />
        )}

        {screen === "competePuttingPlay" && puttCompeteCurrentTarget !== null && (
          <PuttingCompetePlayScreen
            players={puttCompetePlayers}
            holeResults={puttCompeteHoleResults}
            totalHoles={puttCompeteHoles}
            target={puttCompeteCurrentTarget}
            currentPlayerIdx={puttCompeteCurrentPlayerIdx}
            holeComplete={puttCompeteHoleComplete}
            onSubmitStrokes={submitPuttCompeteStrokes}
            onNextHole={nextPuttCompeteHole}
            onExitEarly={exitPuttCompeteEarly}
            units={units}
            editingIndex={puttCompeteEditingIndex}
            onStartEdit={setPuttCompeteEditingIndex}
            onSaveEdit={savePuttCompeteHoleEdit}
            onCancelEdit={() => setPuttCompeteEditingIndex(null)}
          />
        )}

        {screen === "competePuttingSummary" && puttCompeteHoleResults.length > 0 && (
          <PuttingCompeteSummaryScreen
            players={puttCompetePlayers}
            holeResults={puttCompeteHoleResults}
            units={units}
            onNewCompetition={resetPuttCompeteToSetup}
            editingIndex={puttCompeteSummaryEditingIndex}
            onStartEdit={setPuttCompeteSummaryEditingIndex}
            onSaveEdit={savePuttCompeteHoleEditFromSummary}
            onCancelEdit={() => setPuttCompeteSummaryEditingIndex(null)}
          />
        )}

        {screen === "shortgame" && (
          <ShortGameSetupScreen
            shortShotCount={shortShotCount}
            setShortShotCount={setShortShotCount}
            shortMinYds={shortMinYds}
            shortMaxYds={shortMaxYds}
            setShortMinYds={setShortMinYds}
            setShortMaxYds={setShortMaxYds}
            shortLies={shortLies}
            onToggleLie={toggleShortLie}
            onStart={startShortGameSession}
            activeSaved={shortActiveSaved}
            onResume={resumeShortGameSession}
            onDiscard={discardSavedShortGame}
            onViewAnalysis={() => {
              setAnalysisSection("shortgame");
              setScreen("analysis");
            }}
            onLoadTestData={loadTestShortGameSessions}
            units={units}
          />
        )}

        {screen === "shortGamePractice" && shortCurrentShot !== null && (
          <ShortGamePracticeScreen
            shots={shortShots}
            shotCount={shortShotCount}
            currentShot={shortCurrentShot}
            resultInput={shortResultInput}
            setResultInput={setShortResultInput}
            onSubmit={submitShortGameShot}
            onReroll={rerollShortGameShot}
            onExit={exitShortGameToMenu}
            units={units}
            editingShotIndex={shortEditingShotIndex}
            onStartEditShot={setShortEditingShotIndex}
            onSaveEditShot={saveShortGameShotEdit}
            onCancelEditShot={() => setShortEditingShotIndex(null)}
          />
        )}

        {screen === "shortGameSummary" && shortShots.length > 0 && (
          <ShortGameSummaryScreen
            shots={shortShots}
            onNewSession={resetToShortGameSetup}
            storageError={shortStorageError}
            units={units}
            feedback={shortSessionFeedback}
          />
        )}

        {screen === "puttingChoose" && <PuttingChooseScreen onNavigate={(s) => setScreen(s)} />}

        {screen === "puttingRandomSetup" && (
          <PuttingRandomSetupScreen
            puttCount={puttCount}
            setPuttCount={setPuttCount}
            puttMinFt={puttMinFt}
            puttMaxFt={puttMaxFt}
            setPuttMinFt={setPuttMinFt}
            setPuttMaxFt={setPuttMaxFt}
            puttIncludeBreak={puttIncludeBreak}
            setPuttIncludeBreak={setPuttIncludeBreak}
            onStart={startPuttingSession}
            activeSaved={puttActiveSaved}
            onResume={resumePuttingSession}
            onDiscard={discardSavedPutting}
            onViewAnalysis={() => {
              setAnalysisSection("putting");
              setScreen("analysis");
            }}
            onLoadTestData={loadTestPuttingSessions}
            units={units}
          />
        )}

        {screen === "puttingCourseSetup" && (
          <PuttingCourseSetupScreen
            onCourseHoles={onCourseHoles}
            onUpdateCourseHole={updateOnCourseHole}
            onFinishOnCourse={finishOnCourseRound}
            onClearOnCourse={clearOnCourseRound}
            onLoadTestCourseData={loadTestCourseRounds}
            onViewAnalysis={() => {
              setAnalysisSection("putting");
              setScreen("analysis");
            }}
            units={units}
          />
        )}

        {screen === "puttingClockIntro" && (
          <PuttingClockIntroScreen history={clockHistory} onStart={startClockRound} />
        )}

        {screen === "puttingClockPlay" && clockPutts.length > 0 && (
          <PuttingClockPlayScreen
            putts={clockPutts}
            pendingIndex={clockPendingIndex}
            onOpenPutt={openClockPutt}
            onRecordResult={recordClockPutt}
            onCancelPrompt={cancelClockPrompt}
            onExit={exitClockRound}
          />
        )}

        {screen === "puttingClockSummary" && clockHistory.length > 0 && (
          <PuttingClockSummaryScreen
            session={clockHistory[0]}
            onPlayAgain={startClockRound}
            onExit={() => setScreen("puttingChoose")}
            storageError={clockStorageError}
            units={units}
          />
        )}

        {screen === "puttingStartLineIntro" && (
          <PuttingStartLineIntroScreen history={startLineHistory} onStart={startStartLineDrill} />
        )}

        {screen === "puttingStartLinePlay" && (
          <PuttingStartLinePlayScreen
            madeInput={startLineMadeInput}
            setMadeInput={setStartLineMadeInput}
            onSubmit={submitStartLineDrill}
            onExit={exitStartLineDrill}
          />
        )}

        {screen === "puttingStartLineSummary" && startLineHistory.length > 0 && (
          <PuttingStartLineSummaryScreen
            session={startLineHistory[0]}
            onPlayAgain={startStartLineDrill}
            onExit={() => setScreen("puttingChoose")}
            storageError={startLineStorageError}
          />
        )}

        {screen === "puttingPaceSetup" && (
          <PuttingPaceSetupScreen
            selectedDistances={paceSelectedDistances}
            onToggleDistance={togglePaceDistance}
            puttsPerDistance={pacePuttsPerDistance}
            setPuttsPerDistance={setPacePuttsPerDistance}
            onStart={startPaceDrill}
            onViewAnalysis={() => {
              setAnalysisSection("putting");
              setScreen("analysis");
            }}
            units={units}
          />
        )}

        {screen === "puttingPacePlay" && pacePutts.length > 0 && (
          <PuttingPacePlayScreen
            putts={pacePutts}
            currentIndex={paceCurrentIndex}
            onRecordPoints={recordPacePutt}
            onExit={exitPaceDrill}
            units={units}
          />
        )}

        {screen === "puttingPaceSummary" && paceHistory.length > 0 && (
          <PuttingPaceSummaryScreen
            session={paceHistory[0]}
            onPlayAgain={() => setScreen("puttingPaceSetup")}
            onExit={() => setScreen("puttingChoose")}
            storageError={paceStorageError}
            units={units}
          />
        )}

        {screen === "puttingPractice" && puttCurrentTarget !== null && (
          <PuttingPracticeScreen
            putts={putts}
            puttCount={puttCount}
            currentTarget={puttCurrentTarget}
            puttMinFt={puttMinFt}
            puttMaxFt={puttMaxFt}
            includeBreak={puttIncludeBreak}
            currentBreak={puttCurrentBreak}
            onSetCurrentBreak={setPuttCurrentBreak}
            onSubmit={submitPutt}
            runningAvg={puttRunningAvg}
            onExit={exitPuttingToMenu}
            units={units}
            editingShotIndex={puttEditingShotIndex}
            onStartEditShot={setPuttEditingShotIndex}
            onSaveEditShot={savePuttShotEdit}
            onCancelEditShot={() => setPuttEditingShotIndex(null)}
          />
        )}

        {screen === "puttingSummary" && putts.length > 0 && (
          <PuttingSummaryScreen
            putts={putts}
            onNewSession={resetToPuttingSetup}
            storageError={puttStorageError}
            units={units}
            feedback={puttSessionFeedback}
            isOnCourse={puttSummaryIsOnCourse}
            chipIns={puttSummaryChipIns}
          />
        )}
      </div>
    </div>
  );
}

function Header({ screen, onSettings, onHome, onBack, backDestination }) {
  return (
    <div
      className="no-print"
      style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, gap: 8 }}
    >
      <div
        onClick={onHome}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          cursor: "pointer",
        }}
      >
        <img src={LOGO_SRC} alt="" style={{ width: 20, height: 20, flexShrink: 0 }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 19,
              letterSpacing: 0.5,
              lineHeight: 1,
              color: COLORS.cream,
            }}
          >
            THE PRACTICE APP
          </div>
          <PlayerBadge />
        </div>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {screen !== "home" && backDestination !== "home" && (
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: `1px solid ${COLORS.creamDim}55`,
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: "4px 7px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            BACK
          </button>
        )}
        {screen !== "home" && (
          <button
            onClick={onHome}
            style={{
              background: "none",
              border: `1px solid ${COLORS.creamDim}55`,
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: "4px 7px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            HOME
          </button>
        )}
        {screen === "home" && (
          <button
            onClick={onSettings}
            style={{
              background: "none",
              border: `1px solid ${COLORS.creamDim}55`,
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: "4px 7px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            SETTINGS
          </button>
        )}
      </div>
    </div>
  );
}

function PillOption({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 0",
        borderRadius: 10,
        border: active ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
        background: active ? COLORS.fairway : "transparent",
        color: active ? COLORS.cream : COLORS.creamDim,
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 18,
        letterSpacing: 1,
        cursor: "pointer",
        transition: "all 120ms ease",
      }}
    >
      {label}
    </button>
  );
}

function RangeOnboardingScreen({ onAnswer }) {
  const [step, setStep] = useState("device"); // device | method

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>THE RANGE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          One quick question before you start
        </div>
      </div>

      {step === "device" ? (
        <Card>
          <SectionLabel>Setup</SectionLabel>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
            Do you have access to a launch monitor or distance measuring device?
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              onClick={() => onAnswer("distance")}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: COLORS.flag,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              YES
            </button>
            <button
              onClick={() => setStep("method")}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              NO
            </button>
          </div>
        </Card>
      ) : (
        <Card>
          <SectionLabel>No device? No problem</SectionLabel>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
            Would you still like to enter a distance for each shot (paced off or estimated), or rate
            your own strike out of 5 instead?
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            <button
              onClick={() => onAnswer("distance")}
              style={{
                padding: "12px 0",
                borderRadius: 10,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              ENTER A DISTANCE
            </button>
            <button
              onClick={() => onAnswer("rating")}
              style={{
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: COLORS.flag,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              RATE EACH SHOT OUT OF 5
            </button>
          </div>
          <div
            onClick={() => setStep("device")}
            style={{
              textAlign: "center",
              marginTop: 12,
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            BACK
          </div>
        </Card>
      )}

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 12, lineHeight: 1.5 }}>
        You can change this later in Settings.
      </div>
    </div>
  );
}

function SetupScreen({
  shotCount,
  setShotCount,
  minDist,
  maxDist,
  setMinDist,
  setMaxDist,
  onStart,
  activeSaved,
  onResume,
  onDiscard,
  onLoadTestData,
  onViewAnalysis,
  units,
}) {
  const invalidRange = minDist >= maxDist || minDist < 0;
  const unitLabel = longUnitLabel(units);
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>THE RANGE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Distance control practice
        </div>
      </div>

      {activeSaved && (
        <Card style={{ marginBottom: 10, border: `1px solid ${COLORS.sand}66` }}>
          <SectionLabel>Session in progress</SectionLabel>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, marginTop: 3 }}>
            Shot {activeSaved.shots.length + 1} of {activeSaved.shotCount}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
            {ydsToUnitRound(activeSaved.minDist, units)}-{ydsToUnitRound(activeSaved.maxDist, units)}
            {unitLabel} window
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={onResume}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 8,
                border: "none",
                background: COLORS.sand,
                color: COLORS.turfDark,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              RESUME
            </button>
            <button
              onClick={onDiscard}
              style={{
                padding: "9px 14px",
                borderRadius: 8,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              DISCARD
            </button>
          </div>
        </Card>
      )}

      <Card>
        <SectionLabel>Shots this session</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[10, 20, 50].map((n) => (
            <PillOption key={n} label={n} active={shotCount === n} onClick={() => setShotCount(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Distance window ({unitLabel})</SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField
            label="MIN"
            value={ydsToUnitRound(minDist, units)}
            onChange={(v) => setMinDist(unitToYdsRound(v, units))}
          />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField
            label="MAX"
            value={ydsToUnitRound(maxDist, units)}
            onChange={(v) => setMaxDist(unitToYdsRound(v, units))}
          />
        </div>
        {invalidRange && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Max must be greater than min.
          </div>
        )}
      </Card>

      <button
        onClick={onStart}
        disabled={invalidRange}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: invalidRange ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: invalidRange ? "not-allowed" : "pointer",
        }}
      >
        START SESSION
      </button>

      <div
        onClick={onViewAnalysis}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        View range analysis
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
        {label}
      </div>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
        style={{
          width: "100%",
          background: COLORS.turfDark,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 8,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          padding: "6px 10px",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function DistanceGauge({ min, max, target, actual, unit = "y" }) {
  const targetPct = ((target - min) / (max - min)) * 100;
  const actualPct = actual !== null ? Math.max(0, Math.min(100, ((actual - min) / (max - min)) * 100)) : null;
  return (
    <div style={{ margin: "12px 0 4px" }}>
      <div
        style={{
          position: "relative",
          height: 8,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${COLORS.turfDark}, ${COLORS.fairway}, ${COLORS.turfDark})`,
        }}
      >
        <div
          title="target"
          style={{
            position: "absolute",
            left: `${targetPct}%`,
            top: -10,
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "7px solid transparent",
            borderRight: "7px solid transparent",
            borderTop: `10px solid ${COLORS.flag}`,
          }}
        />
        {actualPct !== null && (
          <div
            title="your shot"
            style={{
              position: "absolute",
              left: `${actualPct}%`,
              top: 2,
              transform: "translateX(-50%)",
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: COLORS.cream,
              boxShadow: `0 0 0 5px ${COLORS.cream}22`,
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

function PracticeScreen({
  shots,
  shotCount,
  currentTarget,
  minDist,
  maxDist,
  actualInput,
  setActualInput,
  onSubmit,
  onSubmitRating,
  runningTotal,
  runningAvg,
  inputRef,
  onExit,
  units,
  mode,
  editingShotIndex,
  onStartEditShot,
  onSaveEditShot,
  onCancelEditShot,
}) {
  const shotNum = shots.length + 1;
  const unitLabel = longUnitLabel(units);
  const isRating = mode === "rating";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          SHOT {shotNum} OF {shotCount}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          SAVE &amp; EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            TARGET
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag }}>
            {ydsToUnitRound(currentTarget, units)}
            <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
          </div>
        </div>

        <DistanceGauge
          min={ydsToUnitRound(minDist, units)}
          max={ydsToUnitRound(maxDist, units)}
          target={ydsToUnitRound(currentTarget, units)}
          actual={null}
          unit={unitLabel}
        />

        {isRating ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>
              RATE THIS SHOT (5 = GREAT)
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => onSubmitRating(n)}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 10,
                    border: `2px solid ${ratingRagColor(n)}`,
                    background: "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 20,
                    cursor: "pointer",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 5 }}>
              YOUR CARRY ({unitLabel.toUpperCase()})
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                type="number"
                inputMode="decimal"
                value={actualInput}
                onChange={(e) => setActualInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSubmit()}
                placeholder="0"
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 24,
                  padding: "7px 12px",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={onSubmit}
                disabled={actualInput === ""}
                style={{
                  padding: "0 18px",
                  borderRadius: 8,
                  border: "none",
                  background: actualInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  letterSpacing: 1,
                  cursor: actualInput === "" ? "not-allowed" : "pointer",
                }}
              >
                LOG
              </button>
            </div>
          </div>
        )}
      </Card>

      {isRating ? (
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox
            label="AVG RATING"
            value={shots.length ? `${avg(shots.map((s) => s.rating)).toFixed(1)}/5` : "—"}
            valueColor={shots.length ? ratingRagColor(avg(shots.map((s) => s.rating))) : COLORS.cream}
          />
          <StatBox label="SHOTS LOGGED" value={shots.length} />
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox
            label="AVG SG / SHOT"
            value={shots.length ? formatSG(avg(shots.map((s) => sgForApproachShot(s.target, s.actual)))) : "—"}
            valueColor={shots.length ? sgRagColor(avg(shots.map((s) => sgForApproachShot(s.target, s.actual)))) : COLORS.cream}
          />
          <StatBox label="AVG MISS" value={`${fmt1(ydsToUnit(runningAvg, units))}${unitLabel}`} />
        </div>
      )}

      {shots.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>This session — tap a shot to amend</SectionLabel>
          <div style={{ marginTop: 4 }}>
            {isRating ? (
              <RatingLog shots={shots} units={units} onEditShot={onStartEditShot} />
            ) : (
              <ShotLog shots={shots} units={units} onEditShot={onStartEditShot} />
            )}
          </div>
        </div>
      )}

      {editingShotIndex !== null && (
        <ShotEditModal
          shot={shots[editingShotIndex]}
          mode={mode}
          units={units}
          onSave={onSaveEditShot}
          onCancel={onCancelEditShot}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, valueColor }) {
  return (
    <div
      style={{
        flex: 1,
        background: `${COLORS.turf}aa`,
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        padding: "9px 12px",
      }}
    >
      <div style={{ fontSize: 9, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: valueColor || COLORS.cream, marginTop: 1 }}>
        {value}
      </div>
    </div>
  );
}

function ShotLog({ shots, units, onEditShot }) {
  const unitLabel = longUnitLabel(units);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ width: 24 }}>#</div>
        <div style={{ flex: 1 }}>TARGET</div>
        <div style={{ flex: 1 }}>ACTUAL</div>
        <div style={{ width: 50, textAlign: "right" }}>MISS</div>
        <div style={{ width: 50, textAlign: "right" }}>SG</div>
      </div>
      <div style={{ maxHeight: 150, overflowY: "auto" }}>
        {/* Newest shot first — display order only. Each row keeps its original index (i) for
            onEditShot and its original shot number (i + 1), so amending still targets the right
            shot and numbering doesn't shift around as you keep hitting. */}
        {shots.map((s, i) => i).reverse().map((i) => {
          const s = shots[i];
          const sg = sgForApproachShot(s.target, s.actual);
          return (
            <div
              key={i}
              onClick={() => onEditShot && onEditShot(i)}
              style={{
                display: "flex",
                padding: "7px 12px",
                borderTop: `1px solid ${COLORS.creamDim}11`,
                color: COLORS.cream,
                cursor: onEditShot ? "pointer" : "default",
              }}
            >
              <div style={{ width: 24, color: COLORS.creamDim }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                {fmt1(ydsToUnit(s.target, units))}
                {unitLabel}
              </div>
              <div style={{ flex: 1 }}>
                {fmt1(ydsToUnit(s.actual, units))}
                {unitLabel}
              </div>
              <div style={{ width: 50, textAlign: "right", color: ragColor(ragStatus(s.diff, s.target)) }}>
                {fmt1(ydsToUnit(s.diff, units))}
                {unitLabel}
              </div>
              <div style={{ width: 50, textAlign: "right", color: sgRagColor(sg) }}>{formatSG(sg)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RatingLog({ shots, units, onEditShot }) {
  const unitLabel = longUnitLabel(units);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ width: 24 }}>#</div>
        <div style={{ flex: 1 }}>TARGET</div>
        <div style={{ width: 60, textAlign: "right" }}>RATING</div>
      </div>
      <div style={{ maxHeight: 150, overflowY: "auto" }}>
        {/* Newest shot first — display order only; original index/number preserved (see ShotLog). */}
        {shots.map((s, i) => i).reverse().map((i) => {
          const s = shots[i];
          return (
            <div
              key={i}
              onClick={() => onEditShot && onEditShot(i)}
              style={{
                display: "flex",
                padding: "7px 12px",
                borderTop: `1px solid ${COLORS.creamDim}11`,
                color: COLORS.cream,
                cursor: onEditShot ? "pointer" : "default",
              }}
            >
              <div style={{ width: 24, color: COLORS.creamDim }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                {ydsToUnitRound(s.target, units)}
                {unitLabel}
              </div>
              <div style={{ width: 60, textAlign: "right", color: ratingRagColor(s.rating) }}>{s.rating}/5</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryScreen({ shots, minDist, maxDist, onNewSession, storageError, units, feedback }) {
  const isRating = shots.length > 0 && shots[0].rating !== undefined;
  const unitLabel = longUnitLabel(units);

  if (isRating) {
    const avgRating = avg(shots.map((s) => s.rating));
    const best = shots.reduce((b, s) => (s.rating > b.rating ? s : b), shots[0]);
    const worst = shots.reduce((w, s) => (s.rating < w.rating ? s : w), shots[0]);

    return (
      <div>
        <SessionFeedbackBanner feedback={feedback} />
        <Card>
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              SESSION COMPLETE — {shots.length} SHOTS · {ydsToUnitRound(minDist, units)}-{ydsToUnitRound(maxDist, units)}
              {unitLabel.toUpperCase()}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <StatBox label="AVG RATING" value={`${avgRating.toFixed(1)}/5`} valueColor={ratingRagColor(avgRating)} />
            <StatBox label="SHOTS LOGGED" value={shots.length} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <StatBox label="BEST SHOT" value={`${best.rating}/5`} valueColor={ratingRagColor(best.rating)} />
            <StatBox label="WORST SHOT" value={`${worst.rating}/5`} valueColor={ratingRagColor(worst.rating)} />
          </div>
        </Card>

        <div style={{ marginTop: 10 }}>
          <SectionLabel>Full log</SectionLabel>
          <div style={{ marginTop: 4 }}>
            <RatingLog shots={shots} units={units} />
          </div>
        </div>

        {storageError && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Couldn't save this session to history — it's still shown above.
          </div>
        )}

        <button
          onClick={onNewSession}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "13px 0",
            borderRadius: 12,
            border: "none",
            background: COLORS.flag,
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 20,
            letterSpacing: 2,
            cursor: "pointer",
          }}
        >
          NEW SESSION
        </button>
      </div>
    );
  }

  const total = shots.reduce((a, s) => a + s.diff, 0);
  const average = avg(shots.map((s) => s.diff));
  const best = shots.reduce((b, s) => (s.diff < b.diff ? s : b), shots[0]);
  const worst = shots.reduce((w, s) => (s.diff > w.diff ? s : w), shots[0]);
  const avgSG = avg(shots.map((s) => sgForApproachShot(s.target, s.actual)));
  const totalSG = shots.reduce((a, s) => a + sgForApproachShot(s.target, s.actual), 0);

  return (
    <div>
      <SessionFeedbackBanner feedback={feedback} />
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            SESSION COMPLETE — {shots.length} SHOTS · {ydsToUnitRound(minDist, units)}-{ydsToUnitRound(maxDist, units)}
            {unitLabel.toUpperCase()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="TOTAL SG" value={formatSG(totalSG)} valueColor={sgRagColor(avgSG)} />
          <StatBox label="AVG SG / SHOT" value={formatSG(avgSG)} valueColor={sgRagColor(avgSG)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="TOTAL MISS" value={`${fmt1(ydsToUnit(total, units))}${unitLabel}`} />
          <StatBox label="AVG MISS" value={`${fmt1(ydsToUnit(average, units))}${unitLabel}`} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox
            label="BEST SHOT"
            value={`${fmt1(ydsToUnit(best.diff, units))}${unitLabel}`}
            valueColor={ragColor(ragStatus(best.diff, best.target))}
          />
          <StatBox
            label="WORST SHOT"
            value={`${fmt1(ydsToUnit(worst.diff, units))}${unitLabel}`}
            valueColor={ragColor(ragStatus(worst.diff, worst.target))}
          />
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Short vs long of the pin</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2, marginBottom: 10 }}>
          Each dot is one shot, colored by its own strokes gained
        </div>
        <ShotDispersionChart
          rows={shots.map((s) => ({ target: s.target, signedMiss: s.actual - s.target, sg: sgForApproachShot(s.target, s.actual), bucket: bucketFor(s.target) }))}
          units={units}
        />
      </Card>

      <div style={{ marginTop: 10 }}>
        <SectionLabel>Full log</SectionLabel>
        <div style={{ marginTop: 4 }}>
          <ShotLog shots={shots} units={units} />
        </div>
      </div>

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this session to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onNewSession}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW SESSION
      </button>
    </div>
  );
}

function TimescalePicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
      {TIMESCALES.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: value === t.key ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: value === t.key ? COLORS.fairway : "transparent",
            color: value === t.key ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function BucketRow({ bucket, showImprovement }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: COLORS.cream }}>{bucket.label}y</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          {bucket.count} shots · avg {bucket.avgMissYds.toFixed(1)}y off
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: sgRagColor(bucket.avgSG) }}>
          {formatSG(bucket.avgSG)}
        </div>
        {showImprovement && bucket.improvement !== null && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: bucket.improvement > 0 ? COLORS.fairwayLight : COLORS.flag,
            }}
          >
            {bucket.improvement > 0 ? "▲" : "▼"} {Math.abs(bucket.improvement).toFixed(2)} SG
          </div>
        )}
      </div>
    </div>
  );
}

// One horizontal strip per distance band: every shot in that band plotted as a dot, positioned
// short (left) or long (right) of the pin at center, each dot colored by that individual shot's
// own strokes gained — so a band that's consistently red on one side reveals a real tendency,
// not just an average that could be hiding a mix of good and bad shots.
function ShotDispersionStrip({ label, rows, units }) {
  const width = 300;
  const height = 60;
  const midX = width / 2;
  const padX = 22;
  const plotCenterY = 26;
  const unitLabel = longUnitLabel(units);

  // Always show at least the 5/10/15y reference lines so the scale is readable even when every
  // shot in this band is tight — only extend further if an actual miss goes beyond 15.
  const dataMax = Math.max(0, ...rows.map((r) => Math.abs(r.signedMiss)));
  const gridMax = Math.max(15, Math.ceil(dataMax / 5) * 5);
  const gridValues = [];
  for (let g = 5; g <= gridMax; g += 5) gridValues.push(g);

  function xFor(signedMiss) {
    return midX + (signedMiss / gridMax) * (midX - padX);
  }
  // Small deterministic vertical jitter so overlapping dots at similar misses are still visible.
  function yFor(i) {
    return plotCenterY + (((i * 37) % 13) - 6);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
        {label}
        {unitLabel} · {rows.length} shot{rows.length === 1 ? "" : "s"}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height, marginTop: 4, display: "block" }}>
        <line x1={padX} y1={plotCenterY} x2={width - padX} y2={plotCenterY} stroke={COLORS.creamDim} strokeOpacity={0.25} strokeWidth={1} />
        {gridValues.map((g) => (
          <g key={g}>
            <line x1={xFor(-g)} y1={8} x2={xFor(-g)} y2={44} stroke={COLORS.creamDim} strokeOpacity={0.2} strokeWidth={1} strokeDasharray="2 2" />
            <line x1={xFor(g)} y1={8} x2={xFor(g)} y2={44} stroke={COLORS.creamDim} strokeOpacity={0.2} strokeWidth={1} strokeDasharray="2 2" />
            <text x={xFor(-g)} y={54} fontSize={7} fill={COLORS.creamDim} textAnchor="middle" fontFamily="'JetBrains Mono', monospace">
              {ydsToUnitRound(g, units)}
            </text>
            <text x={xFor(g)} y={54} fontSize={7} fill={COLORS.creamDim} textAnchor="middle" fontFamily="'JetBrains Mono', monospace">
              {ydsToUnitRound(g, units)}
            </text>
          </g>
        ))}
        <line x1={midX} y1={6} x2={midX} y2={44} stroke={COLORS.sand} strokeWidth={2} />
        {rows.map((r, i) => (
          <circle key={i} cx={xFor(r.signedMiss)} cy={yFor(i)} r={5} fill={sgRagColor(r.sg)} fillOpacity={0.88} />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 2 }}>
        <span>← SHORT</span>
        <span>PIN</span>
        <span>LONG →</span>
      </div>
    </div>
  );
}

// rows must include {target, signedMiss, sg, bucket} — either flattened session rows (Analysis
// screens) or a single session's raw shots mapped to that shape (post-session Summary screen).
function ShotDispersionChart({ rows, units }) {
  const byBucket = {};
  rows.forEach((r) => {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = [];
    byBucket[r.bucket].push(r);
  });
  const bands = Object.entries(byBucket)
    .filter(([, bandRows]) => bandRows.length >= 2)
    .sort((a, b) => bucketSortKey(a[0]) - bucketSortKey(b[0]));

  if (bands.length === 0) {
    return (
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim }}>
        Need at least 2 shots in a single distance band to plot this.
      </div>
    );
  }

  return (
    <div>
      {bands.map(([label, bandRows]) => (
        <ShotDispersionStrip key={label} label={label} rows={bandRows} units={units} />
      ))}
    </div>
  );
}

function InsightCard({ title, subtitle, items, emptyText }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, padding: "6px 0" }}>
            {emptyText}
          </div>
        ) : (
          items.map((b, i) => (
            <div key={b.label} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <BucketRow bucket={b} showImprovement={b.improvement !== undefined} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function YardagePicker({ min, max, onMin, onMax, onPreset, activePresetLabel }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {YARDAGE_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onPreset(p)}
            style={{
              padding: "7px 11px",
              borderRadius: 8,
              border: activePresetLabel === p.label ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: activePresetLabel === p.label ? COLORS.fairway : "transparent",
              color: activePresetLabel === p.label ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <NumberField label="MIN YDS" value={min} onChange={onMin} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 14 }}>—</div>
        <NumberField label="MAX YDS" value={max} onChange={onMax} />
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, suffix }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: COLORS.turfDark,
        border: `1px solid ${COLORS.creamDim}33`,
        borderRadius: 8,
        padding: "8px 10px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        color: COLORS.cream,
      }}
    >
      <div style={{ color: COLORS.creamDim, marginBottom: 2 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i}>
          {p.value.toFixed(1)}
          {suffix}
        </div>
      ))}
    </div>
  );
}

const ANALYSIS_SECTIONS = [
  { key: "range", label: "RANGE" },
  { key: "teeaccuracy", label: "TEE ACC." },
  { key: "shortgame", label: "SHORT GAME" },
  { key: "putting", label: "PUTTING" },
];

function SettingsScreen({
  baselineHandicap,
  onSetBaseline,
  units,
  onSetUnits,
  rangeTrackingMode,
  onSetRangeTrackingMode,
  onBack,
  profileName,
  onSwitchProfile,
  onExportData,
  onImportData,
  sampleDataAreas,
  onLoadAllSampleData,
  onClearAllSampleData,
  myCoachLinks,
  onOpenAddCoach,
  onDisconnectCoach,
}) {
  // Most recent link (by requestedAt) determines what the Coach card shows — a player can have
  // more than one row here over time (e.g. a declined request followed by a new one to a
  // different coach), but only the latest is relevant to surface on Settings.
  const currentCoachLink =
    myCoachLinks && myCoachLinks.length
      ? [...myCoachLinks].sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0))[0]
      : null;
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>SETTINGS</div>
      </div>

      <Card>
        <SectionLabel>Baseline</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Strokes gained everywhere in the app is measured against this level. Round-level data
          converted to a flat per-shot offset — a useful approximation, not a precise
          distance-calibrated model like the PGA Tour numbers.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 12 }}>
          {BASELINE_OPTIONS.map((b) => (
            <button
              key={b.key}
              onClick={() => onSetBaseline(b.key)}
              style={{
                padding: "9px 2px",
                borderRadius: 8,
                border: baselineHandicap === b.key ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                background: baselineHandicap === b.key ? COLORS.fairway : "transparent",
                color: baselineHandicap === b.key ? COLORS.cream : COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: 0.3,
                cursor: "pointer",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <SectionLabel>Units</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Distances are always calculated internally in yards/feet, then converted for display —
          switching units won't change past sessions.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => onSetUnits("imperial")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: units === "imperial" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: units === "imperial" ? COLORS.fairway : "transparent",
              color: units === "imperial" ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            IMPERIAL (YD/FT)
          </button>
          <button
            onClick={() => onSetUnits("metric")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: units === "metric" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: units === "metric" ? COLORS.fairway : "transparent",
              color: units === "metric" ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            METRIC (M)
          </button>
        </div>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <SectionLabel>Range tracking</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Without a launch monitor or distance measuring device, exact carry distances aren't
          reliable. Switch to self-rating and score each shot out of 5 instead — strokes gained and
          miss-distance stats won't apply to those sessions, but you'll still see useful trends.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => onSetRangeTrackingMode("distance")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: rangeTrackingMode === "distance" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: rangeTrackingMode === "distance" ? COLORS.fairway : "transparent",
              color: rangeTrackingMode === "distance" ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 14,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            ENTER DISTANCE
          </button>
          <button
            onClick={() => onSetRangeTrackingMode("rating")}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: rangeTrackingMode === "rating" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: rangeTrackingMode === "rating" ? COLORS.fairway : "transparent",
              color: rangeTrackingMode === "rating" ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 14,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            RATE OUT OF 5
          </button>
        </div>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <SectionLabel>Profile</SectionLabel>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, marginTop: 6, color: COLORS.cream }}>
          {profileName}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Your data is synced to your account, not just this device — sign in with the same email
          on another phone or browser and it'll all be there. Export a backup any time if you want
          a local copy too.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={onExportData}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 13,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            EXPORT DATA
          </button>
          <label
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 13,
              letterSpacing: 0.5,
              cursor: "pointer",
              textAlign: "center",
              display: "block",
            }}
          >
            IMPORT DATA
            <input
              type="file"
              accept="application/json"
              onChange={(e) => e.target.files[0] && onImportData(e.target.files[0])}
              style={{ display: "none" }}
            />
          </label>
        </div>
        <button
          onClick={onSwitchProfile}
          style={{
            width: "100%",
            marginTop: 8,
            padding: "10px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          SIGN OUT
        </button>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <SectionLabel>Coach</SectionLabel>
        {!currentCoachLink && (
          <>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
              Search for your coach and send them a request — once they approve it, they'll be
              able to see your stats and help you focus your practice.
            </div>
            <button
              onClick={onOpenAddCoach}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "11px 0",
                borderRadius: 10,
                border: `1px solid ${COLORS.fairwayLight}66`,
                background: "transparent",
                color: COLORS.fairwayLight,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 15,
                letterSpacing: 0.5,
                cursor: "pointer",
              }}
            >
              ADD COACH
            </button>
          </>
        )}
        {currentCoachLink && currentCoachLink.status === "pending" && (
          <>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, marginTop: 6, color: COLORS.cream }}>
              {currentCoachLink.coachName}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand, marginTop: 4 }}>
              Request pending — waiting for them to approve
            </div>
            <button
              onClick={onOpenAddCoach}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 0",
                borderRadius: 10,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                letterSpacing: 0.5,
                cursor: "pointer",
              }}
            >
              VIEW / MANAGE
            </button>
          </>
        )}
        {currentCoachLink && currentCoachLink.status === "approved" && (
          <>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, marginTop: 6, color: COLORS.cream }}>
              {currentCoachLink.coachName}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.fairwayLight, marginTop: 4 }}>
              Connected — they can see your stats
            </div>
            {!confirmingDisconnect && (
              <button
                onClick={() => setConfirmingDisconnect(true)}
                style={{
                  width: "100%",
                  marginTop: 10,
                  padding: "10px 0",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.creamDim}33`,
                  background: "transparent",
                  color: COLORS.creamDim,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  letterSpacing: 0.5,
                  cursor: "pointer",
                }}
              >
                DISCONNECT COACH
              </button>
            )}
            {confirmingDisconnect && (
              <>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 10, lineHeight: 1.5 }}>
                  Remove {currentCoachLink.coachName}? They'll lose access to your stats and you'll
                  need to send a new request to reconnect.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => setConfirmingDisconnect(false)}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      borderRadius: 10,
                      border: `1px solid ${COLORS.creamDim}33`,
                      background: "transparent",
                      color: COLORS.creamDim,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 14,
                      letterSpacing: 0.5,
                      cursor: "pointer",
                    }}
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={() => {
                      setConfirmingDisconnect(false);
                      onDisconnectCoach(currentCoachLink.coachId);
                    }}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      borderRadius: 10,
                      border: `1px solid ${COLORS.flag}66`,
                      background: "transparent",
                      color: COLORS.flag,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 14,
                      letterSpacing: 0.5,
                      cursor: "pointer",
                    }}
                  >
                    DISCONNECT
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {currentCoachLink && currentCoachLink.status === "declined" && (
          <>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
              Your request to {currentCoachLink.coachName} wasn't accepted. You can search for a
              different coach, or try again.
            </div>
            <button
              onClick={onOpenAddCoach}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "11px 0",
                borderRadius: 10,
                border: `1px solid ${COLORS.fairwayLight}66`,
                background: "transparent",
                color: COLORS.fairwayLight,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 15,
                letterSpacing: 0.5,
                cursor: "pointer",
              }}
            >
              ADD COACH
            </button>
          </>
        )}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <SectionLabel>Sample data</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Load 10 generated sample sessions into every section at once to try out Analysis, or
          clear all of them to start fresh. Applies only to this profile.
        </div>

        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 12 }}>
          {sampleDataAreas.reduce((a, area) => a + area.count, 0)} sample session
          {sampleDataAreas.reduce((a, area) => a + area.count, 0) === 1 ? "" : "s"} across every section
        </div>

        <button
          onClick={onLoadAllSampleData}
          style={{
            width: "100%",
            marginTop: 10,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.sand}66`,
            background: "transparent",
            color: COLORS.sand,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          + ADD 10 SAMPLE SESSIONS TO EVERY SECTION
        </button>

        <button
          onClick={onClearAllSampleData}
          disabled={sampleDataAreas.every((area) => area.count === 0)}
          style={{
            width: "100%",
            marginTop: 8,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${sampleDataAreas.every((area) => area.count === 0) ? COLORS.creamDim + "33" : COLORS.flag}`,
            background: "transparent",
            color: sampleDataAreas.every((area) => area.count === 0) ? COLORS.creamDim : COLORS.flag,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            letterSpacing: 0.5,
            cursor: sampleDataAreas.every((area) => area.count === 0) ? "not-allowed" : "pointer",
          }}
        >
          CLEAR ALL SECTIONS
        </button>
      </Card>

      <button
        onClick={onBack}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: `1px solid ${COLORS.creamDim}33`,
          background: "transparent",
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 18,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        BACK
      </button>
    </div>
  );
}

// ===== Add Coach: search coaches by name/email, apply, and track request status. Coach profiles
// live in a small shared "coaches" collection in the same Firebase project the Coach app writes
// to — see storage.js's searchCoaches/applyToCoach/withdrawCoachRequest. =====
function CoachSearchResultCard({ coach, link, onApply, applying }) {
  const status = link ? link.status : null;
  return (
    <Card style={{ marginBottom: 8 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.cream }}>{coach.name}</div>
      {coach.bio && (
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.45 }}>
          {coach.bio}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        {status === "approved" && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.fairwayLight }}>
            Connected — they can see your stats
          </div>
        )}
        {status === "pending" && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand }}>
            Request pending
          </div>
        )}
        {(status === "declined" || !status) && (
          <button
            onClick={() => onApply(coach)}
            disabled={applying}
            style={{
              width: "100%",
              padding: "9px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.fairwayLight}66`,
              background: "transparent",
              color: COLORS.fairwayLight,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 14,
              letterSpacing: 0.5,
              cursor: applying ? "not-allowed" : "pointer",
            }}
          >
            {applying ? "SENDING…" : status === "declined" ? "APPLY AGAIN" : "APPLY"}
          </button>
        )}
      </div>
    </Card>
  );
}

function AddCoachScreen({ profileId, profileName, myCoachLinks, onBack }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null); // null = not searched yet
  const [loading, setLoading] = useState(false);
  const [applyingCoachId, setApplyingCoachId] = useState(null);
  const [error, setError] = useState(null);

  const linkByCoachId = {};
  for (const l of myCoachLinks || []) linkByCoachId[l.coachId] = l;

  async function runSearch(text) {
    setLoading(true);
    setError(null);
    try {
      const coaches = await searchCoaches(text);
      setResults(coaches);
    } catch (e) {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply(coach) {
    setApplyingCoachId(coach.id);
    try {
      await applyToCoach(profileId, profileName || "Player", coach.email || "", coach.id, coach.name);
    } catch (e) {
      setError("Couldn't send that request — try again.");
    } finally {
      setApplyingCoachId(null);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>SETTINGS · COACH</SectionLabel>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginTop: 2 }}>Add a coach</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
          placeholder="Search by name or email"
          style={{
            flex: 1,
            background: COLORS.turfDark,
            border: `1px solid ${COLORS.creamDim}33`,
            borderRadius: 8,
            color: COLORS.cream,
            fontFamily: "'Inter', sans-serif",
            fontSize: 15,
            padding: "10px 12px",
            boxSizing: "border-box",
          }}
          autoFocus
        />
        <button
          onClick={() => runSearch(query)}
          style={{
            padding: "0 16px",
            borderRadius: 8,
            border: "none",
            background: COLORS.fairway,
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 14,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          SEARCH
        </button>
      </div>

      {error && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.flag, marginBottom: 12 }}>{error}</div>
      )}

      {results === null && !loading && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, opacity: 0.75, lineHeight: 1.5 }}>
          Search for your coach by name, or leave it blank and tap Search to see every coach
          currently on The Practice App.
        </div>
      )}

      {loading && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>Searching…</div>
      )}

      {results !== null && !loading && results.length === 0 && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, opacity: 0.75 }}>
          No coaches found for that search.
        </div>
      )}

      {results !== null &&
        !loading &&
        results.map((coach) => (
          <CoachSearchResultCard
            key={coach.id}
            coach={coach}
            link={linkByCoachId[coach.id]}
            onApply={handleApply}
            applying={applyingCoachId === coach.id}
          />
        ))}

      <button
        onClick={onBack}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: `1px solid ${COLORS.creamDim}33`,
          background: "transparent",
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 18,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        BACK
      </button>
    </div>
  );
}

function CoachSummaryScreen({ profileName, profileHandicap, baselineHandicap, rangeHistory, teeHistory, shortGameHistory, puttingHistory, units }) {
  const [timescale, setTimescale] = useState("all");
  const [printMode, triggerPrint] = usePrintMode();

  const rangeDistanceHistory = rangeHistory.filter((s) => s.mode !== "rating");
  const rangeRatingHistoryAll = rangeHistory.filter((s) => s.mode === "rating");
  const puttingPracticeHistory = puttingHistory.filter((s) => s.type !== "course");
  const puttingCourseHistory = puttingHistory.filter((s) => s.type === "course");

  const filteredRangeDistance = filterByTimescale(rangeDistanceHistory, timescale);
  const filteredRangeRating = filterByTimescale(rangeRatingHistoryAll, timescale);
  const filteredTee = filterByTimescale(teeHistory, timescale);
  const filteredShortGame = filterByTimescale(shortGameHistory, timescale);
  const filteredPuttingPractice = filterByTimescale(puttingPracticeHistory, timescale);
  const filteredPuttingCourse = filterByTimescale(puttingCourseHistory, timescale);

  const rangeAnalysis = computeAnalysis(filteredRangeDistance);
  const rangeRatingAnalysis = computeRangeRatingAnalysis(filteredRangeRating);
  const teeAnalysis = computeTeeAccuracyAnalysis(filteredTee);
  const shortGameAnalysis = computeShortGameAnalysis(filteredShortGame);
  const puttingPracticeAnalysis = computePuttingAnalysis(filteredPuttingPractice);
  const puttingCourseAnalysis = computePuttingAnalysis(filteredPuttingCourse);

  const baselineLabel = BASELINE_OPTIONS.find((b) => b.key === baselineHandicap)?.label || "PGA TOUR";

  function trendMark(delta, threshold) {
    if (Math.abs(delta) < threshold) return { icon: "◆", color: COLORS.creamDim };
    return delta > 0 ? { icon: "▲", color: COLORS.fairwayLight } : { icon: "▼", color: COLORS.flag };
  }

  const glanceRows = [];
  if (rangeAnalysis) {
    const t = trendMark(rangeAnalysis.trendDelta, 0.03);
    glanceRows.push({
      label: "Range — Distance",
      sessions: rangeAnalysis.sessionCount,
      metric: formatSG(rangeAnalysis.overallAvgSG),
      metricColor: sgRagColor(rangeAnalysis.overallAvgSG),
      trend: t,
    });
  }
  if (rangeRatingAnalysis) {
    const t = trendMark(rangeRatingAnalysis.trendDelta, 0.1);
    glanceRows.push({
      label: "Range — Self-Rated",
      sessions: rangeRatingAnalysis.sessionCount,
      metric: `${rangeRatingAnalysis.overallAvgRating.toFixed(1)}/5`,
      metricColor: ratingRagColor(rangeRatingAnalysis.overallAvgRating),
      trend: t,
    });
  }
  if (teeAnalysis) {
    const t = trendMark(teeAnalysis.trendDelta, 1);
    glanceRows.push({
      label: "Tee Accuracy",
      sessions: filteredTee.length,
      metric: `${teeAnalysis.overallHitPct.toFixed(0)}% fairways`,
      metricColor: ratingRagColor(teeAnalysis.overallHitPct / 20),
      trend: t,
    });
  }
  if (shortGameAnalysis) {
    const t = trendMark(shortGameAnalysis.trendDelta, 0.03);
    glanceRows.push({
      label: "Short Game",
      sessions: filteredShortGame.length,
      metric: formatSG(shortGameAnalysis.overallAvgSG),
      metricColor: sgRagColor(shortGameAnalysis.overallAvgSG),
      trend: t,
    });
  }
  if (puttingPracticeAnalysis) {
    const t = trendMark(puttingPracticeAnalysis.trendDelta, 0.03);
    glanceRows.push({
      label: "Putting — Practice",
      sessions: puttingPracticeAnalysis.sessionCount,
      metric: formatSG(puttingPracticeAnalysis.overallAvgSG),
      metricColor: sgRagColor(puttingPracticeAnalysis.overallAvgSG),
      trend: t,
    });
  }
  if (puttingCourseAnalysis) {
    const t = trendMark(puttingCourseAnalysis.trendDelta, 0.03);
    glanceRows.push({
      label: "Putting — On Course",
      sessions: puttingCourseAnalysis.sessionCount,
      metric: formatSG(puttingCourseAnalysis.overallAvgSG),
      metricColor: sgRagColor(puttingCourseAnalysis.overallAvgSG),
      trend: t,
    });
  }

  // One condensed strength + focus line per area that has enough data to say something useful.
  const highlightLines = [];
  if (rangeAnalysis?.strengths.length) {
    const s = rangeAnalysis.strengths[0];
    highlightLines.push({ area: "Range", type: "strength", text: `${s.label}y band (${formatSG(s.avgSG)})` });
  }
  if (rangeAnalysis?.weaknesses.length) {
    const w = rangeAnalysis.weaknesses[0];
    highlightLines.push({ area: "Range", type: "focus", text: `${w.label}y band (${formatSG(w.avgSG)})` });
  }
  if (teeAnalysis?.buckets.filter((b) => b.count >= 3).length) {
    const sorted = [...teeAnalysis.buckets].filter((b) => b.count >= 3).sort((a, b) => b.hitPct - a.hitPct);
    if (sorted.length) highlightLines.push({ area: "Tee Accuracy", type: "strength", text: `${CLUB_LABELS[sorted[0].club]} (${sorted[0].hitPct.toFixed(0)}%)` });
    if (sorted.length > 1) highlightLines.push({ area: "Tee Accuracy", type: "focus", text: `${CLUB_LABELS[sorted[sorted.length - 1].club]} (${sorted[sorted.length - 1].hitPct.toFixed(0)}%)` });
  }
  if (shortGameAnalysis?.strengths.length) {
    const s = shortGameAnalysis.strengths[0];
    highlightLines.push({ area: "Short Game", type: "strength", text: `${LIE_LABELS[s.lie]} (${formatSG(s.avgSG)})` });
  }
  if (shortGameAnalysis?.weaknesses.length) {
    const w = shortGameAnalysis.weaknesses[0];
    highlightLines.push({ area: "Short Game", type: "focus", text: `${LIE_LABELS[w.lie]} (${formatSG(w.avgSG)})` });
  }
  if (puttingPracticeAnalysis?.strengths.length) {
    const s = puttingPracticeAnalysis.strengths[0];
    highlightLines.push({ area: "Putting", type: "strength", text: `${s.label}ft band (${formatSG(s.avgSG)})` });
  }
  if (puttingPracticeAnalysis?.weaknesses.length) {
    const w = puttingPracticeAnalysis.weaknesses[0];
    highlightLines.push({ area: "Putting", type: "focus", text: `${w.label}ft band (${formatSG(w.avgSG)})` });
  }

  const totalSessions = glanceRows.reduce((a, r) => a + r.sessions, 0);
  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: `1px solid ${COLORS.creamDim}15` };

  return (
    <div>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <TimescalePicker value={timescale} onChange={setTimescale} />
      </div>

      <Card style={{ padding: "16px 16px" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1, color: COLORS.cream }}>
          THE PRACTICE APP — PLAYER SUMMARY
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 6, lineHeight: 1.6 }}>
          {profileName || "Player"}
          {profileHandicap !== null && profileHandicap !== undefined ? ` · ${profileHandicap} hcp` : ""} · SG baseline: {baselineLabel}
          <br />
          Generated {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · Period: {TIMESCALES.find((t) => t.key === timescale)?.label || "ALL"} · {totalSessions} total sessions
        </div>
      </Card>

      {!totalSessions ? (
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 14 }}>
          No sessions logged in this period yet across any section. Log a few sessions, then come back here.
        </div>
      ) : (
        <>
          <Card style={{ marginTop: 10 }}>
            <SectionLabel>At a glance</SectionLabel>
            <div style={{ marginTop: 6 }}>
              {glanceRows.map((r) => (
                <div key={r.label} style={rowStyle}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: COLORS.cream }}>
                    {r.label}
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginLeft: 6 }}>
                      {r.sessions} sess.
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: r.metricColor }}>{r.metric}</span>
                    <span style={{ color: r.trend.color, fontSize: 12 }}>{r.trend.icon}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {highlightLines.length > 0 && (
            <Card style={{ marginTop: 10 }}>
              <SectionLabel>Strengths &amp; focus areas</SectionLabel>
              <div style={{ marginTop: 6 }}>
                {highlightLines.map((h, i) => (
                  <div key={i} style={rowStyle}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>{h.area}</div>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12,
                        color: h.type === "strength" ? COLORS.fairwayLight : COLORS.flag,
                        textAlign: "right",
                      }}
                    >
                      {h.type === "strength" ? "★ " : "→ "}
                      {h.text}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 12, lineHeight: 1.5 }}>
            ▲/▼ = trending better/worse across this period · ◆ = steady · Strokes gained figures are
            approximations based on the selected baseline, not precise tour-calibrated numbers for
            every category.
          </div>
        </>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function AnalysisScreen({
  section,
  onSectionChange,
  rangeHistory,
  rangeLoaded,
  onDeleteRangeSession,
  onEditRangeSessionShot,
  puttingHistory,
  puttingLoaded,
  onDeletePuttingSession,
  onEditPuttingSessionShot,
  clockHistory,
  clockLoaded,
  onDeleteClockSession,
  onEditClockSessionShot,
  startLineHistory,
  startLineLoaded,
  onDeleteStartLineSession,
  onEditStartLineSession,
  paceHistory,
  paceLoaded,
  onDeletePaceSession,
  onEditPacePutt,
  shortGameHistory,
  shortGameLoaded,
  onDeleteShortGameSession,
  onEditShortGameSessionShot,
  teeHistory,
  teeLoaded,
  onDeleteTeeSession,
  onEditTeeSessionShot,
  onBack,
  profileName,
  profileHandicap,
  baselineHandicap,
  units,
}) {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, letterSpacing: 1, lineHeight: 1 }}>ANALYSIS</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, marginTop: 2 }}>
          Track your progress across every session
        </div>
      </div>

      <button
        onClick={() => onSectionChange("coach")}
        className="no-print"
        style={{
          width: "100%",
          marginBottom: 14,
          padding: "12px 0",
          borderRadius: 10,
          border: section === "coach" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.sand}88`,
          background: section === "coach" ? COLORS.fairway : "transparent",
          color: section === "coach" ? COLORS.cream : COLORS.sand,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 16,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        ★ COACH SUMMARY — ONE-PAGE OVERVIEW
      </button>

      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {ANALYSIS_SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => onSectionChange(s.key)}
            style={{
              flex: 1,
              padding: "10px 4px",
              borderRadius: 8,
              border: section === s.key ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: section === s.key ? COLORS.fairway : "transparent",
              color: section === s.key ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "coach" && (
        <CoachSummaryScreen
          profileName={profileName}
          profileHandicap={profileHandicap}
          baselineHandicap={baselineHandicap}
          rangeHistory={rangeHistory}
          teeHistory={teeHistory}
          shortGameHistory={shortGameHistory}
          puttingHistory={puttingHistory}
          units={units}
        />
      )}

      {section === "range" && (
        <RangeAnalysisHub
          history={rangeHistory}
          loaded={rangeLoaded}
          onDeleteSession={onDeleteRangeSession}
          onEditSessionShot={onEditRangeSessionShot}
          units={units}
        />
      )}

      {section === "putting" && (
        <PuttingAnalysisHub
          history={puttingHistory}
          loaded={puttingLoaded}
          onDeleteSession={onDeletePuttingSession}
          onEditSessionShot={onEditPuttingSessionShot}
          clockHistory={clockHistory}
          clockLoaded={clockLoaded}
          onDeleteClockSession={onDeleteClockSession}
          onEditClockSessionShot={onEditClockSessionShot}
          startLineHistory={startLineHistory}
          startLineLoaded={startLineLoaded}
          onDeleteStartLineSession={onDeleteStartLineSession}
          onEditStartLineSession={onEditStartLineSession}
          paceHistory={paceHistory}
          paceLoaded={paceLoaded}
          onDeletePaceSession={onDeletePaceSession}
          onEditPacePutt={onEditPacePutt}
          units={units}
        />
      )}

      {section === "shortgame" && (
        <ShortGameAnalysisBody
          history={shortGameHistory}
          loaded={shortGameLoaded}
          onDeleteSession={onDeleteShortGameSession}
          onEditSessionShot={onEditShortGameSessionShot}
          units={units}
        />
      )}

      {section === "teeaccuracy" && (
        <TeeAccuracyAnalysisBody
          history={teeHistory}
          loaded={teeLoaded}
          onDeleteSession={onDeleteTeeSession}
          onEditSessionShot={onEditTeeSessionShot}
          units={units}
        />
      )}

      <button
        onClick={onBack}
        style={{
          width: "100%",
          marginTop: 18,
          padding: "14px 0",
          borderRadius: 12,
          border: `1px solid ${COLORS.creamDim}33`,
          background: "transparent",
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        BACK
      </button>
    </div>
  );
}

function shortGameSessionTrendData(sessions) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => ({
      date: s.date,
      dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      avgSG: avg(s.shots.map((sh) => sgForShortGameShot(sh.lie, sh.target, sh.resultFt))),
      avgResultFt: avg(s.shots.map((sh) => sh.resultFt)),
      shotCount: s.shots.length,
    }));
}

function computeShortGameAnalysis(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.shots.forEach((sh) => {
        rows.push({
          date: s.date,
          lie: sh.lie,
          target: sh.target,
          resultFt: sh.resultFt,
          sg: sgForShortGameShot(sh.lie, sh.target, sh.resultFt),
        });
      });
    });
  if (rows.length === 0) return null;

  const overallAvgSG = avg(rows.map((r) => r.sg));
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  const trendDelta =
    firstHalf.length && secondHalf.length ? avg(secondHalf.map((r) => r.sg)) - avg(firstHalf.map((r) => r.sg)) : 0;

  const byLie = {};
  rows.forEach((r) => {
    if (!byLie[r.lie]) byLie[r.lie] = [];
    byLie[r.lie].push(r);
  });

  const buckets = Object.entries(byLie).map(([lie, lieRows]) => {
    const bMid = Math.floor(lieRows.length / 2);
    const bFirst = lieRows.slice(0, bMid);
    const bSecond = lieRows.slice(bMid);
    const improvement =
      bFirst.length >= 2 && bSecond.length >= 2 ? avg(bSecond.map((r) => r.sg)) - avg(bFirst.map((r) => r.sg)) : null;
    return {
      lie,
      count: lieRows.length,
      avgSG: avg(lieRows.map((r) => r.sg)),
      avgFt: avg(lieRows.map((r) => r.resultFt)),
      improvement,
    };
  });

  const withEnoughData = buckets.filter((b) => b.count >= 3);
  const strengths = [...withEnoughData].sort((a, b) => b.avgSG - a.avgSG).slice(0, 2);
  const weaknesses = [...withEnoughData].sort((a, b) => a.avgSG - b.avgSG).slice(0, 2);

  const withImprovement = buckets.filter((b) => b.improvement !== null);
  const mostImproved = [...withImprovement].sort((a, b) => b.improvement - a.improvement).filter((b) => b.improvement > 0.05).slice(0, 2);
  const regressing = [...withImprovement].sort((a, b) => a.improvement - b.improvement).filter((b) => b.improvement < -0.05).slice(0, 2);

  return {
    shotCount: rows.length,
    overallAvgSG,
    trendDelta,
    buckets,
    strengths,
    weaknesses,
    mostImproved,
    regressing,
  };
}

function ShortGameBucketRow({ bucket }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.cream }}>{LIE_LABELS[bucket.lie]}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          {bucket.count} shots · avg {bucket.avgFt.toFixed(1)}ft
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: sgRagColor(bucket.avgSG) }}>
          {formatSG(bucket.avgSG)}
        </div>
        {bucket.improvement !== null && bucket.improvement !== undefined && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: bucket.improvement > 0 ? COLORS.fairwayLight : COLORS.flag,
            }}
          >
            {bucket.improvement > 0 ? "▲" : "▼"} {Math.abs(bucket.improvement).toFixed(2)} SG
          </div>
        )}
      </div>
    </div>
  );
}

function ShortGameInsightCard({ title, subtitle, items, emptyText }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, padding: "6px 0" }}>
            {emptyText}
          </div>
        ) : (
          items.map((b, i) => (
            <div key={b.lie} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <ShortGameBucketRow bucket={b} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// Contextualizes a raw yardage number against real-world fairway widths, so the slider means
// something rather than just being an abstract number. Tour fairways average roughly 28-32yd;
// major championship setups get narrowed well below that; recreational courses run wider.
function fairwayWidthDescriptor(yds) {
  if (yds < 20) return { label: "MAJOR CHAMPIONSHIP TIGHT", color: COLORS.flag };
  if (yds < 26) return { label: "TOUR TIGHT", color: COLORS.flag };
  if (yds < 32) return { label: "PGA TOUR AVERAGE", color: COLORS.sand };
  if (yds < 38) return { label: "AVERAGE CLUB COURSE", color: COLORS.sand };
  if (yds < 45) return { label: "GENEROUS", color: COLORS.fairwayLight };
  return { label: "VERY WIDE / FORGIVING", color: COLORS.fairwayLight };
}

function computeTeeAccuracyAnalysis(sessions) {
  const rows = [];
  [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => {
      s.shots.forEach((sh) => {
        rows.push({ date: s.date, club: sh.club, hit: sh.hit });
      });
    });
  if (rows.length === 0) return null;

  const overallHitPct = (rows.filter((r) => r.hit).length / rows.length) * 100;
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  const trendDelta =
    firstHalf.length && secondHalf.length
      ? (secondHalf.filter((r) => r.hit).length / secondHalf.length) * 100 - (firstHalf.filter((r) => r.hit).length / firstHalf.length) * 100
      : 0;

  const byClub = {};
  rows.forEach((r) => {
    if (!byClub[r.club]) byClub[r.club] = [];
    byClub[r.club].push(r);
  });
  const buckets = Object.entries(byClub).map(([club, clubRows]) => ({
    club,
    count: clubRows.length,
    hitPct: (clubRows.filter((r) => r.hit).length / clubRows.length) * 100,
  }));

  return { shotCount: rows.length, overallHitPct, trendDelta, buckets };
}

function teeAccuracySessionTrendData(sessions) {
  return [...sessions]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => ({
      date: s.date,
      dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      hitPct: s.hitPct,
      shotCount: s.shotCount,
    }));
}

function TeeAccuracyAnalysisBody({ history, loaded, onDeleteSession, onEditSessionShot, units }) {
  const [tab, setTab] = useState("insights"); // insights | graphs
  const [printMode, triggerPrint] = usePrintMode();
  const [timescale, setTimescale] = useState("all");
  const [viewingSessionId, setViewingSessionId] = useState(null);
  const viewingSession = viewingSessionId ? history.find((s) => s.id === viewingSessionId) : null;

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);

  if (filtered.length === 0) {
    return (
      <div>
        <TimescalePicker value={timescale} onChange={setTimescale} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No Tee Accuracy sessions in this window yet. Log a session to see your analysis here.
        </div>
      </div>
    );
  }

  const analysis = computeTeeAccuracyAnalysis(filtered);
  const trend = teeAccuracySessionTrendData(filtered);

  return (
    <div>
      <PrintHeader title="Tee Accuracy Analysis" timescale={timescale} />
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => setTab("insights")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "insights" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "insights" ? COLORS.fairway : "transparent",
            color: tab === "insights" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          INSIGHTS
        </button>
        <button
          onClick={() => setTab("graphs")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "graphs" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "graphs" ? COLORS.fairway : "transparent",
            color: tab === "graphs" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          GRAPHS
        </button>
      </div>

      <TimescalePicker value={timescale} onChange={setTimescale} />

      {(tab === "insights" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={filtered.length} />
              <StatBox label="SHOTS" value={analysis.shotCount} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox
                label="FAIRWAYS HIT"
                value={`${analysis.overallHitPct.toFixed(0)}%`}
                valueColor={ratingRagColor(analysis.overallHitPct / 20)}
              />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 1 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — hit rate up {analysis.trendDelta.toFixed(0)}pt from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — hit rate down {Math.abs(analysis.trendDelta).toFixed(0)}pt from start to end of period
                </span>
              )}
            </div>
          </Card>

          {analysis.buckets.length > 0 && (
            <Card style={{ marginBottom: 14 }}>
              <SectionLabel>By club</SectionLabel>
              {analysis.buckets.map((c, i) => (
                <div key={c.club} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                    <div>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.cream }}>
                        {CLUB_LABELS[c.club]}
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
                        {c.count} shots
                      </div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: ratingRagColor(c.hitPct / 20) }}>
                      {c.hitPct.toFixed(0)}%
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.map((s) => (
              <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                <Card style={{ marginBottom: 12, cursor: "pointer" }} onClick={() => setViewingSessionId(s.id)}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                    {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {"  ·  "}
                    {s.shotCount} shots · {s.clubs.map((c) => CLUB_LABELS[c]).join(", ")}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <StatBox label="FAIRWAYS HIT" value={`${s.hitPct.toFixed(0)}%`} valueColor={ratingRagColor(s.hitPct / 20)} />
                    <StatBox label="HIT / TOTAL" value={`${s.hitCount}/${s.shotCount}`} />
                  </div>
                </Card>
              </SwipeToDelete>
            ))}
          </CollapsibleSection>

          {viewingSession && (
            <TeeSessionDetailModal
              session={viewingSession}
              units={units}
              onEditShot={(shotIndex, updatedShot) => onEditSessionShot(viewingSession.id, shotIndex, updatedShot)}
              onClose={() => setViewingSessionId(null)}
            />
          )}
        </>
      )}

      {(tab === "graphs" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Fairways hit over time</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
              Hit % per session
            </div>
            <div style={{ height: 200, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                    unit="%"
                  />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Line
                    type="monotone"
                    dataKey="hitPct"
                    stroke={COLORS.flag}
                    strokeWidth={2}
                    dot={{ fill: COLORS.flag, r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {analysis.buckets.length > 0 && (
            <Card>
              <SectionLabel>Fairways hit by club</SectionLabel>
              <div style={{ height: 180, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={analysis.buckets.map((c) => ({ label: CLUB_LABELS[c.club], hitPct: c.hitPct }))}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: COLORS.creamDim, fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: `${COLORS.creamDim}33` }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: `${COLORS.creamDim}33` }}
                      tickLine={false}
                      unit="%"
                    />
                    <Tooltip content={<ChartTooltip suffix="%" />} />
                    <Bar dataKey="hitPct" radius={[4, 4, 0, 0]}>
                      {analysis.buckets.map((c, i) => (
                        <Cell key={i} fill={ratingRagColor(c.hitPct / 20)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function ShortGameAnalysisBody({ history, loaded, onDeleteSession, onEditSessionShot, units }) {
  const [tab, setTab] = useState("insights"); // insights | graphs
  const [printMode, triggerPrint] = usePrintMode();
  const [timescale, setTimescale] = useState("all");
  const [viewingSessionId, setViewingSessionId] = useState(null);
  const viewingSession = viewingSessionId ? history.find((s) => s.id === viewingSessionId) : null;

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);

  if (filtered.length === 0) {
    return (
      <div>
        <TimescalePicker value={timescale} onChange={setTimescale} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No short game sessions in this window yet. Log a session to see your analysis here.
        </div>
      </div>
    );
  }

  const trend = shortGameSessionTrendData(filtered);
  const allShots = filtered.flatMap((s) => s.shots);
  const overallAvgFt = avg(allShots.map((sh) => sh.resultFt));
  const analysis = computeShortGameAnalysis(filtered);
  const lieStats = analysis ? analysis.buckets : [];

  return (
    <div>
      <PrintHeader title="Short Game Analysis" timescale={timescale} />
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => setTab("insights")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "insights" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "insights" ? COLORS.fairway : "transparent",
            color: tab === "insights" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          INSIGHTS
        </button>
        <button
          onClick={() => setTab("graphs")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "graphs" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "graphs" ? COLORS.fairway : "transparent",
            color: tab === "graphs" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          GRAPHS
        </button>
      </div>

      <TimescalePicker value={timescale} onChange={setTimescale} />

      {(tab === "insights" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              vs PGA Tour baseline · on-green finish assumed
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={filtered.length} />
              <StatBox label="SHOTS" value={allShots.length} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="AVG SG / SHOT" value={formatSG(analysis.overallAvgSG)} valueColor={sgRagColor(analysis.overallAvgSG)} />
              <StatBox label="AVG FT FROM HOLE" value={`${overallAvgFt.toFixed(1)}ft`} />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 0.03 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — SG up {analysis.trendDelta.toFixed(2)} from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — SG down {Math.abs(analysis.trendDelta).toFixed(2)} from start to end of period
                </span>
              )}
            </div>
          </Card>

          <ShortGameInsightCard
            title="Strengths"
            subtitle="Lies where you gain the most strokes on the PGA Tour baseline"
            items={analysis.strengths}
            emptyText="Not enough shots from any single lie yet."
          />

          <ShortGameInsightCard
            title="Focus areas"
            subtitle="Lies where you lose the most strokes to the PGA Tour baseline"
            items={analysis.weaknesses}
            emptyText="Not enough shots from any single lie yet."
          />

          <ShortGameInsightCard
            title="Biggest improvements"
            subtitle="Lies where strokes gained has risen most from earlier to later sessions"
            items={analysis.mostImproved}
            emptyText="Not enough repeat shots from a single lie to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <ShortGameInsightCard
              title="Slipping"
              subtitle="Lies where strokes gained has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}

          {lieStats.length > 0 && (
            <Card style={{ marginBottom: 14 }}>
              <SectionLabel>By lie</SectionLabel>
              {lieStats.map((l, i) => (
                <div key={l.lie} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                    <div>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.cream }}>
                        {LIE_LABELS[l.lie]}
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
                        {l.count} shots · avg {l.avgFt.toFixed(1)}ft
                      </div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: sgRagColor(l.avgSG) }}>
                      {formatSG(l.avgSG)}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.map((s) => {
              const sessionAvgSG = avg(s.shots.map((sh) => sgForShortGameShot(sh.lie, sh.target, sh.resultFt)));
              return (
                <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                  <Card style={{ marginBottom: 12, cursor: "pointer" }} onClick={() => setViewingSessionId(s.id)}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                      {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      {"  ·  "}
                      {s.shotCount} shots · {s.minYds}-{s.maxYds}y · {s.lies.map((l) => LIE_LABELS[l]).join("/")}
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <StatBox label="AVG SG / SHOT" value={formatSG(sessionAvgSG)} valueColor={sgRagColor(sessionAvgSG)} />
                      <StatBox label="AVG FT" value={`${s.avgResultFt.toFixed(1)}ft`} />
                    </div>
                  </Card>
                </SwipeToDelete>
              );
            })}
          </CollapsibleSection>

          {viewingSession && (
            <ShortGameSessionDetailModal
              session={viewingSession}
              units={units}
              onEditShot={(shotIndex, updatedShot) => onEditSessionShot(viewingSession.id, shotIndex, updatedShot)}
              onClose={() => setViewingSessionId(null)}
            />
          )}
        </>
      )}

      {(tab === "graphs" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Strokes gained over time</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
              Average SG per shot per session
            </div>
            <div style={{ height: 200, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                  <Tooltip content={<ChartTooltip suffix=" SG" />} />
                  <Line
                    type="monotone"
                    dataKey="avgSG"
                    stroke={COLORS.flag}
                    strokeWidth={2}
                    dot={{ fill: COLORS.flag, r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {lieStats.length > 0 && (
            <Card>
              <SectionLabel>Strokes gained by lie</SectionLabel>
              <div style={{ height: 180, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={lieStats.map((l) => ({ label: LIE_LABELS[l.lie], avgSG: l.avgSG }))}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: `${COLORS.creamDim}33` }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: `${COLORS.creamDim}33` }}
                      tickLine={false}
                    />
                    <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                    <Tooltip content={<ChartTooltip suffix=" SG" />} />
                    <Bar dataKey="avgSG" radius={[4, 4, 0, 0]}>
                      {lieStats.map((l, i) => (
                        <Cell key={i} fill={sgRagColor(l.avgSG)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function RangeAnalysisHub({ history, loaded, onDeleteSession, onEditSessionShot, units }) {
  const [subTab, setSubTab] = useState("distance"); // distance | rating

  const distanceHistory = history.filter((s) => s.mode !== "rating");
  const ratingHistory = history.filter((s) => s.mode === "rating");

  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setSubTab("distance")}
          style={{
            flex: 1,
            padding: "9px 4px",
            borderRadius: 8,
            border: subTab === "distance" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: subTab === "distance" ? COLORS.fairway : "transparent",
            color: subTab === "distance" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          DISTANCE
        </button>
        <button
          onClick={() => setSubTab("rating")}
          style={{
            flex: 1,
            padding: "9px 4px",
            borderRadius: 8,
            border: subTab === "rating" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: subTab === "rating" ? COLORS.fairway : "transparent",
            color: subTab === "rating" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          SELF-RATED
        </button>
      </div>

      {subTab === "distance" && (
        <RangeAnalysisBody
          history={distanceHistory}
          loaded={loaded}
          onDeleteSession={onDeleteSession}
          onEditSessionShot={onEditSessionShot}
          units={units}
        />
      )}
      {subTab === "rating" && (
        <RangeRatingAnalysisBody
          history={ratingHistory}
          loaded={loaded}
          onDeleteSession={onDeleteSession}
          onEditSessionShot={onEditSessionShot}
          units={units}
        />
      )}
    </div>
  );
}

function RangeRatingAnalysisBody({ history, loaded, onDeleteSession, onEditSessionShot, units }) {
  const [timescale, setTimescale] = useState("all");
  const [printMode, triggerPrint] = usePrintMode();
  const [viewingSessionId, setViewingSessionId] = useState(null);
  const viewingSession = viewingSessionId ? history.find((s) => s.id === viewingSessionId) : null;

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);
  const analysis = computeRangeRatingAnalysis(filtered);
  const trend = ratingSessionTrendData(filtered);

  return (
    <div>
      <PrintHeader title="Range Analysis — Self-Rated" timescale={timescale} />
      <TimescalePicker value={timescale} onChange={setTimescale} />

      {!analysis && (
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No self-rated sessions in this window yet. Switch to rating mode in Settings and log a
          session to see your analysis here.
        </div>
      )}

      {analysis && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              Self-rated shots — no distance measurement, so no strokes gained or miss stats
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={analysis.sessionCount} />
              <StatBox label="SHOTS" value={analysis.shotCount} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox
                label="AVG RATING"
                value={`${analysis.overallAvgRating.toFixed(1)}/5`}
                valueColor={ratingRagColor(analysis.overallAvgRating)}
              />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 0.1 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — rating up {analysis.trendDelta.toFixed(1)} from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — rating down {Math.abs(analysis.trendDelta).toFixed(1)} from start to end of period
                </span>
              )}
            </div>
          </Card>

          <RatingInsightCard
            title="Strengths"
            subtitle="Distance bands with your highest average self-rating"
            items={analysis.strengths}
            emptyText="Not enough shots in any single band yet."
          />

          <RatingInsightCard
            title="Focus areas"
            subtitle="Distance bands with your lowest average self-rating"
            items={analysis.weaknesses}
            emptyText="Not enough shots in any single band yet."
          />

          <RatingInsightCard
            title="Biggest improvements"
            subtitle="Bands where your rating has risen most from earlier to later sessions"
            items={analysis.mostImproved}
            emptyText="Not enough repeat shots in a single band to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <RatingInsightCard
              title="Slipping"
              subtitle="Bands where your rating has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}

          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Rating over time</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
              Average self-rating per session
            </div>
            <div style={{ height: 200, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[1, 5]}
                    tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: `${COLORS.creamDim}33` }}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip suffix="/5" />} />
                  <Line
                    type="monotone"
                    dataKey="avgRating"
                    stroke={COLORS.flag}
                    strokeWidth={2}
                    dot={{ fill: COLORS.flag, r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.map((s) => {
              const sessionAvgRating = avg(s.shots.map((sh) => sh.rating));
              return (
                <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                  <Card style={{ marginBottom: 12, cursor: "pointer" }} onClick={() => setViewingSessionId(s.id)}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                      {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      {"  ·  "}
                      {s.shotCount} shots · {s.minDist}-{s.maxDist}y
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <StatBox
                        label="AVG RATING"
                        value={`${sessionAvgRating.toFixed(1)}/5`}
                        valueColor={ratingRagColor(sessionAvgRating)}
                      />
                    </div>
                  </Card>
                </SwipeToDelete>
              );
            })}
          </CollapsibleSection>

          {viewingSession && (
            <RangeSessionDetailModal
              session={viewingSession}
              units={units}
              onEditShot={(shotIndex, updatedShot) => onEditSessionShot(viewingSession.id, shotIndex, updatedShot)}
              onClose={() => setViewingSessionId(null)}
            />
          )}

          <SendReportButton onClick={triggerPrint} />
        </>
      )}
    </div>
  );
}

function RangeAnalysisBody({ history, loaded, onDeleteSession, onEditSessionShot, units }) {
  const [tab, setTab] = useState("insights"); // insights | graphs
  const [printMode, triggerPrint] = usePrintMode();
  const [timescale, setTimescale] = useState("all");
  const [minYds, setMinYds] = useState(0);
  const [maxYds, setMaxYds] = useState(300);
  const [activePreset, setActivePreset] = useState("All");
  const [viewingSessionId, setViewingSessionId] = useState(null);
  const viewingSession = viewingSessionId ? history.find((s) => s.id === viewingSessionId) : null;

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);
  const analysis = computeAnalysis(filtered);
  const trend = sessionTrendData(filtered, minYds, maxYds);
  const graphBuckets = bucketChartData(filtered, minYds, maxYds);
  const hasGraphData = trend.length > 0;

  function handlePreset(p) {
    setActivePreset(p.label);
    setMinYds(p.min);
    setMaxYds(p.max);
  }

  function handleManualChange(setter) {
    return (v) => {
      setActivePreset(null);
      setter(v);
    };
  }

  return (
    <div>
      <PrintHeader title="Range Analysis" timescale={timescale} />
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => setTab("insights")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "insights" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "insights" ? COLORS.fairway : "transparent",
            color: tab === "insights" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          INSIGHTS
        </button>
        <button
          onClick={() => setTab("graphs")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "graphs" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "graphs" ? COLORS.fairway : "transparent",
            color: tab === "graphs" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          GRAPHS
        </button>
      </div>

      <TimescalePicker value={timescale} onChange={setTimescale} />

      {!analysis && (
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No sessions in this window yet. Log a session to see your analysis here.
        </div>
      )}

      {analysis && (tab === "insights" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              vs PGA Tour baseline · fairway lie, on-green finish assumed
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={analysis.sessionCount} />
              <StatBox label="SHOTS" value={analysis.shotCount} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="AVG SG / SHOT" value={formatSG(analysis.overallAvgSG)} valueColor={sgRagColor(analysis.overallAvgSG)} />
              <StatBox label="AVG MISS" value={`${analysis.overallAvgMissYds.toFixed(1)}y`} />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 0.03 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — SG up {analysis.trendDelta.toFixed(2)} from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — SG down {Math.abs(analysis.trendDelta).toFixed(2)} from start to end of period
                </span>
              )}
            </div>
          </Card>

          <InsightCard
            title="Strengths"
            subtitle="Distance bands where you gain the most strokes on the PGA Tour baseline"
            items={analysis.strengths}
            emptyText="Not enough shots in any single band yet."
          />

          <InsightCard
            title="Focus areas"
            subtitle="Distance bands where you lose the most strokes to the PGA Tour baseline"
            items={analysis.weaknesses}
            emptyText="Not enough shots in any single band yet."
          />

          <InsightCard
            title="Biggest improvements"
            subtitle="Bands where strokes gained has risen most from earlier to later sessions"
            items={analysis.mostImproved}
            emptyText="Not enough repeat shots in a single band to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <InsightCard
              title="Slipping"
              subtitle="Bands where strokes gained has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}

          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Short vs long of the pin</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2, marginBottom: 10 }}>
              Each dot is one shot, colored by its own strokes gained
            </div>
            <ShotDispersionChart rows={flattenShots(filtered)} units={units} />
          </Card>

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.length === 0 ? (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim }}>
                No sessions in this window.
              </div>
            ) : (
              filtered.map((s) => {
                const sessionAvgSG = avg(s.shots.map((sh) => sgForApproachShot(sh.target, sh.actual)));
                return (
                  <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                    <Card style={{ marginBottom: 12, cursor: "pointer" }} onClick={() => setViewingSessionId(s.id)}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                        {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        {"  ·  "}
                        {s.shotCount} shots · {s.minDist}-{s.maxDist}y
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                        <StatBox label="AVG SG / SHOT" value={formatSG(sessionAvgSG)} valueColor={sgRagColor(sessionAvgSG)} />
                        <StatBox label="AVG MISS" value={`${s.avgDiff.toFixed(1)}y`} />
                      </div>
                    </Card>
                  </SwipeToDelete>
                );
              })
            )}
          </CollapsibleSection>
        </>
      )}

      {viewingSession && (
        <RangeSessionDetailModal
          session={viewingSession}
          units={units}
          onEditShot={(shotIndex, updatedShot) => onEditSessionShot(viewingSession.id, shotIndex, updatedShot)}
          onClose={() => setViewingSessionId(null)}
        />
      )}

      {analysis && (tab === "graphs" || printMode) && (
        <div>
          <YardagePicker
            min={minYds}
            max={maxYds}
            onMin={handleManualChange(setMinYds)}
            onMax={handleManualChange(setMaxYds)}
            onPreset={handlePreset}
            activePresetLabel={activePreset}
          />

          {!hasGraphData && (
            <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
              No shots match this timescale + yardage combination yet.
            </div>
          )}

          {hasGraphData && (
            <>
              <Card style={{ marginBottom: 14 }}>
                <SectionLabel>Strokes gained over time</SectionLabel>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
                  Average SG per shot per session, vs PGA Tour baseline, {minYds}-{maxYds}y shots only
                </div>
                <div style={{ height: 200, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                      <Tooltip content={<ChartTooltip suffix=" SG" />} />
                      <Line
                        type="monotone"
                        dataKey="avgSG"
                        stroke={COLORS.flag}
                        strokeWidth={2}
                        dot={{ fill: COLORS.flag, r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <SectionLabel>Strokes gained by distance band</SectionLabel>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
                  10y bands within {minYds}-{maxYds}y, this timescale
                </div>
                <div style={{ height: 250, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={graphBuckets} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
                      <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                      <XAxis
                        dataKey="label"
                        interval={0}
                        angle={-45}
                        textAnchor="end"
                        height={54}
                        tick={{ fill: COLORS.creamDim, fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                      <Tooltip content={<ChartTooltip suffix=" SG" />} />
                      <Bar dataKey="avgSG" radius={[4, 4, 0, 0]}>
                        {graphBuckets.map((b, i) => (
                          <Cell key={i} fill={sgRagColor(b.avgSG)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    marginTop: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: COLORS.creamDim,
                  }}
                >
                  <span>
                    <span style={{ color: COLORS.fairwayLight }}>●</span> ≥0 (tour avg or better)
                  </span>
                  <span>
                    <span style={{ color: COLORS.sand }}>●</span> ≥-0.15
                  </span>
                  <span>
                    <span style={{ color: COLORS.flag }}>●</span> &lt;-0.15
                  </span>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function Card({ children, style, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: `${COLORS.turf}cc`,
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 14,
        padding: "14px 16px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: COLORS.creamDim,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: 1.5,
      }}
    >
      {children}
    </div>
  );
}

// ===== Home page: section tiles with illustrated backgrounds =====
// These are original vector illustrations standing in for real photos.
// Swap each <svg> below for an <img src="..." /> once real photos are ready —
// wrap it in the same absolutely-positioned, inset:0, cover-fit container.

function RangeIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="rangeSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E4DBC2" />
          <stop offset="100%" stopColor="#4C8A68" />
        </linearGradient>
        <linearGradient id="rangeGround" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="400" height="120" fill="url(#rangeSky)" />
      <rect x="0" y="120" width="400" height="120" fill="url(#rangeGround)" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} x={i * 65 - 40} y="120" width="32" height="120" fill="#ffffff" opacity="0.025" transform="skewX(-10)" />
      ))}
      <line x1="330" y1="150" x2="330" y2="105" stroke="#F1EAD6" strokeWidth="2" opacity="0.7" />
      <polygon points="330,105 350,113 330,121" fill="#C1440E" opacity="0.85" />
      <rect x="194" y="88" width="7" height="95" fill="#F1EAD6" />
      <circle cx="197.5" cy="82" r="24" fill="#F1EAD6" stroke="#14291F" strokeWidth="2" />
      <text x="197.5" y="90" textAnchor="middle" fontFamily="'Bebas Neue', sans-serif" fontSize="22" fill="#14291F">
        100
      </text>
    </svg>
  );
}

function ShortGameIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="sgBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1D3A2B" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#sgBg)" />
      <ellipse cx="315" cy="65" rx="95" ry="42" fill="#4C8A68" opacity="0.55" />
      <ellipse cx="110" cy="195" rx="115" ry="38" fill="#C9A66B" opacity="0.85" />
      <path d="M150,163 Q225,55 315,78" stroke="#F1EAD6" strokeWidth="2" strokeDasharray="4 6" fill="none" opacity="0.6" />
      <polygon points="108,192 148,163 166,177 128,208" fill="#E4DBC2" opacity="0.9" />
      <circle cx="150" cy="163" r="6" fill="#F1EAD6" />
      <line x1="315" y1="78" x2="315" y2="38" stroke="#F1EAD6" strokeWidth="2" opacity="0.8" />
      <polygon points="315,38 332,44 315,50" fill="#C1440E" opacity="0.9" />
    </svg>
  );
}

function PuttingIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="puttBg" cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#4C8A68" />
          <stop offset="100%" stopColor="#1B4332" />
        </radialGradient>
      </defs>
      <rect width="400" height="240" fill="url(#puttBg)" />
      <ellipse cx="210" cy="150" rx="150" ry="55" fill="none" stroke="#F1EAD6" strokeOpacity="0.08" strokeWidth="2" />
      <ellipse cx="210" cy="150" rx="100" ry="36" fill="none" stroke="#F1EAD6" strokeOpacity="0.1" strokeWidth="2" />
      <path d="M150,150 Q188,118 218,146" stroke="#F1EAD6" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="3 5" fill="none" />
      <ellipse cx="222" cy="151" rx="15" ry="7" fill="#0A160F" />
      <circle cx="150" cy="150" r="9" fill="#F1EAD6" />
      <line x1="255" y1="188" x2="305" y2="152" stroke="#F1EAD6" strokeWidth="3" opacity="0.85" />
      <polygon points="305,152 322,158 305,164" fill="#C1440E" opacity="0.9" />
    </svg>
  );
}

// "Random Practice" tile — a scatter of random numbers (representing random putt distances)
// across a green backdrop, per the user's explicit description: "lots of random numbers".
function PuttingRandomIllustration() {
  const nums = [
    { n: 7, x: 40, y: 60, size: 30, o: 0.5 },
    { n: 3, x: 110, y: 40, size: 22, o: 0.35 },
    { n: 9, x: 180, y: 90, size: 44, o: 0.6 },
    { n: 4, x: 250, y: 45, size: 26, o: 0.4 },
    { n: 6, x: 320, y: 75, size: 36, o: 0.55 },
    { n: 10, x: 60, y: 150, size: 34, o: 0.45 },
    { n: 5, x: 150, y: 175, size: 24, o: 0.35 },
    { n: 8, x: 230, y: 145, size: 40, o: 0.5 },
    { n: 3, x: 300, y: 180, size: 22, o: 0.3 },
    { n: 7, x: 365, y: 120, size: 28, o: 0.4 },
    { n: 4, x: 20, y: 205, size: 20, o: 0.3 },
    { n: 9, x: 350, y: 30, size: 20, o: 0.3 },
  ];
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="puttRandBg" cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#4C8A68" />
          <stop offset="100%" stopColor="#14291F" />
        </radialGradient>
      </defs>
      <rect width="400" height="240" fill="url(#puttRandBg)" />
      {nums.map((d, i) => (
        <text
          key={i}
          x={d.x}
          y={d.y}
          fontFamily="'Bebas Neue', sans-serif"
          fontSize={d.size}
          fill="#F1EAD6"
          opacity={d.o}
          textAnchor="middle"
        >
          {d.n}
        </text>
      ))}
      <circle cx="200" cy="200" r="7" fill="#F1EAD6" opacity="0.9" />
    </svg>
  );
}

// "Around the Clock" tile — a literal clock face, per the user's explicit description:
// "as you'd expect".
function PuttingClockIllustration() {
  const cx = 200, cy = 120, r = 78;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 12 - Math.PI / 2;
    const x1 = cx + Math.cos(angle) * (r - 10);
    const y1 = cy + Math.sin(angle) * (r - 10);
    const x2 = cx + Math.cos(angle) * (r - 2);
    const y2 = cy + Math.sin(angle) * (r - 2);
    return { x1, y1, x2, y2 };
  });
  const hourAngle = -Math.PI / 2 + Math.PI / 3; // pointing toward ~4 o'clock
  const minuteAngle = -Math.PI / 2 + (Math.PI * 2 * 8) / 12; // pointing toward ~8 o'clock
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="puttClockBg" cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#4C8A68" />
          <stop offset="100%" stopColor="#14291F" />
        </radialGradient>
      </defs>
      <rect width="400" height="240" fill="url(#puttClockBg)" />
      <circle cx={cx} cy={cy} r={r} fill="#0A160F" opacity="0.35" stroke="#F1EAD6" strokeOpacity="0.7" strokeWidth="3" />
      {ticks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#F1EAD6" strokeOpacity="0.7" strokeWidth="2" />
      ))}
      <line
        x1={cx}
        y1={cy}
        x2={cx + Math.cos(hourAngle) * (r - 34)}
        y2={cy + Math.sin(hourAngle) * (r - 34)}
        stroke="#F1EAD6"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <line
        x1={cx}
        y1={cy}
        x2={cx + Math.cos(minuteAngle) * (r - 16)}
        y2={cy + Math.sin(minuteAngle) * (r - 16)}
        stroke="#F1EAD6"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="5" fill="#C1440E" />
    </svg>
  );
}

// "On Course" tile — a flag/scorecard motif implying the player is choosing/entering their own
// putts hole by hole, per the user's explicit description: "you choose".
function OnCourseIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="onCourseBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#onCourseBg)" />
      <ellipse cx="150" cy="205" rx="140" ry="24" fill="#0A160F" opacity="0.25" />
      <line x1="150" y1="205" x2="150" y2="55" stroke="#F1EAD6" strokeWidth="4" strokeLinecap="round" />
      <path d="M150,55 L235,80 L150,105 Z" fill="#C1440E" />
      <circle cx="150" cy="205" r="7" fill="#F1EAD6" />
      <g transform="translate(255,120)">
        <rect x="0" y="0" width="120" height="86" rx="8" fill="#F1EAD6" opacity="0.92" />
        <line x1="12" y1="20" x2="108" y2="20" stroke="#14291F" strokeWidth="3" opacity="0.5" />
        <line x1="12" y1="38" x2="90" y2="38" stroke="#14291F" strokeWidth="3" opacity="0.35" />
        <line x1="12" y1="56" x2="98" y2="56" stroke="#14291F" strokeWidth="3" opacity="0.35" />
        <path d="M12,72 L20,80 L36,64" fill="none" stroke="#C1440E" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

// "Start Line" tile — a ball rolling dead straight through two gate posts toward the hole,
// literally depicting the gate drill.
function PuttingStartLineIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="puttStartLineBg" cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#4C8A68" />
          <stop offset="100%" stopColor="#14291F" />
        </radialGradient>
      </defs>
      <rect width="400" height="240" fill="url(#puttStartLineBg)" />
      <line x1="70" y1="190" x2="330" y2="70" stroke="#F1EAD6" strokeOpacity="0.18" strokeWidth="2" strokeDasharray="3 6" />
      {/* Gate posts, roughly 15% of the line's length apart to read as a narrow gate */}
      <line x1="150" y1="152" x2="170" y2="135" stroke="#C1440E" strokeWidth="5" strokeLinecap="round" />
      <line x1="178" y1="146" x2="198" y2="129" stroke="#C1440E" strokeWidth="5" strokeLinecap="round" />
      <circle cx="300" cy="88" r="9" fill="#F1EAD6" />
      <circle cx="90" cy="182" r="9" fill="#F1EAD6" opacity="0.85" />
    </svg>
  );
}

// "Pace Control" tile — concentric rings around the hole, echoing the 1/2/3ft proximity radii
// the drill scores against.
function PuttingPaceIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="puttPaceBg" cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#4C8A68" />
          <stop offset="100%" stopColor="#14291F" />
        </radialGradient>
      </defs>
      <rect width="400" height="240" fill="url(#puttPaceBg)" />
      <circle cx="200" cy="130" r="92" fill="none" stroke="#F1EAD6" strokeOpacity="0.12" strokeWidth="2" />
      <circle cx="200" cy="130" r="60" fill="none" stroke="#F1EAD6" strokeOpacity="0.18" strokeWidth="2" />
      <circle cx="200" cy="130" r="30" fill="none" stroke="#F1EAD6" strokeOpacity="0.28" strokeWidth="2" />
      <circle cx="200" cy="130" r="8" fill="#0A160F" stroke="#F1EAD6" strokeWidth="1.5" />
      <text x="200" y="58" textAnchor="middle" fontFamily="'Bebas Neue', sans-serif" fontSize="16" fill="#F1EAD6" opacity="0.55">3</text>
      <text x="200" y="88" textAnchor="middle" fontFamily="'Bebas Neue', sans-serif" fontSize="16" fill="#F1EAD6" opacity="0.6">2</text>
      <text x="200" y="112" textAnchor="middle" fontFamily="'Bebas Neue', sans-serif" fontSize="16" fill="#F1EAD6" opacity="0.7">1</text>
      <circle cx="130" cy="70" r="7" fill="#F1EAD6" opacity="0.85" />
    </svg>
  );
}

function AnalysisIllustration() {
  const points = [
    [30, 190],
    [90, 150],
    [150, 165],
    [210, 110],
    [270, 130],
    [330, 70],
    [380, 50],
  ];
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <rect width="400" height="240" fill="#14291F" />
      {[40, 80, 120, 160, 200].map((y) => (
        <line key={y} x1="20" y1={y} x2="380" y2={y} stroke="#F1EAD6" strokeOpacity="0.06" strokeWidth="1" />
      ))}
      <path d={path} fill="none" stroke="#C1440E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill="#C1440E" />
      ))}
    </svg>
  );
}

function CompeteIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        {/* Same green gradient as WedgeMatrixIllustration/GappingIllustration, so every home
            tile reads as one consistent green family rather than Compete standing out as the
            one warm/brown tile. */}
        <linearGradient id="compBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#compBg)" />

      {/* 3-tier podium, 2nd/1st/3rd left to right */}
      <rect x="85" y="152" width="90" height="68" fill="#E4DBC2" opacity="0.22" />
      <rect x="180" y="108" width="90" height="112" fill="#E4DBC2" opacity="0.32" />
      <rect x="275" y="172" width="90" height="48" fill="#E4DBC2" opacity="0.18" />
      <text x="130" y="196" textAnchor="middle" fontFamily="'Bebas Neue', sans-serif" fontSize="34" fill="#F1EAD6" opacity="0.55">2</text>
      <text x="225" y="174" textAnchor="middle" fontFamily="'Bebas Neue', sans-serif" fontSize="42" fill="#F1EAD6" opacity="0.7">1</text>
      <text x="320" y="206" textAnchor="middle" fontFamily="'Bebas Neue', sans-serif" fontSize="28" fill="#F1EAD6" opacity="0.5">3</text>

      {/* trophy, standing on the 1st place block */}
      <g transform="translate(225 34)">
        <circle cx="0" cy="-8" r="5" fill="#C1440E" />
        <path d="M-20,0 L20,0 L15,32 Q0,44 -15,32 Z" fill="#C9A66B" />
        <path d="M-20,4 C-36,4 -36,28 -18,28" fill="none" stroke="#C9A66B" strokeWidth="4" strokeLinecap="round" />
        <path d="M20,4 C36,4 36,28 18,28" fill="none" stroke="#C9A66B" strokeWidth="4" strokeLinecap="round" />
        <rect x="-5" y="44" width="10" height="14" fill="#C9A66B" />
        <rect x="-22" y="58" width="44" height="8" rx="2" fill="#C9A66B" />
      </g>
    </svg>
  );
}

function TeeAccuracyIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="teeBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#teeBg)" />
      <polygon points="140,240 260,240 220,10 180,10" fill="#4C8A68" opacity="0.55" />
      <polygon points="170,240 230,240 210,60 190,60" fill="#1D3A2B" opacity="0.5" />
      <line x1="200" y1="230" x2="200" y2="30" stroke="#F1EAD6" strokeOpacity="0.3" strokeWidth="2" strokeDasharray="3 6" />
      <circle cx="200" cy="225" r="7" fill="#F1EAD6" />
      <circle cx="185" cy="90" r="5" fill="#C1440E" opacity="0.9" />
      <circle cx="222" cy="55" r="4" fill="#E4DBC2" opacity="0.7" />
      <circle cx="150" cy="150" r="4" fill="#E4DBC2" opacity="0.5" />
    </svg>
  );
}

function WedgeMatrixIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="wedgeBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#wedgeBg)" />
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={90 + col * 80}
            y={40 + row * 45}
            width={70}
            height={35}
            fill="none"
            stroke="#F1EAD6"
            strokeOpacity={0.25}
            strokeWidth={1.5}
          />
        ))
      )}
      <rect x={170} y={130} width={70} height={35} fill="#C1440E" opacity="0.85" />
      <rect x={90} y={85} width={70} height={35} fill="#4C8A68" opacity="0.55" />
      <rect x={250} y={175} width={70} height={35} fill="#4C8A68" opacity="0.4" />
    </svg>
  );
}

function YardagesIllustration() {
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="yardagesBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#yardagesBg)" />
      {/* notepad, tilted like something jotted down on the course */}
      <g transform="rotate(-6 200 125)">
        <rect x="128" y="38" width="150" height="182" rx="6" fill="#F1EAD6" />
        <rect x="128" y="38" width="150" height="182" rx="6" fill="none" stroke="#14291F" strokeOpacity="0.15" strokeWidth="2" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} cx={146 + i * 24} cy="38" r="5" fill="none" stroke="#C9A66B" strokeWidth="3" />
        ))}
        {[68, 88, 108, 128, 148, 168, 188].map((y) => (
          <line key={y} x1="143" y1={y} x2="263" y2={y} stroke="#14291F" strokeOpacity="0.12" strokeWidth="1.5" />
        ))}
        <text x="148" y="86" fontFamily="Georgia, serif" fontSize="15" fill="#1D3A2B" fontWeight="700">142</text>
        <text x="148" y="126" fontFamily="Georgia, serif" fontSize="15" fill="#1D3A2B" fontWeight="700">165</text>
        <text x="148" y="166" fontFamily="Georgia, serif" fontSize="15" fill="#1D3A2B" fontWeight="700">180</text>
        <line x1="228" y1="188" x2="228" y2="152" stroke="#C1440E" strokeWidth="2" />
        <polygon points="228,152 249,158 228,164" fill="#C1440E" />
      </g>
      {/* pencil resting across the page */}
      <g transform="rotate(38 300 70)">
        <rect x="283" y="38" width="10" height="92" rx="2" fill="#C9A66B" />
        <rect x="283" y="38" width="10" height="13" fill="#E4DBC2" />
        <polygon points="283,130 293,130 288,146" fill="#4C3A1D" />
      </g>
    </svg>
  );
}

function GappingIllustration() {
  const yards = [95, 110, 130, 150, 165, 175];
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        {/* Same green gradient as WedgeMatrixIllustration's wedgeBg — Gapping and Wedge Matrix
            are the two Yardages options, so they deliberately share a background color. */}
        <linearGradient id="gappingBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#gappingBg)" />
      {yards.map((y, i) => {
        const barWidth = 20 + (y / 175) * 200;
        const rowY = 30 + i * 30;
        return (
          <g key={i}>
            <rect x="30" y={rowY} width={barWidth} height="16" rx="3" fill="#F1EAD6" opacity={0.2 + i * 0.12} />
            <text x={44 + barWidth} y={rowY + 13} fontFamily="'JetBrains Mono', monospace" fontSize="11" fill="#F1EAD6" opacity="0.8">
              {y}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Checklist card with rows already filled in + checkmarks — deliberately distinct from
// GappingIllustration's bar chart and YardagesIllustration's blank notepad, since this option is
// about numbers you already know rather than a new test or a chart still to be filled in.
function ManualYardagesIllustration() {
  const rows = [
    { club: "DR", yard: 245 },
    { club: "7I", yard: 150 },
    { club: "PW", yard: 110 },
  ];
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        {/* Same green gradient family as Gapping/Wedge Matrix — all three Yardages options share it. */}
        <linearGradient id="manualYardagesBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#14291F" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill="url(#manualYardagesBg)" />
      <rect x="110" y="34" width="180" height="190" rx="10" fill="#F1EAD6" />
      <rect x="110" y="34" width="180" height="190" rx="10" fill="none" stroke="#14291F" strokeOpacity="0.15" strokeWidth="2" />
      {rows.map((r, i) => {
        const y = 66 + i * 52;
        return (
          <g key={i}>
            <text x="130" y={y} fontFamily="Georgia, serif" fontSize="17" fontWeight="700" fill="#1D3A2B">
              {r.club}
            </text>
            <text x="250" y={y} fontFamily="'JetBrains Mono', monospace" fontSize="15" fill="#1D3A2B" textAnchor="end">
              {r.yard}
            </text>
            <circle cx="270" cy={y - 5} r="9" fill="#4C8A68" />
            <path d={`M266 ${y - 5} l3 4 l6 -8`} stroke="#F1EAD6" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="130" y1={y + 14} x2="270" y2={y + 14} stroke="#14291F" strokeOpacity="0.1" strokeWidth="1.5" />
          </g>
        );
      })}
      {/* small pencil, distinct in angle/size from YardagesIllustration's so the two cards don't read as duplicates */}
      <g transform="rotate(20 330 60)">
        <rect x="322" y="30" width="8" height="60" rx="2" fill="#C9A66B" />
        <rect x="322" y="30" width="8" height="10" fill="#E4DBC2" />
        <polygon points="322,90 330,90 326,102" fill="#4C3A1D" />
      </g>
    </svg>
  );
}

// Order here is the home page's section order: Range, Yardages, Short Game, Putting, Compete, Analysis.
const TILE_META = [
  {
    key: "range",
    label: "THE RANGE",
    subtitle: "Distance control & tee accuracy",
    screen: "rangeChoose",
    available: true,
    Illustration: RangeIllustration,
  },
  {
    key: "yardages",
    label: "YARDAGES",
    subtitle: "Gapping & Wedge Matrix",
    screen: "yardagesChoose",
    available: true,
    Illustration: YardagesIllustration,
  },
  {
    key: "shortgame",
    label: "SHORT GAME",
    subtitle: "Chipping & pitching",
    screen: "shortgame",
    available: true,
    Illustration: ShortGameIllustration,
  },
  { key: "putting", label: "PUTTING", subtitle: "5 drills + on-course", screen: "puttingChoose", available: true, Illustration: PuttingIllustration },
  {
    key: "compete",
    label: "COMPETE",
    subtitle: "Head-to-head — Range, Putting, Short Game",
    screen: "competeChoose",
    available: true,
    Illustration: CompeteIllustration,
  },
  { key: "analysis", label: "ANALYSIS", subtitle: "Track your progress", screen: "analysis", available: true, Illustration: AnalysisIllustration },
];

const HOME_INFO = {
  range: {
    title: "THE RANGE",
    short: "Distance Control or Tee Accuracy — full swing practice with Strokes Gained.",
    body: "Two ways to work on your full swing: Distance Control gives you a random target yardage and tracks how close you land to it, feeding real Strokes Gained analysis. Tee Accuracy tests whether you find the fairway off the tee, by club, against a fairway width you set.",
  },
  yardages: {
    title: "YARDAGES",
    short: "Gapping and Wedge Matrix — know exactly how far each club goes.",
    body: "Everything about how far your clubs actually go lives here. Gapping builds a full-swing yardage chart from Driver down to 9 Iron (plus any custom clubs you add) — wedges are covered separately in Wedge Matrix, which also breaks each wedge down by swing length.",
  },
  shortgame: {
    title: "SHORT GAME",
    short: "Chip and pitch from random lies and distances, tracked by lie.",
    body: "Chip and pitch practice from a random lie (fairway, rough, or bunker) and distance within a window you choose. Log how many feet you finish from the hole, and see strokes gained broken down by lie so you know exactly which shot is costing you strokes.",
  },
  putting: {
    title: "PUTTING",
    short: "Practice random distances, or track a full round on the course.",
    body: "Practice mode gives you random distances and logs putts taken, with strokes gained per putt. On-Course mode walks you through an 18-hole round, hole by hole, so your real-round putting gets tracked the same way as practice.",
  },
  analysis: {
    title: "ANALYSIS",
    short: "Every session rolled up — strengths, trends, and full history.",
    body: "Every session you log across every section rolls up here — strengths, focus areas, trends over time, and full session history. Strokes gained is measured against whichever baseline (PGA Tour down to a 30 handicap) you've picked in Settings.",
  },
  compete: {
    title: "COMPETE",
    short: "2-4 players go head-to-head on Range, Putting, or Short Game.",
    body: "Head-to-head challenges for 2-4 players, taking turns each round on Range, Putting, or Short Game. Points scale with player count on Range/Short Game (closest wins the most); Putting tracks a simple tally of total putts, with strokes gained shown at the end.",
  },
};

function HomeInfoButton({ onClick, style, tooltipText }) {
  return (
    <div className="home-info-btn" style={{ position: "absolute", ...style }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: `1.5px solid ${COLORS.cream}`,
          background: `${COLORS.turfDark}e6`,
          color: COLORS.cream,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 700,
          fontSize: 15,
          lineHeight: 1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
        }}
      >
        i
      </button>
      {tooltipText && (
        <div
          className="home-info-tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 200,
            background: COLORS.turf,
            border: `1px solid ${COLORS.creamDim}44`,
            borderRadius: 8,
            padding: 10,
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            lineHeight: 1.5,
            color: COLORS.cream,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            zIndex: 10,
          }}
        >
          {tooltipText}
        </div>
      )}
    </div>
  );
}

function HomeInfoModal({ infoKey, onClose }) {
  if (!infoKey) return null;
  const info = HOME_INFO[infoKey];
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1, color: COLORS.cream }}>
          {info.title}
        </div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: COLORS.cream, marginTop: 10, lineHeight: 1.6 }}>
          {info.body}
        </div>
        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "11px 0",
            borderRadius: 10,
            border: "none",
            background: COLORS.fairway,
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 16,
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          GOT IT
        </button>
      </div>
    </div>
  );
}

// Lets someone correct a past Range/Short Game Compete round after the fact — same underlying
// data shape for both (distance-mode entries + ranked standings, or a flat closest-only winner),
// so one modal covers both modes.
function CompeteRoundEditModal({ round, players, mode, units, valueKind, onSave, onCancel }) {
  const isYds = valueKind === "yds";
  const unitLabel = isYds ? longUnitLabel(units) : shortUnitLabel(units);
  const valueKey = isYds ? "distance" : "resultFt";

  const [values, setValues] = useState(() => {
    const initial = {};
    players.forEach((p) => {
      const entry = (round.entries || []).find((e) => e.player === p);
      const raw = entry ? entry[valueKey] : null;
      initial[p] = raw !== null ? fmt1(isYds ? ydsToUnit(raw, units) : ftToUnit(raw, units)) : "";
    });
    return initial;
  });
  const [winner, setWinner] = useState(round.winner || null);

  function handleSave() {
    if (mode === "distance") {
      const entries = players.map((p) => ({
        player: p,
        [valueKey]: isYds ? unitToYds(parseFloat(values[p]) || 0, units) : unitToFt(parseFloat(values[p]) || 0, units),
      }));
      const standings = rankCompeteByProximity(entries, valueKey);
      onSave({ ...round, entries, standings });
    } else {
      const standings = players.map((p) => ({ player: p, points: p === winner ? 1 : 0, rank: p === winner ? 1 : null }));
      onSave({ ...round, winner, standings });
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT ROUND
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          Target {isYds ? ydsToUnitRound(round.target, units) : ftToUnitRound(round.target, units)}
          {unitLabel}
        </div>

        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "distance"
            ? players.map((p) => (
                <div key={p}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginBottom: 4 }}>
                    {p}
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={values[p]}
                    onChange={(e) => setValues({ ...values, [p]: e.target.value })}
                    style={{
                      width: "100%",
                      background: COLORS.turfDark,
                      border: `1px solid ${COLORS.creamDim}33`,
                      borderRadius: 8,
                      color: COLORS.cream,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 18,
                      padding: "8px 10px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ))
            : players.map((p) => (
                <button
                  key={p}
                  onClick={() => setWinner(p)}
                  style={{
                    padding: "10px 0",
                    borderRadius: 8,
                    border: winner === p ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                    background: winner === p ? COLORS.fairway : "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 16,
                    cursor: "pointer",
                  }}
                >
                  {p}
                </button>
              ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// Same idea for Putting Compete — just putts-taken per player instead of a distance/closest pick.
function PuttingCompeteHoleEditModal({ hole, players, units, onSave, onCancel }) {
  const [putts, setPutts] = useState(() => {
    const initial = {};
    players.forEach((p) => {
      const entry = hole.putts.find((e) => e.player === p);
      initial[p] = entry ? entry.strokes : 2;
    });
    return initial;
  });

  function handleSave() {
    const newPutts = players.map((p) => ({ player: p, strokes: putts[p] }));
    onSave({ ...hole, putts: newPutts });
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT HOLE
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          Distance {ftToUnitRound(hole.target, units)}
          {shortUnitLabel(units)}
        </div>

        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {players.map((p) => (
            <div key={p}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginBottom: 6 }}>
                {p}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPutts({ ...putts, [p]: n })}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      borderRadius: 8,
                      border: putts[p] === n ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                      background: putts[p] === n ? COLORS.fairway : "transparent",
                      color: COLORS.cream,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 16,
                      cursor: "pointer",
                    }}
                  >
                    {n === 4 ? "4+" : n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// Full detail view for a single on-course round, opened by tapping it in "All rounds" — same
// stat layout as the post-round Summary screen, plus the full hole-by-hole log.
function RoundSummaryModal({ session, units, onEditShot, onClose }) {
  const [editingShotIndex, setEditingShotIndex] = useState(null);
  const stats = courseRoundStats(session);
  const onePutts = session.putts.filter((p) => p.strokes <= 1).length;
  const onePuttPct = (onePutts / session.putts.length) * 100;
  const threePutts = session.putts.filter((p) => p.strokes >= 3).length;
  const avgStrokes = avg(session.putts.map((p) => p.strokes));

  function handleSave(updatedHole) {
    onEditShot(editingShotIndex, updatedHole);
    setEditingShotIndex(null);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 380,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          ROUND SUMMARY
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          {new Date(session.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} ·{" "}
          {session.putts.length} holes putted
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <StatBox label="TOTAL SG" value={formatSG(stats.totalSG)} valueColor={sgRagColor(stats.avgSG)} />
          <StatBox label="AVG SG / PUTT" value={formatSG(stats.avgSG)} valueColor={sgRagColor(stats.avgSG)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="AVG PUTTS" value={avgStrokes.toFixed(2)} />
          <StatBox label="TOTAL PUTTS" value={stats.totalPutts} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="1-PUTTS" value={`${onePutts} (${onePuttPct.toFixed(0)}%)`} valueColor={COLORS.fairwayLight} />
          <StatBox label="3+ PUTTS" value={threePutts} valueColor={threePutts > 0 ? COLORS.flag : COLORS.cream} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="FT MADE" value={`${fmt1(ftToUnit(stats.ftMade, units))}${shortUnitLabel(units)}`} valueColor={COLORS.sand} />
        </div>
        {session.chipIns > 0 && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
            + {session.chipIns} hole{session.chipIns === 1 ? "" : "s"} chipped in, no putt taken
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <SectionLabel>Hole by hole — tap a hole to amend</SectionLabel>
          <div style={{ marginTop: 6 }}>
            <PuttLog putts={session.putts} units={units} onEditShot={setEditingShotIndex} />
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>

      {editingShotIndex !== null && (
        <div onClick={(e) => e.stopPropagation()}>
          <PuttShotEditModal
            shot={session.putts[editingShotIndex]}
            units={units}
            onSave={handleSave}
            onCancel={() => setEditingShotIndex(null)}
          />
        </div>
      )}
    </div>
  );
}

// Lets someone correct a previous Range practice shot — covers both distance-mode (re-enter the
// actual carry, recompute miss/SG) and rating-mode (re-pick the 1-5 rating).
function ShotEditModal({ shot, mode, units, onSave, onCancel }) {
  const isRating = mode === "rating";
  const unitLabel = longUnitLabel(units);
  const [actualValue, setActualValue] = useState(() => (shot.actual !== undefined ? fmt1(ydsToUnit(shot.actual, units)) : ""));
  const [ratingValue, setRatingValue] = useState(shot.rating || null);

  function handleSave() {
    if (isRating) {
      onSave({ ...shot, rating: ratingValue });
    } else {
      const actual = unitToYds(parseFloat(actualValue) || 0, units);
      const diff = Math.abs(actual - shot.target);
      onSave({ ...shot, actual, diff });
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT SHOT
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          Target {ydsToUnitRound(shot.target, units)}
          {unitLabel}
        </div>

        <div style={{ marginTop: 14 }}>
          {isRating ? (
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRatingValue(n)}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 10,
                    border: ratingValue === n ? `2px solid ${ratingRagColor(n)}` : `1px solid ${COLORS.creamDim}33`,
                    background: ratingValue === n ? COLORS.fairway : "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 18,
                    cursor: "pointer",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <input
              type="number"
              inputMode="decimal"
              value={actualValue}
              onChange={(e) => setActualValue(e.target.value)}
              style={{
                width: "100%",
                background: COLORS.turfDark,
                border: `1px solid ${COLORS.creamDim}33`,
                borderRadius: 8,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 22,
                padding: "10px 12px",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// Historical-session detail + edit view for The Range (both distance and rating modes). Reuses
// ShotLog/RatingLog for display and the same ShotEditModal used for live-session editing, so a
// wrong shot from a *finished* session can be amended the same way as one still in progress.
function RangeSessionDetailModal({ session, units, onEditShot, onClose }) {
  const [editingShotIndex, setEditingShotIndex] = useState(null);
  const isRating = session.mode === "rating";
  const sessionAvg = isRating
    ? avg(session.shots.map((s) => s.rating))
    : avg(session.shots.map((s) => sgForApproachShot(s.target, s.actual)));

  function handleSave(updatedShot) {
    onEditShot(editingShotIndex, updatedShot);
    setEditingShotIndex(null);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 380,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          SESSION DETAIL
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          {new Date(session.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          {"  ·  "}
          {session.shotCount} shots · {session.minDist}-{session.maxDist}y
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {isRating ? (
            <StatBox label="AVG RATING" value={`${sessionAvg.toFixed(1)}/5`} valueColor={ratingRagColor(sessionAvg)} />
          ) : (
            <>
              <StatBox label="AVG SG / SHOT" value={formatSG(sessionAvg)} valueColor={sgRagColor(sessionAvg)} />
              <StatBox label="AVG MISS" value={`${session.avgDiff.toFixed(1)}y`} />
            </>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <SectionLabel>Shot by shot — tap a shot to amend</SectionLabel>
          <div style={{ marginTop: 6 }}>
            {isRating ? (
              <RatingLog shots={session.shots} units={units} onEditShot={setEditingShotIndex} />
            ) : (
              <ShotLog shots={session.shots} units={units} onEditShot={setEditingShotIndex} />
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>

      {editingShotIndex !== null && (
        <div onClick={(e) => e.stopPropagation()}>
          <ShotEditModal
            shot={session.shots[editingShotIndex]}
            mode={session.mode}
            units={units}
            onSave={handleSave}
            onCancel={() => setEditingShotIndex(null)}
          />
        </div>
      )}
    </div>
  );
}

function HomeScreen({ onNavigate }) {
  const [infoKey, setInfoKey] = useState(null);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, letterSpacing: 1.5 }}>
          WELCOME BACK
        </div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, marginTop: 2 }}>Pick a session</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {TILE_META.map((t) => (
          <div
            key={t.key}
            onClick={() => onNavigate(t.screen)}
            style={{
              position: "relative",
              height: 140,
              borderRadius: 14,
              overflow: "hidden",
              cursor: "pointer",
              border: `1px solid ${COLORS.creamDim}22`,
            }}
          >
            <t.Illustration />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(180deg, transparent 25%, ${COLORS.turfDark}dd 100%)`,
              }}
            />
            {!t.available && (
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: `${COLORS.turfDark}cc`,
                  border: `1px solid ${COLORS.creamDim}44`,
                  borderRadius: 5,
                  padding: "2px 6px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 8,
                  color: COLORS.creamDim,
                  letterSpacing: 0.5,
                }}
              >
                SOON
              </div>
            )}
            <HomeInfoButton
              onClick={() => setInfoKey(t.key)}
              style={{ top: 8, right: 8 }}
              tooltipText={HOME_INFO[t.key]?.short}
            />
            <div style={{ position: "absolute", left: 10, bottom: 8, right: 10 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 20,
                  letterSpacing: 0.5,
                  lineHeight: 1.05,
                  color: COLORS.cream,
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {t.label}
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  color: COLORS.creamDim,
                  marginTop: 2,
                  lineHeight: 1.35,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {t.subtitle}
              </div>
            </div>
          </div>
        ))}
      </div>

      <HomeInfoModal infoKey={infoKey} onClose={() => setInfoKey(null)} />
    </div>
  );
}


// ===== Tee Accuracy screens =====

function TeeAccuracySetupScreen({
  shotCount,
  setShotCount,
  fairwayWidth,
  setFairwayWidth,
  clubs,
  onToggleClub,
  onStart,
  units,
  history,
  loaded,
  onDeleteSession,
  onViewAnalysis,
}) {
  const unitLabel = longUnitLabel(units);
  const canStart = clubs.length > 0;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>TEE ACCURACY</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Fairways found off the tee
        </div>
      </div>

      <Card>
        <SectionLabel>Shots this session</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[10, 20, 30].map((n) => (
            <PillOption key={n} label={n} active={shotCount === n} onClick={() => setShotCount(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Fairway width</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          Defaults to a reasonable average fairway width — adjust for the course you're picturing.
        </div>

        <div style={{ textAlign: "center", marginTop: 14 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 40, lineHeight: 1, color: COLORS.flag }}>
            {ydsToUnitRound(fairwayWidth, units)}
            <span style={{ fontSize: 16, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              letterSpacing: 0.5,
              marginTop: 4,
              color: fairwayWidthDescriptor(fairwayWidth).color,
            }}
          >
            {fairwayWidthDescriptor(fairwayWidth).label}
          </div>
        </div>

        <input
          type="range"
          min={15}
          max={50}
          step={1}
          value={fairwayWidth}
          onChange={(e) => setFairwayWidth(parseInt(e.target.value, 10))}
          style={{
            width: "100%",
            marginTop: 14,
            accentColor: COLORS.flag,
            cursor: "pointer",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim }}>
            TIGHT ({ydsToUnitRound(15, units)}
            {unitLabel})
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim }}>
            WIDE ({ydsToUnitRound(50, units)}
            {unitLabel})
          </span>
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Clubs to test</SectionLabel>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <ClubToggle club="driver" active={clubs.includes("driver")} onClick={() => onToggleClub("driver")} />
          <ClubToggle club="fairway" active={clubs.includes("fairway")} onClick={() => onToggleClub("fairway")} />
          <ClubToggle club="hybrid" active={clubs.includes("hybrid")} onClick={() => onToggleClub("hybrid")} />
          <ClubToggle club="iron" active={clubs.includes("iron")} onClick={() => onToggleClub("iron")} />
        </div>
        {clubs.length === 0 && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Select at least one club.
          </div>
        )}
      </Card>

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START SESSION
      </button>

      <div
        onClick={onViewAnalysis}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        View tee accuracy analysis
      </div>

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past sessions" count={history.length}>
          {history.map((s) => (
            <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
              <Card style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                  {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {"  ·  "}
                  {s.shotCount} shots · {s.clubs.map((c) => CLUB_LABELS[c]).join(", ")}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <StatBox label="FAIRWAYS HIT" value={`${s.hitPct.toFixed(0)}%`} valueColor={ratingRagColor(s.hitPct / 20)} />
                  <StatBox label="HIT / TOTAL" value={`${s.hitCount}/${s.shotCount}`} />
                </div>
              </Card>
            </SwipeToDelete>
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}

function TeeAccuracyPracticeScreen({
  shots,
  shotCount,
  currentClub,
  fairwayWidth,
  onSubmit,
  onExit,
  units,
  editingShotIndex,
  onStartEditShot,
  onSaveEditShot,
  onCancelEditShot,
}) {
  const shotNum = shots.length + 1;
  const unitLabel = longUnitLabel(units);
  const hitSoFar = shots.filter((s) => s.hit).length;
  const hitPctSoFar = shots.length ? (hitSoFar / shots.length) * 100 : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          SHOT {shotNum} OF {shotCount}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            CLUB
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 44, lineHeight: 1, color: COLORS.flag, marginTop: 2 }}>
            {CLUB_LABELS[currentClub]}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 6 }}>
            Aiming at a {ydsToUnitRound(fairwayWidth, units)}
            {unitLabel} wide fairway
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, textAlign: "center" }}>
            DID YOU FIND THE FAIRWAY?
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onSubmit(true)}
              style={{
                flex: 1,
                padding: "18px 0",
                borderRadius: 12,
                border: "none",
                background: COLORS.fairway,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 22,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              HIT
            </button>
            <button
              onClick={() => onSubmit(false)}
              style={{
                flex: 1,
                padding: "18px 0",
                borderRadius: 12,
                border: `2px solid ${COLORS.flag}`,
                background: "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 22,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              MISS
            </button>
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <StatBox
          label="FAIRWAYS HIT"
          value={hitPctSoFar !== null ? `${hitPctSoFar.toFixed(0)}%` : "—"}
          valueColor={hitPctSoFar !== null ? ratingRagColor(hitPctSoFar / 20) : COLORS.cream}
        />
        <StatBox label="HIT / SO FAR" value={`${hitSoFar}/${shots.length}`} />
      </div>

      {shots.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>This session — tap a shot to amend</SectionLabel>
          <div style={{ marginTop: 4 }}>
            <TeeShotLog shots={shots} units={units} onEditShot={onStartEditShot} />
          </div>
        </div>
      )}

      {editingShotIndex !== null && (
        <TeeShotEditModal shot={shots[editingShotIndex]} onSave={onSaveEditShot} onCancel={onCancelEditShot} />
      )}
    </div>
  );
}

function TeeShotLog({ shots, units, onEditShot }) {
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ width: 24 }}>#</div>
        <div style={{ flex: 1 }}>CLUB</div>
        <div style={{ width: 60, textAlign: "right" }}>RESULT</div>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {/* Newest shot first — display order only; original index/number preserved (see ShotLog). */}
        {shots.map((s, i) => i).reverse().map((i) => {
          const s = shots[i];
          return (
            <div
              key={i}
              onClick={() => onEditShot && onEditShot(i)}
              style={{
                display: "flex",
                padding: "7px 12px",
                borderTop: `1px solid ${COLORS.creamDim}11`,
                color: COLORS.cream,
                cursor: onEditShot ? "pointer" : "default",
              }}
            >
              <div style={{ width: 24, color: COLORS.creamDim }}>{i + 1}</div>
              <div style={{ flex: 1 }}>{CLUB_LABELS[s.club]}</div>
              <div style={{ width: 60, textAlign: "right", color: s.hit ? COLORS.fairwayLight : COLORS.flag }}>
                {s.hit ? "HIT" : "MISS"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Lets someone correct a previous Tee Accuracy shot — both which club it was, and whether it
// actually found the fairway.
function TeeShotEditModal({ shot, onSave, onCancel }) {
  const [club, setClub] = useState(shot.club);
  const [hit, setHit] = useState(shot.hit);

  function handleSave() {
    onSave({ club, hit });
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT SHOT
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            CLUB
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.keys(CLUB_LABELS).map((c) => (
              <button
                key={c}
                onClick={() => setClub(c)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: club === c ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                  background: club === c ? COLORS.fairway : "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {CLUB_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            RESULT
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setHit(true)}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                border: hit ? "none" : `1px solid ${COLORS.creamDim}33`,
                background: hit ? COLORS.fairway : "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              HIT
            </button>
            <button
              onClick={() => setHit(false)}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                border: !hit ? `2px solid ${COLORS.flag}` : `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              MISS
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// Historical-session detail + edit view for Tee Accuracy. Reuses TeeShotLog for display and the
// same TeeShotEditModal used for live-session editing.
function TeeSessionDetailModal({ session, units, onEditShot, onClose }) {
  const [editingShotIndex, setEditingShotIndex] = useState(null);

  function handleSave(updatedShot) {
    onEditShot(editingShotIndex, updatedShot);
    setEditingShotIndex(null);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 380,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          SESSION DETAIL
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          {new Date(session.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          {"  ·  "}
          {session.shotCount} shots · {session.clubs.map((c) => CLUB_LABELS[c]).join(", ")}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <StatBox label="FAIRWAYS HIT" value={`${session.hitPct.toFixed(0)}%`} valueColor={ratingRagColor(session.hitPct / 20)} />
          <StatBox label="HIT / TOTAL" value={`${session.hitCount}/${session.shotCount}`} />
        </div>

        <div style={{ marginTop: 16 }}>
          <SectionLabel>Shot by shot — tap a shot to amend</SectionLabel>
          <div style={{ marginTop: 6 }}>
            <TeeShotLog shots={session.shots} units={units} onEditShot={setEditingShotIndex} />
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>

      {editingShotIndex !== null && (
        <div onClick={(e) => e.stopPropagation()}>
          <TeeShotEditModal
            shot={session.shots[editingShotIndex]}
            onSave={handleSave}
            onCancel={() => setEditingShotIndex(null)}
          />
        </div>
      )}
    </div>
  );
}

function TeeAccuracySummaryScreen({ shots, fairwayWidth, onNewSession, storageError, units }) {
  const hitCount = shots.filter((s) => s.hit).length;
  const hitPct = (hitCount / shots.length) * 100;
  const unitLabel = longUnitLabel(units);

  const byClub = {};
  shots.forEach((s) => {
    if (!byClub[s.club]) byClub[s.club] = [];
    byClub[s.club].push(s);
  });
  const clubStats = Object.entries(byClub).map(([club, shs]) => ({
    club,
    count: shs.length,
    hitPct: (shs.filter((s) => s.hit).length / shs.length) * 100,
  }));

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            SESSION COMPLETE — {shots.length} SHOTS · {ydsToUnitRound(fairwayWidth, units)}
            {unitLabel.toUpperCase()} FAIRWAY
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="FAIRWAYS HIT" value={`${hitPct.toFixed(0)}%`} valueColor={ratingRagColor(hitPct / 20)} />
          <StatBox label="HIT / TOTAL" value={`${hitCount}/${shots.length}`} />
        </div>
      </Card>

      {clubStats.length > 0 && (
        <Card style={{ marginTop: 10 }}>
          <SectionLabel>By club</SectionLabel>
          {clubStats.map((c, i) => (
            <div key={c.club} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                <div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream }}>{CLUB_LABELS[c.club]}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>{c.count} shots</div>
                </div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: ratingRagColor(c.hitPct / 20) }}>
                  {c.hitPct.toFixed(0)}%
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this session to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onNewSession}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW SESSION
      </button>
    </div>
  );
}

// ===== Wedge Matrix screens =====

function WedgeMatrixSetupScreen({
  selectedClubs,
  onToggleClub,
  selectedSwings,
  onToggleSwing,
  shotsPerCombo,
  setShotsPerCombo,
  onStart,
  activeMatrix,
  onResume,
  onDiscard,
  history,
  loaded,
  onViewMatrix,
  onDeleteMatrix,
  units,
}) {
  const canStart = selectedClubs.length > 0 && selectedSwings.length > 0 && shotsPerCombo >= 1;
  const totalCombos = selectedClubs.length * selectedSwings.length;
  const totalShots = totalCombos * shotsPerCombo;
  const [manualShotEntry, setManualShotEntry] = useState(![5, 10].includes(shotsPerCombo));

  if (activeMatrix) {
    const doneCount = Object.keys(activeMatrix.results || {}).length;
    return (
      <div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>WEDGE MATRIX</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
            You have a matrix in progress
          </div>
        </div>
        <Card>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.cream }}>
            {doneCount} of {activeMatrix.sequence.length} club/swing combos completed
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
            {activeMatrix.selectedClubs.length} clubs × {activeMatrix.selectedSwings.length} swings ·{" "}
            {activeMatrix.shotsPerCombo} shots each
          </div>
          <button
            onClick={onResume}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 20,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            RESUME
          </button>
          <div
            onClick={onDiscard}
            style={{
              textAlign: "center",
              marginTop: 10,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: COLORS.creamDim,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Discard and start over
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>WEDGE MATRIX</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Build a personal yardage chart for every club and swing length
        </div>
      </div>

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past matrices" count={history.length}>
          {history.map((m) => {
            const comboCount = Object.keys(m.results || {}).length;
            return (
              <SwipeToDelete key={m.id} onDelete={() => onDeleteMatrix(m.id)}>
                <div
                  onClick={() => onViewMatrix(m)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: `1px solid ${COLORS.creamDim}22`,
                    background: COLORS.turf,
                    marginBottom: 10,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.sand }}>
                    {new Date(m.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                    {m.selectedClubs.length} clubs × {m.selectedSwings.length} swings · {comboCount} combos · {m.shotsPerCombo} shots each
                  </div>
                </div>
              </SwipeToDelete>
            );
          })}
        </CollapsibleSection>
      )}

      <Card>
        <SectionLabel>Clubs to test</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {WEDGE_CLUBS.map((c) => (
            <div
              key={c.key}
              onClick={() => onToggleClub(c.key)}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: selectedClubs.includes(c.key) ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                background: selectedClubs.includes(c.key) ? COLORS.fairway : "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 15,
                letterSpacing: 0.5,
                cursor: "pointer",
              }}
            >
              {c.label}
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Swing lengths to test</SectionLabel>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {WEDGE_SWINGS.map((s) => (
            <div
              key={s.key}
              onClick={() => onToggleSwing(s.key)}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "10px 6px",
                borderRadius: 8,
                border: selectedSwings.includes(s.key) ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                background: selectedSwings.includes(s.key) ? COLORS.fairway : "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {s.label}
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Shots per combo</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 4 }}>
          The middle 60% of shots count toward the average — the rest are dropped evenly from the
          shortest and longest ends. You can also manually include/exclude individual shots
          afterward.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <PillOption
            label={5}
            active={!manualShotEntry && shotsPerCombo === 5}
            onClick={() => {
              setShotsPerCombo(5);
              setManualShotEntry(false);
            }}
          />
          <PillOption
            label={10}
            active={!manualShotEntry && shotsPerCombo === 10}
            onClick={() => {
              setShotsPerCombo(10);
              setManualShotEntry(false);
            }}
          />
          <PillOption label="MANUAL" active={manualShotEntry} onClick={() => setManualShotEntry(true)} />
        </div>
        {manualShotEntry && (
          <div style={{ marginTop: 8 }}>
            {/* Deliberately doesn't clamp to a minimum on every keystroke (same class of bug as the
                old Putting min-field) — clamping inline meant clearing the field to type e.g. "7"
                snapped straight back to "1" before the "7" could be entered, so the field was stuck
                unable to reach any single digit other than 1. Validation happens once, at START. */}
            <NumberField label="SHOTS" value={shotsPerCombo} onChange={setShotsPerCombo} />
            {shotsPerCombo < 1 && (
              <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                Enter at least 1 shot per combo.
              </div>
            )}
          </div>
        )}
        {shotsPerCombo >= 1 && (() => {
          const { keepCount, dropLow, dropHigh } = wedgeTrimPreview(shotsPerCombo);
          return (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand, marginTop: 8 }}>
              {shotsPerCombo} shots → keeps the middle {keepCount}
              {dropLow + dropHigh > 0 ? `, drops ${dropLow} shortest + ${dropHigh} longest` : " (too few to drop any)"}
            </div>
          );
        })()}
      </Card>

      {canStart && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 10, textAlign: "center" }}>
          {totalCombos} combo{totalCombos === 1 ? "" : "s"} · {totalShots} shots total
        </div>
      )}

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START MATRIX
      </button>
      {!canStart && (
        <div style={{ color: COLORS.creamDim, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}>
          Select at least one club and one swing length.
        </div>
      )}
    </div>
  );
}

function WedgeMatrixPracticeScreen({
  sequence,
  comboIndex,
  currentShots,
  shotsPerCombo,
  distanceInput,
  setDistanceInput,
  onSubmitShot,
  comboComplete,
  results,
  onNextCombo,
  onToggleShot,
  onAddShot,
  onExitEarly,
  units,
  inputRef,
}) {
  const combo = sequence[comboIndex];
  const comboKey = `${combo.clubKey}-${combo.swingKey}`;
  const result = results[comboKey];
  const isLastCombo = comboIndex + 1 >= sequence.length;
  const unitLabel = longUnitLabel(units);
  const overallShotNumber = sequence.slice(0, comboIndex).length * shotsPerCombo + currentShots.length;
  const totalShots = sequence.length * shotsPerCombo;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          COMBO {comboIndex + 1} OF {sequence.length}
        </div>
        <div
          onClick={onExitEarly}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          SAVE &amp; EXIT
        </div>
      </div>

      {!comboComplete ? (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              {combo.clubLabel}
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, lineHeight: 1.1, color: COLORS.flag, marginTop: 2 }}>
              {combo.swingLabel}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 8 }}>
              {currentShots.length >= shotsPerCombo
                ? `EXTRA SHOT ${currentShots.length - shotsPerCombo + 1}`
                : `SHOT ${currentShots.length + 1} OF ${shotsPerCombo}`}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>
              CARRY DISTANCE ({unitLabel.toUpperCase()})
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                autoFocus
                type="number"
                inputMode="decimal"
                value={distanceInput}
                onChange={(e) => setDistanceInput(e.target.value)}
                placeholder="0"
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 24,
                  padding: "7px 12px",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={onSubmitShot}
                disabled={distanceInput === ""}
                style={{
                  padding: "0 18px",
                  borderRadius: 8,
                  border: "none",
                  background: distanceInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  letterSpacing: 1,
                  cursor: distanceInput === "" ? "not-allowed" : "pointer",
                }}
              >
                LOG
              </button>
            </div>
          </div>

          {currentShots.length > 0 && (
            <div style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
              Logged so far: {currentShots.map((s) => `${ydsToUnitRound(s, units)}${unitLabel}`).join(", ")}
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              {combo.clubLabel} · {combo.swingLabel} COMPLETE
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, lineHeight: 1, color: COLORS.flag, marginTop: 4 }}>
              {ydsToUnitRound(result.average, units)}
              <span style={{ fontSize: 18, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 4 }}>
              average of {result.shots.filter((s) => s.included).length} of {result.shots.length} shots
            </div>
          </div>

          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 14, marginBottom: 6, textAlign: "center" }}>
            TAP A SHOT TO INCLUDE/EXCLUDE IT — GREEN COUNTS TOWARD THE AVERAGE
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
            {result.shots.map((s, i) => (
              <button
                key={i}
                onClick={() => onToggleShot(comboKey, i)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: s.included ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.flag}`,
                  background: s.included ? COLORS.fairway : "transparent",
                  color: s.included ? COLORS.cream : COLORS.creamDim,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  cursor: "pointer",
                  textDecoration: s.included ? "none" : "line-through",
                }}
              >
                {ydsToUnitRound(s.value, units)}
                {unitLabel}
              </button>
            ))}
          </div>

          <button
            onClick={onAddShot}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 14,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            + HIT ANOTHER SHOT
          </button>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 6, textAlign: "center" }}>
            Not sure about these yardages? Hit a few more — the average re-trims automatically over
            the bigger sample.
          </div>

          <button
            onClick={onNextCombo}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            {isLastCombo ? "FINISH MATRIX" : "NEXT COMBO"}
          </button>
        </Card>
      )}

      <div style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, textAlign: "center" }}>
        {Math.min(overallShotNumber, totalShots)} of {totalShots} shots overall
      </div>
    </div>
  );
}

function WedgeMatrixResultScreen({ matrix, units, onNewMatrix, onToggleShot, onEditShotValue }) {
  const clubs = WEDGE_CLUBS.filter((c) => matrix.selectedClubs.includes(c.key));
  const swings = WEDGE_SWINGS.filter((s) => matrix.selectedSwings.includes(s.key));
  const unitLabel = longUnitLabel(units);
  const [editingShot, setEditingShot] = useState(null); // { comboKey, shotIndex, shot }

  return (
    <div>
      <PrintHeader title="Wedge Matrix" timescale="all" />
      <div className="no-print" style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>YOUR WEDGE MATRIX</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {new Date(matrix.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} ·{" "}
          {matrix.shotsPerCombo} shots per combo, outliers removed
        </div>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex" }}>
          <div style={{ width: 90, flexShrink: 0, padding: "10px 8px", background: `${COLORS.turf}aa` }} />
          {swings.map((s) => (
            <div
              key={s.key}
              style={{
                flex: 1,
                padding: "10px 4px",
                background: `${COLORS.turf}aa`,
                textAlign: "center",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: COLORS.creamDim,
                borderLeft: `1px solid ${COLORS.creamDim}15`,
              }}
            >
              {s.label}
            </div>
          ))}
        </div>
        {clubs.map((c, i) => (
          <div key={c.key} style={{ display: "flex", borderTop: `1px solid ${COLORS.creamDim}15` }}>
            <div
              style={{
                width: 90,
                flexShrink: 0,
                padding: "10px 8px",
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 14,
                color: COLORS.cream,
                display: "flex",
                alignItems: "center",
              }}
            >
              {c.key}
            </div>
            {swings.map((s) => {
              const key = `${c.key}-${s.key}`;
              const result = matrix.results[key];
              return (
                <div
                  key={s.key}
                  style={{
                    flex: 1,
                    padding: "10px 4px",
                    textAlign: "center",
                    borderLeft: `1px solid ${COLORS.creamDim}15`,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 18,
                    color: result ? COLORS.flag : COLORS.creamDim,
                  }}
                >
                  {result ? `${ydsToUnitRound(result.average, units)}${unitLabel}` : "—"}
                </div>
              );
            })}
          </div>
        ))}
      </Card>

      <CollapsibleSection title="Shot detail" count={matrix.sequence.length}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 10 }}>
          Tap a shot to include/exclude it from the average · tap ✎ to correct a wrong value
        </div>
        {matrix.sequence.map((combo) => {
          const comboKey = `${combo.clubKey}-${combo.swingKey}`;
          const result = matrix.results[comboKey];
          if (!result) return null;
          return (
            <div key={comboKey} style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
                <span style={{ color: COLORS.cream, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: 0.5 }}>
                  {combo.clubKey}
                </span>{" "}
                · {combo.swingLabel} · avg {ydsToUnitRound(result.average, units)}
                {unitLabel} · {result.shots.filter((s) => s.included).length} of {result.shots.length} shots
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {result.shots.map((s, i) => (
                  <div key={i} style={{ display: "flex" }}>
                    <button
                      onClick={() => onToggleShot(comboKey, i)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "8px 0 0 8px",
                        border: s.included ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.flag}`,
                        borderRight: "none",
                        background: s.included ? COLORS.fairway : "transparent",
                        color: s.included ? COLORS.cream : COLORS.creamDim,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12,
                        cursor: "pointer",
                        textDecoration: s.included ? "none" : "line-through",
                      }}
                    >
                      {ydsToUnitRound(s.value, units)}
                      {unitLabel}
                    </button>
                    <button
                      onClick={() => setEditingShot({ comboKey, shotIndex: i, shot: s })}
                      title="Correct this shot's value"
                      style={{
                        padding: "0 8px",
                        borderRadius: "0 8px 8px 0",
                        border: s.included ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.flag}`,
                        borderLeft: `1px solid ${COLORS.creamDim}33`,
                        background: "transparent",
                        color: COLORS.creamDim,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      ✎
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CollapsibleSection>

      {editingShot && (
        <WedgeShotValueEditModal
          shot={editingShot.shot}
          units={units}
          onSave={(newValue) => {
            onEditShotValue(editingShot.comboKey, editingShot.shotIndex, newValue);
            setEditingShot(null);
          }}
          onCancel={() => setEditingShot(null)}
        />
      )}

      <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          onClick={() => window.print()}
          style={{
            flex: 1,
            padding: "12px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          SAVE AS PDF
        </button>
        <button
          onClick={() => downloadWedgeMatrixPNG(matrix, units)}
          style={{
            flex: 1,
            padding: "12px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          DOWNLOAD PNG
        </button>
      </div>

      <button
        onClick={onNewMatrix}
        className="no-print"
        style={{
          width: "100%",
          marginTop: 10,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 18,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        BUILD A NEW MATRIX
      </button>
    </div>
  );
}

// Lets someone correct a Wedge Matrix shot's actual carry distance after the matrix is finished —
// the include/exclude chip alone can only hide a bad shot from the average, not fix a mis-typed
// value. Deliberately minimal (distance only) to match the rest of the app's small edit-modal
// pattern.
function WedgeShotValueEditModal({ shot, units, onSave, onCancel }) {
  const [valueInput, setValueInput] = useState(String(fmt1(ydsToUnit(shot.value, units))));
  const unitLabel = longUnitLabel(units);

  function handleSave() {
    const value = unitToYds(parseFloat(valueInput) || 0, units);
    onSave(value);
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 320,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          CORRECT SHOT
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            CARRY DISTANCE ({unitLabel.toUpperCase()})
          </div>
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={valueInput}
            onChange={(e) => setValueInput(e.target.value)}
            style={{
              width: "100%",
              background: COLORS.turfDark,
              border: `1px solid ${COLORS.creamDim}33`,
              borderRadius: 8,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 22,
              padding: "10px 12px",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Gapping screens (full-swing yardage chart — same process as Wedge Matrix, minus the
// swing-length dimension) =====

// Shared club-selection grid — used by both the guided Gapping setup screen and the manual-entry
// club picker below, since both need the exact same "pick which clubs" UI (fixed grid + custom
// club add/remove), just followed by a different next step (choose shots-per-club vs. type in a
// figure directly). Column contents come from GAPPING_GRID_COLUMNS — a hand-picked layout, not
// derived from GAPPING_CLUBS' practice-order array (that order is unrelated to how this grid
// reads; e.g. Driver sits at the top of column 1 despite practicing last). Built as three separate
// flex columns inside an outer grid rather than relying on CSS grid-auto-flow: column, so each
// column's contents are explicit and don't depend on the total item count being evenly divisible.
function GappingClubSelectionGrid({ selectedClubs, onToggleClub, customClubs, onAddCustomClub, onRemoveCustomClub }) {
  const [customClubInput, setCustomClubInput] = useState("");
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {(() => {
          const columns = GAPPING_GRID_COLUMNS.map((keys) =>
            keys.map((key) => GAPPING_CLUBS.find((c) => c.key === key)).filter(Boolean)
          );
          return columns.map((col, colIndex) => (
            <div key={colIndex} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {col.map((c) => (
                <div
                  key={c.key}
                  onClick={() => onToggleClub(c.key)}
                  style={{
                    padding: "9px 4px",
                    borderRadius: 8,
                    border: selectedClubs.includes(c.key) ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                    background: selectedClubs.includes(c.key) ? COLORS.fairway : "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 14,
                    letterSpacing: 0.5,
                    textAlign: "center",
                    cursor: "pointer",
                  }}
                >
                  {c.label}
                </div>
              ))}
            </div>
          ));
        })()}
      </div>

      {customClubs.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Custom clubs</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 8 }}>
            {customClubs.map((c) => (
              <div key={c.key} style={{ position: "relative" }}>
                <div
                  onClick={() => onToggleClub(c.key)}
                  style={{
                    padding: "9px 12px 9px 4px",
                    borderRadius: 8,
                    border: selectedClubs.includes(c.key) ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                    background: selectedClubs.includes(c.key) ? COLORS.fairway : "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 12,
                    letterSpacing: 0.3,
                    textAlign: "center",
                    cursor: "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label}
                </div>
                <button
                  onClick={() => onRemoveCustomClub(c.key)}
                  title="Remove this custom club"
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    border: `1px solid ${COLORS.creamDim}44`,
                    background: COLORS.turfDark,
                    color: COLORS.creamDim,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    lineHeight: 1,
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input
          type="text"
          value={customClubInput}
          onChange={(e) => setCustomClubInput(e.target.value)}
          placeholder="e.g. 2 HYBRID"
          style={{
            flex: 1,
            background: COLORS.turfDark,
            border: `1px solid ${COLORS.creamDim}33`,
            borderRadius: 8,
            color: COLORS.cream,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            padding: "10px 12px",
            boxSizing: "border-box",
          }}
        />
        <button
          onClick={() => {
            if (customClubInput.trim()) {
              onAddCustomClub(customClubInput);
              setCustomClubInput("");
            }
          }}
          disabled={!customClubInput.trim()}
          style={{
            padding: "0 16px",
            borderRadius: 8,
            border: "none",
            background: !customClubInput.trim() ? `${COLORS.fairway}66` : COLORS.fairway,
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 14,
            letterSpacing: 0.5,
            cursor: !customClubInput.trim() ? "not-allowed" : "pointer",
          }}
        >
          + ADD CLUB
        </button>
      </div>
    </>
  );
}

function GappingSetupScreen({
  selectedClubs,
  onToggleClub,
  customClubs,
  onAddCustomClub,
  onRemoveCustomClub,
  shotsPerClub,
  setShotsPerClub,
  onStart,
  activeChart,
  onResume,
  onDiscard,
  history,
  loaded,
  onViewChart,
  onDeleteChart,
  units,
}) {
  const canStart = selectedClubs.length > 0 && shotsPerClub >= 1;
  const totalClubs = selectedClubs.length;
  const totalShots = totalClubs * shotsPerClub;
  const [manualShotEntry, setManualShotEntry] = useState(![5, 10].includes(shotsPerClub));

  if (activeChart) {
    const doneCount = Object.keys(activeChart.results || {}).length;
    return (
      <div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>GAPPING</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
            You have a chart in progress
          </div>
        </div>
        <Card>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.cream }}>
            {doneCount} of {activeChart.sequence.length} clubs completed
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
            {activeChart.selectedClubs.length} clubs · {activeChart.shotsPerClub} shots each
          </div>
          <button
            onClick={onResume}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 20,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            RESUME
          </button>
          <div
            onClick={onDiscard}
            style={{
              textAlign: "center",
              marginTop: 10,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: COLORS.creamDim,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Discard and start over
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>GAPPING</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Build a full-swing yardage chart, club by club
        </div>
      </div>

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past charts" count={history.length}>
          {history.map((m) => {
            const clubCount = Object.keys(m.results || {}).length;
            return (
              <SwipeToDelete key={m.id} onDelete={() => onDeleteChart(m.id)}>
                <div
                  onClick={() => onViewChart(m)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: `1px solid ${COLORS.creamDim}22`,
                    background: COLORS.turf,
                    marginBottom: 10,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.sand }}>
                    {new Date(m.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                    {clubCount} clubs · {m.shotsPerClub} shots each
                  </div>
                </div>
              </SwipeToDelete>
            );
          })}
        </CollapsibleSection>
      )}

      <Card>
        <SectionLabel>Clubs to test</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 4, marginBottom: 8 }}>
          Full swings only, 9 Iron up through Driver (plus 2/3/4 Hybrid). For wedges — and
          half/three-quarter swings — use the Wedge Matrix instead.
        </div>
        <GappingClubSelectionGrid
          selectedClubs={selectedClubs}
          onToggleClub={onToggleClub}
          customClubs={customClubs}
          onAddCustomClub={onAddCustomClub}
          onRemoveCustomClub={onRemoveCustomClub}
        />
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 6 }}>
          A custom club is added wherever it lands in the list above — position doesn't matter, only
          the yardage does.
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Shots per club</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 4 }}>
          The middle 60% of shots count toward the average — the rest are dropped evenly from the
          shortest and longest ends. You can also manually include/exclude individual shots
          afterward.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <PillOption
            label={5}
            active={!manualShotEntry && shotsPerClub === 5}
            onClick={() => {
              setShotsPerClub(5);
              setManualShotEntry(false);
            }}
          />
          <PillOption
            label={10}
            active={!manualShotEntry && shotsPerClub === 10}
            onClick={() => {
              setShotsPerClub(10);
              setManualShotEntry(false);
            }}
          />
          <PillOption label="MANUAL" active={manualShotEntry} onClick={() => setManualShotEntry(true)} />
        </div>
        {manualShotEntry && (
          <div style={{ marginTop: 8 }}>
            {/* Same deliberate no-clamp-on-keystroke fix as the Wedge Matrix manual field. */}
            <NumberField label="SHOTS" value={shotsPerClub} onChange={setShotsPerClub} />
            {shotsPerClub < 1 && (
              <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                Enter at least 1 shot per club.
              </div>
            )}
          </div>
        )}
        {shotsPerClub >= 1 && (() => {
          const { keepCount, dropLow, dropHigh } = wedgeTrimPreview(shotsPerClub);
          return (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand, marginTop: 8 }}>
              {shotsPerClub} shots → keeps the middle {keepCount}
              {dropLow + dropHigh > 0 ? `, drops ${dropLow} shortest + ${dropHigh} longest` : " (too few to drop any)"}
            </div>
          );
        })()}
      </Card>

      {canStart && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 10, textAlign: "center" }}>
          {totalClubs} club{totalClubs === 1 ? "" : "s"} · {totalShots} shots total
        </div>
      )}

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START CHART
      </button>
      {!canStart && (
        <div style={{ color: COLORS.creamDim, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}>
          Select at least one club.
        </div>
      )}
    </div>
  );
}

function GappingPracticeScreen({
  sequence,
  clubIndex,
  currentShots,
  shotsPerClub,
  distanceInput,
  setDistanceInput,
  onSubmitShot,
  clubComplete,
  results,
  onNextClub,
  onToggleShot,
  onAddShot,
  onExitEarly,
  units,
  inputRef,
}) {
  const club = sequence[clubIndex];
  const result = results[club.clubKey];
  const isLastClub = clubIndex + 1 >= sequence.length;
  const unitLabel = longUnitLabel(units);
  const overallShotNumber = sequence.slice(0, clubIndex).length * shotsPerClub + currentShots.length;
  const totalShots = sequence.length * shotsPerClub;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          CLUB {clubIndex + 1} OF {sequence.length}
        </div>
        <div
          onClick={onExitEarly}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          SAVE &amp; EXIT
        </div>
      </div>

      {!clubComplete ? (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, lineHeight: 1.1, color: COLORS.flag, marginTop: 2 }}>
              {club.clubLabel}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 8 }}>
              {currentShots.length >= shotsPerClub
                ? `EXTRA SHOT ${currentShots.length - shotsPerClub + 1}`
                : `SHOT ${currentShots.length + 1} OF ${shotsPerClub}`}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>
              CARRY DISTANCE ({unitLabel.toUpperCase()})
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                autoFocus
                type="number"
                inputMode="decimal"
                value={distanceInput}
                onChange={(e) => setDistanceInput(e.target.value)}
                placeholder="0"
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 24,
                  padding: "7px 12px",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={onSubmitShot}
                disabled={distanceInput === ""}
                style={{
                  padding: "0 18px",
                  borderRadius: 8,
                  border: "none",
                  background: distanceInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  letterSpacing: 1,
                  cursor: distanceInput === "" ? "not-allowed" : "pointer",
                }}
              >
                LOG
              </button>
            </div>
          </div>

          {currentShots.length > 0 && (
            <div style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
              Logged so far: {currentShots.map((s) => `${ydsToUnitRound(s, units)}${unitLabel}`).join(", ")}
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              {club.clubLabel} COMPLETE
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, lineHeight: 1, color: COLORS.flag, marginTop: 4 }}>
              {ydsToUnitRound(result.average, units)}
              <span style={{ fontSize: 18, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 4 }}>
              average of {result.shots.filter((s) => s.included).length} of {result.shots.length} shots
            </div>
          </div>

          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 14, marginBottom: 6, textAlign: "center" }}>
            TAP A SHOT TO INCLUDE/EXCLUDE IT — GREEN COUNTS TOWARD THE AVERAGE
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
            {result.shots.map((s, i) => (
              <button
                key={i}
                onClick={() => onToggleShot(club.clubKey, i)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: s.included ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.flag}`,
                  background: s.included ? COLORS.fairway : "transparent",
                  color: s.included ? COLORS.cream : COLORS.creamDim,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  cursor: "pointer",
                  textDecoration: s.included ? "none" : "line-through",
                }}
              >
                {ydsToUnitRound(s.value, units)}
                {unitLabel}
              </button>
            ))}
          </div>

          <button
            onClick={onAddShot}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 14,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            + HIT ANOTHER SHOT
          </button>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 6, textAlign: "center" }}>
            Not sure about this yardage? Hit a few more — the average re-trims automatically over
            the bigger sample.
          </div>

          <button
            onClick={onNextClub}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            {isLastClub ? "FINISH CHART" : "NEXT CLUB"}
          </button>
        </Card>
      )}

      <div style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, textAlign: "center" }}>
        {Math.min(overallShotNumber, totalShots)} of {totalShots} shots overall
      </div>
    </div>
  );
}

function GappingResultScreen({ chart, units, onNewChart, onToggleShot, onEditShotValue }) {
  // chart.sequence itself stays shortest-to-longest (the order shots were hit in, or the order
  // typed on the manual-entry screen) — display here, and in the PDF/PNG export, is deliberately
  // reversed to read longest-to-shortest (Driver down to 9 Iron), per explicit user request. Lookups
  // below are all keyed by clubKey, not position, so reversing this array is purely cosmetic.
  const clubs = [...chart.sequence].reverse();
  const unitLabel = longUnitLabel(units);
  const [editingShot, setEditingShot] = useState(null); // { clubKey, shotIndex, shot }

  return (
    <div>
      <PrintHeader title="Gapping Chart" timescale="all" />
      <div className="no-print" style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>YOUR GAPPING CHART</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {new Date(chart.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} ·{" "}
          {chart.enteredManually
            ? "entered directly"
            : `${chart.shotsPerClub} shot${chart.shotsPerClub === 1 ? "" : "s"} per club, outliers removed`}
        </div>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {clubs.map((c) => {
          const result = chart.results[c.clubKey];
          return (
            <div key={c.clubKey} style={{ display: "flex", borderTop: `1px solid ${COLORS.creamDim}15` }}>
              <div
                style={{
                  flex: 1,
                  padding: "12px 14px",
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  color: COLORS.cream,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {c.clubLabel}
              </div>
              <div
                style={{
                  width: 100,
                  flexShrink: 0,
                  padding: "12px 4px",
                  textAlign: "center",
                  borderLeft: `1px solid ${COLORS.creamDim}15`,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 18,
                  color: result ? COLORS.flag : COLORS.creamDim,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {result ? `${ydsToUnitRound(result.average, units)}${unitLabel}` : "—"}
              </div>
            </div>
          );
        })}
      </Card>

      <CollapsibleSection title="Shot detail" count={chart.sequence.length}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 10 }}>
          Tap a shot to include/exclude it from the average · tap ✎ to correct a wrong value
        </div>
        {clubs.map((c) => {
          const result = chart.results[c.clubKey];
          if (!result) return null;
          return (
            <div key={c.clubKey} style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
                <span style={{ color: COLORS.cream, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: 0.5 }}>
                  {c.clubLabel}
                </span>{" "}
                · avg {ydsToUnitRound(result.average, units)}
                {unitLabel} · {result.shots.filter((s) => s.included).length} of {result.shots.length} shots
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {result.shots.map((s, i) => (
                  <div key={i} style={{ display: "flex" }}>
                    <button
                      onClick={() => onToggleShot(c.clubKey, i)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "8px 0 0 8px",
                        border: s.included ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.flag}`,
                        borderRight: "none",
                        background: s.included ? COLORS.fairway : "transparent",
                        color: s.included ? COLORS.cream : COLORS.creamDim,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12,
                        cursor: "pointer",
                        textDecoration: s.included ? "none" : "line-through",
                      }}
                    >
                      {ydsToUnitRound(s.value, units)}
                      {unitLabel}
                    </button>
                    <button
                      onClick={() => setEditingShot({ clubKey: c.clubKey, shotIndex: i, shot: s })}
                      title="Correct this shot's value"
                      style={{
                        padding: "0 8px",
                        borderRadius: "0 8px 8px 0",
                        border: s.included ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.flag}`,
                        borderLeft: `1px solid ${COLORS.creamDim}33`,
                        background: "transparent",
                        color: COLORS.creamDim,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      ✎
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CollapsibleSection>

      {editingShot && (
        <WedgeShotValueEditModal
          shot={editingShot.shot}
          units={units}
          onSave={(newValue) => {
            onEditShotValue(editingShot.clubKey, editingShot.shotIndex, newValue);
            setEditingShot(null);
          }}
          onCancel={() => setEditingShot(null)}
        />
      )}

      <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          onClick={() => window.print()}
          style={{
            flex: 1,
            padding: "12px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          SAVE AS PDF
        </button>
        <button
          onClick={() => downloadGappingPNG(chart, units)}
          style={{
            flex: 1,
            padding: "12px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          DOWNLOAD PNG
        </button>
      </div>

      <button
        onClick={onNewChart}
        className="no-print"
        style={{
          width: "100%",
          marginTop: 10,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 18,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        BUILD A NEW CHART
      </button>
    </div>
  );
}

// ===== Manual Gapping entry — club select + one-figure-per-club screens =====
// An alternate on-ramp to the exact same Gapping chart above, for anyone who already knows their
// numbers and doesn't want to re-test them on the range. Shares club selection with the tested
// flow (GappingClubSelectionGrid, same gappingSelectedClubs/gappingCustomClubs state) — only the
// "how do I get a number for each club" step differs.

function GappingManualClubsScreen({ selectedClubs, onToggleClub, customClubs, onAddCustomClub, onRemoveCustomClub, onContinue }) {
  const canContinue = selectedClubs.length > 0;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>ENTER YOUR OWN YARDAGES</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Select which clubs you want to add — you'll type in a distance for each on the next screen
        </div>
      </div>

      <Card>
        <SectionLabel>Clubs</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 4, marginBottom: 8 }}>
          Full swings only, 9 Iron up through Driver (plus 2/3/4 Hybrid). For wedges, use the Wedge
          Matrix instead.
        </div>
        <GappingClubSelectionGrid
          selectedClubs={selectedClubs}
          onToggleClub={onToggleClub}
          customClubs={customClubs}
          onAddCustomClub={onAddCustomClub}
          onRemoveCustomClub={onRemoveCustomClub}
        />
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 6 }}>
          A custom club is added wherever it lands in the list above — position doesn't matter, only
          the yardage does.
        </div>
      </Card>

      <button
        onClick={onContinue}
        disabled={!canContinue}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canContinue ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canContinue ? "not-allowed" : "pointer",
        }}
      >
        CONTINUE
      </button>
      {!canContinue && (
        <div style={{ color: COLORS.creamDim, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}>
          Select at least one club.
        </div>
      )}
    </div>
  );
}

function GappingManualEntryScreen({ sequence, values, onChangeValue, onSave, onExit, units }) {
  const unitLabel = longUnitLabel(units);
  const filledCount = sequence.filter((c) => {
    const raw = values[c.clubKey];
    return raw !== undefined && raw !== "" && !isNaN(parseFloat(raw));
  }).length;
  // Display only — sequence itself stays shortest-to-longest (the order the saved chart, its
  // results screen, and PDF/PNG export all use, matching tested Gapping charts). This screen just
  // reverses it for typing in, longest club first, per explicit user request.
  const displayOrder = [...sequence].reverse();

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          {sequence.length} CLUB{sequence.length === 1 ? "" : "S"}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          CANCEL
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>TYPE IN YOUR YARDAGES</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Enter a carry distance for each club — leave any blank to skip it
        </div>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {displayOrder.map((c, i) => (
          <div
            key={c.clubKey}
            style={{
              display: "flex",
              alignItems: "center",
              borderTop: i === 0 ? "none" : `1px solid ${COLORS.creamDim}15`,
              padding: "10px 14px",
            }}
          >
            <div style={{ flex: 1, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream }}>{c.clubLabel}</div>
            <input
              type="number"
              inputMode="decimal"
              value={values[c.clubKey] ?? ""}
              onChange={(e) => onChangeValue(c.clubKey, e.target.value)}
              placeholder={unitLabel.toUpperCase()}
              style={{
                width: 90,
                background: COLORS.turfDark,
                border: `1px solid ${COLORS.creamDim}33`,
                borderRadius: 8,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                padding: "8px 10px",
                textAlign: "right",
                boxSizing: "border-box",
              }}
            />
          </div>
        ))}
      </Card>

      <button
        onClick={onSave}
        disabled={filledCount === 0}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: filledCount === 0 ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 1,
          cursor: filledCount === 0 ? "not-allowed" : "pointer",
        }}
      >
        SAVE CHART
      </button>
      <div style={{ color: COLORS.creamDim, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}>
        {filledCount === 0 ? "Enter a distance for at least one club." : `${filledCount} of ${sequence.length} clubs filled in`}
      </div>
    </div>
  );
}

// ===== Compete (Range) screens =====

function CompeteSetupScreen({
  players,
  onUpdatePlayerName,
  onAddPlayer,
  onRemovePlayer,
  rounds,
  setRounds,
  minDist,
  maxDist,
  setMinDist,
  setMaxDist,
  mode,
  setMode,
  onStart,
  units,
  history,
  loaded,
  onDeleteSession,
}) {
  const validCount = players.map((p) => p.trim()).filter(Boolean).length;
  const invalidRange = minDist >= maxDist || minDist < 0;
  const canStart = validCount >= 2 && !invalidRange;
  const unitLabel = longUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>COMPETE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Head-to-head range challenge — 2 to 4 players
        </div>
      </div>

      <Card>
        <SectionLabel>Players</SectionLabel>
        <div style={{ marginTop: 8 }}>
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={p}
                onChange={(e) => onUpdatePlayerName(i, e.target.value)}
                placeholder={`Player ${i + 1}`}
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                  padding: "10px 12px",
                  boxSizing: "border-box",
                }}
              />
              {players.length > 2 && (
                <div
                  onClick={() => onRemovePlayer(i)}
                  style={{
                    color: COLORS.creamDim,
                    fontSize: 20,
                    cursor: "pointer",
                    padding: "0 6px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  ×
                </div>
              )}
            </div>
          ))}
        </div>
        {players.length < 4 && (
          <div
            onClick={onAddPlayer}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.sand,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            + ADD PLAYER
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Rounds</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[5, 10, 15].map((n) => (
            <PillOption key={n} label={n} active={rounds === n} onClick={() => setRounds(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Distance window ({unitLabel})</SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField
            label="MIN"
            value={ydsToUnitRound(minDist, units)}
            onChange={(v) => setMinDist(unitToYdsRound(v, units))}
          />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField
            label="MAX"
            value={ydsToUnitRound(maxDist, units)}
            onChange={(v) => setMaxDist(unitToYdsRound(v, units))}
          />
        </div>
        {invalidRange && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Max needs to be greater than min.
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>How to score each round</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <div
            onClick={() => setMode("distance")}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: mode === "distance" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: mode === "distance" ? COLORS.fairway : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream, letterSpacing: 0.5 }}>
              ENTER DISTANCES
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              Each player's actual distance is logged — full ranking, points scale with player count
              (e.g. 3 players: 2/1/0pts).
            </div>
          </div>
          <div
            onClick={() => setMode("closest")}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: mode === "closest" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: mode === "closest" ? COLORS.fairway : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream, letterSpacing: 0.5 }}>
              JUST PICK CLOSEST
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              No distances needed — just tap whoever was closest each round. Flat 1pt to the winner,
              0 to everyone else.
            </div>
          </div>
        </div>
      </Card>

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START COMPETITION
      </button>
      {validCount < 2 && (
        <div style={{ color: COLORS.creamDim, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}>
          Enter at least 2 player names to begin.
        </div>
      )}

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past competitions" count={history.length}>
          {history.map((s) => {
            const totals = computeCompeteTotals(s.players, s.rounds);
            const winner = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
            return (
              <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                <Card style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                    {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {"  ·  "}
                    {s.players.join(", ")} · {s.rounds.length} rounds
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, marginTop: 6, color: COLORS.sand }}>
                    ★ {winner ? winner[0] : "—"} won
                  </div>
                </Card>
              </SwipeToDelete>
            );
          })}
        </CollapsibleSection>
      )}
    </div>
  );
}

function CompetePlayScreen({
  players,
  roundResults,
  totalRounds,
  target,
  mode,
  currentPlayerIdx,
  distanceInput,
  setDistanceInput,
  onSubmitDistance,
  onSelectClosest,
  roundComplete,
  roundStandings,
  onNextRound,
  onExitEarly,
  units,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}) {
  const roundNumber = roundResults.length + 1;
  const isLastRound = roundResults.length >= totalRounds;
  const unitLabel = longUnitLabel(units);
  const totals = computeCompeteTotals(players, roundResults);
  const leaderboard = [...players].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          ROUND {Math.min(roundNumber, totalRounds)} OF {totalRounds}
        </div>
        <div
          onClick={onExitEarly}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          END COMPETITION
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          paddingBottom: 4,
          marginBottom: 10,
        }}
      >
        {leaderboard.map((p, i) => (
          <div
            key={p}
            style={{
              flex: "0 0 auto",
              padding: "6px 12px",
              borderRadius: 8,
              background: i === 0 ? `${COLORS.fairway}88` : COLORS.turf,
              border: `1px solid ${COLORS.creamDim}22`,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.cream,
              whiteSpace: "nowrap",
            }}
          >
            {i === 0 && (totals[p] || 0) > 0 ? "★ " : ""}
            {p} · {totals[p] || 0}pt{(totals[p] || 0) === 1 ? "" : "s"}
          </div>
        ))}
      </div>

      {!roundComplete ? (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              TARGET
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag }}>
              {ydsToUnitRound(target, units)}
              <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
            </div>
          </div>

          {mode === "distance" ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, marginBottom: 6 }}>
                NOW HITTING: {players[currentPlayerIdx]?.toUpperCase()}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  value={distanceInput}
                  onChange={(e) => setDistanceInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSubmitDistance()}
                  placeholder="0"
                  autoFocus
                  style={{
                    flex: 1,
                    background: COLORS.turfDark,
                    border: `1px solid ${COLORS.creamDim}33`,
                    borderRadius: 8,
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 24,
                    padding: "7px 12px",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={onSubmitDistance}
                  disabled={distanceInput === ""}
                  style={{
                    padding: "0 18px",
                    borderRadius: 8,
                    border: "none",
                    background: distanceInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 16,
                    letterSpacing: 1,
                    cursor: distanceInput === "" ? "not-allowed" : "pointer",
                  }}
                >
                  LOG
                </button>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
                Player {currentPlayerIdx + 1} of {players.length} this round
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
                WHO WAS CLOSEST?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {players.map((p) => (
                  <button
                    key={p}
                    onClick={() => onSelectClosest(p)}
                    style={{
                      padding: "14px 0",
                      borderRadius: 10,
                      border: `1px solid ${COLORS.creamDim}33`,
                      background: "transparent",
                      color: COLORS.cream,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 18,
                      letterSpacing: 0.5,
                      cursor: "pointer",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              ROUND {Math.min(roundNumber, totalRounds)} COMPLETE
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: COLORS.sand, marginTop: 4 }}>
              ★ {roundStandings.find((s) => s.rank === 1)?.player}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            {[...roundStandings]
              .sort((a, b) => (a.rank || 99) - (b.rank || 99))
              .map((s, i) => (
                <div
                  key={s.player}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "7px 0",
                    borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    color: COLORS.cream,
                  }}
                >
                  <div>
                    {s.rank ? `${s.rank}.` : ""} {s.player}
                    {s.diff !== undefined && (
                      <span style={{ color: COLORS.creamDim, fontSize: 11 }}> · {fmt1(ydsToUnit(s.diff, units))}{unitLabel} off</span>
                    )}
                  </div>
                  <div style={{ color: s.points > 0 ? COLORS.fairwayLight : COLORS.creamDim }}>+{s.points}pt</div>
                </div>
              ))}
          </div>

          <button
            onClick={onNextRound}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            {isLastRound ? "FINISH COMPETITION" : "NEXT ROUND"}
          </button>
        </Card>
      )}

      {roundResults.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, letterSpacing: 1, marginBottom: 6 }}>
            PAST ROUNDS — TAP TO AMEND
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {roundResults.map((r, i) => (
              <div
                key={i}
                onClick={() => onStartEdit(i)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: COLORS.turf,
                  border: `1px solid ${COLORS.creamDim}22`,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.cream }}>
                  Round {i + 1} · {ydsToUnitRound(r.target, units)}
                  {unitLabel} · ★ {r.standings?.find((s) => s.rank === 1)?.player}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.sand }}>EDIT</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingIndex !== null && (
        <CompeteRoundEditModal
          round={roundResults[editingIndex]}
          players={players}
          mode={mode}
          units={units}
          valueKind="yds"
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}
    </div>
  );
}

function CompeteSummaryScreen({
  players,
  mode,
  roundResults,
  minDist,
  maxDist,
  units,
  onNewCompetition,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}) {
  const totals = computeCompeteTotals(players, roundResults);
  const leaderboard = [...players].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
  const topScore = totals[leaderboard[0]] || 0;
  const unitLabel = longUnitLabel(units);

  // Only meaningful in distance mode, where every round has real entries per player.
  const distanceStats = {};
  if (mode === "distance") {
    players.forEach((p) => {
      const diffs = [];
      roundResults.forEach((r) => {
        const entry = (r.entries || []).find((e) => e.player === p);
        if (entry) diffs.push(Math.abs(entry.distance - r.target));
      });
      distanceStats[p] = diffs.length ? avg(diffs) : null;
    });
  }

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            COMPETITION COMPLETE — {roundResults.length} ROUNDS
          </div>
        </div>
        {leaderboard.map((p, i) => (
          <div
            key={p}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 0",
              borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
            }}
          >
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: i === 0 && topScore > 0 ? COLORS.sand : COLORS.cream }}>
                {i === 0 && topScore > 0 ? "★ " : ""}
                {p}
              </div>
              {mode === "distance" && distanceStats[p] != null && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim }}>
                  avg {fmt1(ydsToUnit(distanceStats[p], units))}{unitLabel} off target
                </div>
              )}
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: COLORS.cream }}>{totals[p] || 0}pt</div>
          </div>
        ))}
      </Card>

      <CollapsibleSection title="Round by round — tap a round to amend" count={roundResults.length}>
        {roundResults.map((r, i) => (
          <Card key={i} style={{ marginBottom: 10, cursor: "pointer" }} onClick={() => onStartEdit(i)}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
              ROUND {i + 1} · TARGET {ydsToUnitRound(r.target, units)}
              {unitLabel}
            </div>
            {[...r.standings]
              .sort((a, b) => (a.rank || 99) - (b.rank || 99))
              .map((s, j) => (
                <div
                  key={s.player}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "4px 0",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    color: COLORS.cream,
                  }}
                >
                  <div>
                    {s.rank ? `${s.rank}.` : ""} {s.player}
                  </div>
                  <div style={{ color: s.points > 0 ? COLORS.fairwayLight : COLORS.creamDim }}>+{s.points}</div>
                </div>
              ))}
          </Card>
        ))}
      </CollapsibleSection>

      {editingIndex !== null && (
        <CompeteRoundEditModal
          round={roundResults[editingIndex]}
          players={players}
          mode={mode}
          units={units}
          valueKind="yds"
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}

      <button
        onClick={onNewCompetition}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW COMPETITION
      </button>
    </div>
  );
}

function RangeChooseScreen({ onNavigate }) {
  const options = [
    {
      key: "distance",
      label: "DISTANCE CONTROL",
      subtitle: "Hit a random target distance, track how close you get",
      screen: "setup",
      Illustration: RangeIllustration,
    },
    {
      key: "teeaccuracy",
      label: "TEE ACCURACY",
      subtitle: "Fairways found off the tee, by club",
      screen: "teeaccuracy",
      Illustration: TeeAccuracyIllustration,
    },
  ];
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>THE RANGE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Choose what you're working on
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {options.map((o) => (
          <div
            key={o.key}
            onClick={() => onNavigate(o.screen)}
            style={{
              position: "relative",
              height: 120,
              borderRadius: 14,
              overflow: "hidden",
              cursor: "pointer",
              border: `1px solid ${COLORS.creamDim}22`,
            }}
          >
            <o.Illustration />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(180deg, transparent 20%, ${COLORS.turfDark}dd 100%)`,
              }}
            />
            <div style={{ position: "absolute", left: 12, bottom: 10, right: 12 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 22,
                  letterSpacing: 0.5,
                  lineHeight: 1.05,
                  color: COLORS.cream,
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {o.label}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                {o.subtitle}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function YardagesChooseScreen({ onNavigate }) {
  const options = [
    {
      key: "gapping",
      label: "GAPPING",
      subtitle: "Full-swing yardage chart, club by club",
      screen: "gappingSetup",
      available: true,
      Illustration: GappingIllustration,
    },
    {
      key: "manual",
      label: "ENTER YOUR OWN",
      subtitle: "Already know your numbers? Type them straight in",
      screen: "gappingManualClubs",
      available: true,
      Illustration: ManualYardagesIllustration,
    },
    {
      key: "wedgematrix",
      label: "WEDGE MATRIX",
      subtitle: "Build your own yardage chart, club by club",
      screen: "wedgeMatrixSetup",
      available: true,
      Illustration: WedgeMatrixIllustration,
    },
  ];
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>YARDAGES</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Choose what you're working on
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {options.map((o) => (
          <div
            key={o.key}
            onClick={() => o.available && onNavigate(o.screen)}
            style={{
              position: "relative",
              height: 120,
              borderRadius: 14,
              overflow: "hidden",
              cursor: o.available ? "pointer" : "default",
              border: `1px solid ${COLORS.creamDim}22`,
              opacity: o.available ? 1 : 0.6,
            }}
          >
            <o.Illustration />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(180deg, transparent 20%, ${COLORS.turfDark}dd 100%)`,
              }}
            />
            {!o.available && (
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: `${COLORS.turfDark}cc`,
                  border: `1px solid ${COLORS.creamDim}44`,
                  borderRadius: 5,
                  padding: "2px 6px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 8,
                  color: COLORS.creamDim,
                  letterSpacing: 0.5,
                }}
              >
                SOON
              </div>
            )}
            <div style={{ position: "absolute", left: 12, bottom: 10, right: 12 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 22,
                  letterSpacing: 0.5,
                  lineHeight: 1.05,
                  color: COLORS.cream,
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {o.label}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                {o.subtitle}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompeteChooseScreen({ onNavigate }) {
  const options = [
    {
      key: "range",
      label: "RANGE",
      subtitle: "Closest to target wins each round",
      screen: "competeSetup",
      Illustration: RangeIllustration,
    },
    {
      key: "putting",
      label: "PUTTING",
      subtitle: "Fewest putts across the round wins",
      screen: "competePuttingSetup",
      Illustration: PuttingIllustration,
    },
    {
      key: "shortgame",
      label: "SHORT GAME",
      subtitle: "Closest to the hole wins each round",
      screen: "competeShortGameSetup",
      Illustration: ShortGameIllustration,
    },
  ];
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>COMPETE</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Choose what you're playing
        </div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
          2-4 players go head-to-head, taking turns each round and racking up points for whoever
          gets closest — most points (or fewest putts in Putting) wins by the end.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {options.map((o) => (
          <div
            key={o.key}
            onClick={() => onNavigate(o.screen)}
            style={{
              position: "relative",
              height: 120,
              borderRadius: 14,
              overflow: "hidden",
              cursor: "pointer",
              border: `1px solid ${COLORS.creamDim}22`,
            }}
          >
            <o.Illustration />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(180deg, transparent 20%, ${COLORS.turfDark}dd 100%)`,
              }}
            />
            <div style={{ position: "absolute", left: 12, bottom: 10, right: 12 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 22,
                  letterSpacing: 0.5,
                  lineHeight: 1.05,
                  color: COLORS.cream,
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {o.label}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                {o.subtitle}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== Compete (Short Game) screens =====

function ShortGameCompeteSetupScreen({
  players,
  onUpdatePlayerName,
  onAddPlayer,
  onRemovePlayer,
  rounds,
  setRounds,
  minYds,
  maxYds,
  setMinYds,
  setMaxYds,
  lies,
  onToggleLie,
  mode,
  setMode,
  onStart,
  units,
  history,
  loaded,
  onDeleteSession,
}) {
  const validCount = players.map((p) => p.trim()).filter(Boolean).length;
  const invalidRange = minYds < 5 || maxYds > 40 || minYds >= maxYds || lies.length === 0;
  const canStart = validCount >= 2 && !invalidRange;
  const unitLabel = longUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>COMPETE — SHORT GAME</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          2 to 4 players, closest to the hole
        </div>
      </div>

      <Card>
        <SectionLabel>Players</SectionLabel>
        <div style={{ marginTop: 8 }}>
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={p}
                onChange={(e) => onUpdatePlayerName(i, e.target.value)}
                placeholder={`Player ${i + 1}`}
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                  padding: "10px 12px",
                  boxSizing: "border-box",
                }}
              />
              {players.length > 2 && (
                <div
                  onClick={() => onRemovePlayer(i)}
                  style={{ color: COLORS.creamDim, fontSize: 20, cursor: "pointer", padding: "0 6px", display: "flex", alignItems: "center" }}
                >
                  ×
                </div>
              )}
            </div>
          ))}
        </div>
        {players.length < 4 && (
          <div
            onClick={onAddPlayer}
            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            + ADD PLAYER
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Rounds</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[9, 18, 27].map((n) => (
            <PillOption key={n} label={n} active={rounds === n} onClick={() => setRounds(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>
          Distance window ({unitLabel}, {ydsToUnitRound(5, units)}-{ydsToUnitRound(40, units)})
        </SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField label="MIN" value={ydsToUnitRound(minYds, units)} onChange={(v) => setMinYds(unitToYdsRound(v, units))} />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField label="MAX" value={ydsToUnitRound(maxYds, units)} onChange={(v) => setMaxYds(unitToYdsRound(v, units))} />
        </div>
        {(minYds < 5 || maxYds > 40 || minYds >= maxYds) && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Keep it between {ydsToUnitRound(5, units)} and {ydsToUnitRound(40, units)}
            {unitLabel}, with max greater than min.
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Lies to include</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <LieToggle lie="fairway" active={lies.includes("fairway")} onClick={() => onToggleLie("fairway")} />
          <LieToggle lie="rough" active={lies.includes("rough")} onClick={() => onToggleLie("rough")} />
          <LieToggle lie="bunker" active={lies.includes("bunker")} onClick={() => onToggleLie("bunker")} />
        </div>
        {lies.length === 0 && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Select at least one lie.
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>How to score each round</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <div
            onClick={() => setMode("distance")}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: mode === "distance" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: mode === "distance" ? COLORS.fairway : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream, letterSpacing: 0.5 }}>ENTER DISTANCES</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              Each player's finishing distance from the hole is logged — full ranking, points scale with player count.
            </div>
          </div>
          <div
            onClick={() => setMode("closest")}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: mode === "closest" ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: mode === "closest" ? COLORS.fairway : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream, letterSpacing: 0.5 }}>JUST PICK CLOSEST</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              No distances needed — tap whoever finished closest. Flat 1pt to the winner, 0 to everyone else.
            </div>
          </div>
        </div>
      </Card>

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START COMPETITION
      </button>

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past competitions" count={history.length}>
          {history.map((s) => {
            const totals = computeCompeteTotals(s.players, s.rounds);
            const winner = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
            return (
              <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                <Card style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                    {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {"  ·  "}
                    {s.players.join(", ")} · {s.rounds.length} rounds
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, marginTop: 6, color: COLORS.sand }}>
                    ★ {winner ? winner[0] : "—"} won
                  </div>
                </Card>
              </SwipeToDelete>
            );
          })}
        </CollapsibleSection>
      )}
    </div>
  );
}

function ShortGameCompetePlayScreen({
  players,
  roundResults,
  totalRounds,
  currentShot,
  mode,
  currentPlayerIdx,
  resultInput,
  setResultInput,
  onSubmitDistance,
  onSelectClosest,
  roundComplete,
  roundStandings,
  onNextRound,
  onExitEarly,
  units,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}) {
  const roundNumber = roundResults.length + 1;
  const isLastRound = roundResults.length >= totalRounds;
  const yLabel = longUnitLabel(units);
  const shortLabel = shortUnitLabel(units);
  const totals = computeCompeteTotals(players, roundResults);
  const leaderboard = [...players].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          ROUND {Math.min(roundNumber, totalRounds)} OF {totalRounds}
        </div>
        <div
          onClick={onExitEarly}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          END COMPETITION
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
        {leaderboard.map((p, i) => (
          <div
            key={p}
            style={{
              flex: "0 0 auto",
              padding: "6px 12px",
              borderRadius: 8,
              background: i === 0 ? `${COLORS.fairway}88` : COLORS.turf,
              border: `1px solid ${COLORS.creamDim}22`,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.cream,
              whiteSpace: "nowrap",
            }}
          >
            {i === 0 && (totals[p] || 0) > 0 ? "★ " : ""}
            {p} · {totals[p] || 0}pt{(totals[p] || 0) === 1 ? "" : "s"}
          </div>
        ))}
      </div>

      {!roundComplete ? (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              {LIE_LABELS[currentShot.lie]}
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag, marginTop: 2 }}>
              {ydsToUnitRound(currentShot.target, units)}
              <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{yLabel}</span>
            </div>
          </div>

          {mode === "distance" ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, marginBottom: 6 }}>
                NOW HITTING: {players[currentPlayerIdx]?.toUpperCase()}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  value={resultInput}
                  onChange={(e) => setResultInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSubmitDistance()}
                  placeholder="0"
                  autoFocus
                  style={{
                    flex: 1,
                    background: COLORS.turfDark,
                    border: `1px solid ${COLORS.creamDim}33`,
                    borderRadius: 8,
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 24,
                    padding: "7px 12px",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={onSubmitDistance}
                  disabled={resultInput === ""}
                  style={{
                    padding: "0 18px",
                    borderRadius: 8,
                    border: "none",
                    background: resultInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 16,
                    letterSpacing: 1,
                    cursor: resultInput === "" ? "not-allowed" : "pointer",
                  }}
                >
                  LOG
                </button>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
                Result in {shortLabel} from hole · Player {currentPlayerIdx + 1} of {players.length} this round
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
                WHO WAS CLOSEST?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {players.map((p) => (
                  <button
                    key={p}
                    onClick={() => onSelectClosest(p)}
                    style={{
                      padding: "14px 0",
                      borderRadius: 10,
                      border: `1px solid ${COLORS.creamDim}33`,
                      background: "transparent",
                      color: COLORS.cream,
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 18,
                      letterSpacing: 0.5,
                      cursor: "pointer",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              ROUND {Math.min(roundNumber, totalRounds)} COMPLETE
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: COLORS.sand, marginTop: 4 }}>
              ★ {roundStandings.find((s) => s.rank === 1)?.player}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            {[...roundStandings]
              .sort((a, b) => (a.rank || 99) - (b.rank || 99))
              .map((s, i) => (
                <div
                  key={s.player}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "7px 0",
                    borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    color: COLORS.cream,
                  }}
                >
                  <div>
                    {s.rank ? `${s.rank}.` : ""} {s.player}
                    {s.resultFt !== undefined && (
                      <span style={{ color: COLORS.creamDim, fontSize: 11 }}> · {fmt1(ftToUnit(s.resultFt, units))}{shortLabel}</span>
                    )}
                  </div>
                  <div style={{ color: s.points > 0 ? COLORS.fairwayLight : COLORS.creamDim }}>+{s.points}pt</div>
                </div>
              ))}
          </div>
          <button
            onClick={onNextRound}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            {isLastRound ? "FINISH COMPETITION" : "NEXT ROUND"}
          </button>
        </Card>
      )}

      {roundResults.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, letterSpacing: 1, marginBottom: 6 }}>
            PAST ROUNDS — TAP TO AMEND
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {roundResults.map((r, i) => (
              <div
                key={i}
                onClick={() => onStartEdit(i)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: COLORS.turf,
                  border: `1px solid ${COLORS.creamDim}22`,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.cream }}>
                  Round {i + 1} · {LIE_LABELS[r.lie]} · ★ {r.standings?.find((s) => s.rank === 1)?.player}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.sand }}>EDIT</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingIndex !== null && (
        <CompeteRoundEditModal
          round={roundResults[editingIndex]}
          players={players}
          mode={mode}
          units={units}
          valueKind="ft"
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}
    </div>
  );
}

function ShortGameCompeteSummaryScreen({
  players,
  mode,
  roundResults,
  units,
  onNewCompetition,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}) {
  const totals = computeCompeteTotals(players, roundResults);
  const leaderboard = [...players].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
  const topScore = totals[leaderboard[0]] || 0;
  const shortLabel = shortUnitLabel(units);

  const proximityStats = {};
  if (mode === "distance") {
    players.forEach((p) => {
      const dists = [];
      roundResults.forEach((r) => {
        const entry = (r.entries || []).find((e) => e.player === p);
        if (entry) dists.push(entry.resultFt);
      });
      proximityStats[p] = dists.length ? avg(dists) : null;
    });
  }

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            COMPETITION COMPLETE — {roundResults.length} ROUNDS
          </div>
        </div>
        {leaderboard.map((p, i) => (
          <div key={p} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: i === 0 && topScore > 0 ? COLORS.sand : COLORS.cream }}>
                {i === 0 && topScore > 0 ? "★ " : ""}
                {p}
              </div>
              {mode === "distance" && proximityStats[p] != null && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim }}>
                  avg {fmt1(ftToUnit(proximityStats[p], units))}{shortLabel} from hole
                </div>
              )}
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: COLORS.cream }}>{totals[p] || 0}pt</div>
          </div>
        ))}
      </Card>

      <CollapsibleSection title="Round by round — tap a round to amend" count={roundResults.length}>
        {roundResults.map((r, i) => (
          <Card key={i} style={{ marginBottom: 10, cursor: "pointer" }} onClick={() => onStartEdit(i)}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
              ROUND {i + 1} · {LIE_LABELS[r.lie]} · {ydsToUnitRound(r.target, units)}
              {longUnitLabel(units)}
            </div>
            {[...r.standings]
              .sort((a, b) => (a.rank || 99) - (b.rank || 99))
              .map((s) => (
                <div key={s.player} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.cream }}>
                  <div>
                    {s.rank ? `${s.rank}.` : ""} {s.player}
                  </div>
                  <div style={{ color: s.points > 0 ? COLORS.fairwayLight : COLORS.creamDim }}>+{s.points}</div>
                </div>
              ))}
          </Card>
        ))}
      </CollapsibleSection>

      {editingIndex !== null && (
        <CompeteRoundEditModal
          round={roundResults[editingIndex]}
          players={players}
          mode={mode}
          units={units}
          valueKind="ft"
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}

      <button
        onClick={onNewCompetition}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW COMPETITION
      </button>
    </div>
  );
}

// ===== Compete (Putting) screens — tally of putts, SG shown only at the end =====

function PuttingCompeteSetupScreen({
  players,
  onUpdatePlayerName,
  onAddPlayer,
  onRemovePlayer,
  holes,
  setHoles,
  minFt,
  maxFt,
  setMinFt,
  setMaxFt,
  onStart,
  units,
  history,
  loaded,
  onDeleteSession,
}) {
  const validCount = players.map((p) => p.trim()).filter(Boolean).length;
  const invalidRange = minFt >= maxFt || minFt < 3;
  const canStart = validCount >= 2 && !invalidRange;
  const unitLabel = shortUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>COMPETE — PUTTING</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          2 to 4 players, fewest putts wins
        </div>
      </div>

      <Card>
        <SectionLabel>Players</SectionLabel>
        <div style={{ marginTop: 8 }}>
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={p}
                onChange={(e) => onUpdatePlayerName(i, e.target.value)}
                placeholder={`Player ${i + 1}`}
                style={{
                  flex: 1,
                  background: COLORS.turfDark,
                  border: `1px solid ${COLORS.creamDim}33`,
                  borderRadius: 8,
                  color: COLORS.cream,
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                  padding: "10px 12px",
                  boxSizing: "border-box",
                }}
              />
              {players.length > 2 && (
                <div
                  onClick={() => onRemovePlayer(i)}
                  style={{ color: COLORS.creamDim, fontSize: 20, cursor: "pointer", padding: "0 6px", display: "flex", alignItems: "center" }}
                >
                  ×
                </div>
              )}
            </div>
          ))}
        </div>
        {players.length < 4 && (
          <div
            onClick={onAddPlayer}
            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            + ADD PLAYER
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Holes</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[9, 18, 27].map((n) => (
            <PillOption key={n} label={n} active={holes === n} onClick={() => setHoles(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>
          Distance window ({unitLabel}, {ftToUnitRound(3, units)}
          {unitLabel} min)
        </SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField label="MIN" value={ftToUnitRound(minFt, units)} onChange={(v) => setMinFt(unitToFtRound(v, units))} />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField label="MAX" value={ftToUnitRound(maxFt, units)} onChange={(v) => setMaxFt(unitToFtRound(v, units))} />
        </div>
        {invalidRange && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Min can't go below {ftToUnitRound(3, units)}
            {unitLabel}, and max must be greater than min.
          </div>
        )}
      </Card>

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 10, lineHeight: 1.5 }}>
        Same target distance for everyone each hole. Enter how many putts each player took — fewest
        total putts across all holes wins. Strokes gained (vs PGA Tour) for each player shows up at
        the end.
      </div>

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START COMPETITION
      </button>

      {loaded && history.length > 0 && (
        <CollapsibleSection title="Past competitions" count={history.length}>
          {history.map((s) => {
            const tallies = computePuttCompeteTallies(s.players, s.holes);
            const winner = Object.entries(tallies).sort((a, b) => a[1] - b[1])[0];
            return (
              <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                <Card style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                    {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {"  ·  "}
                    {s.players.join(", ")} · {s.holes.length} holes
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, marginTop: 6, color: COLORS.sand }}>
                    ★ {winner ? winner[0] : "—"} won ({winner ? winner[1] : "—"} putts)
                  </div>
                </Card>
              </SwipeToDelete>
            );
          })}
        </CollapsibleSection>
      )}
    </div>
  );
}

function PuttingCompetePlayScreen({
  players,
  holeResults,
  totalHoles,
  target,
  currentPlayerIdx,
  holeComplete,
  onSubmitStrokes,
  onNextHole,
  onExitEarly,
  units,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}) {
  const holeNumber = holeResults.length + 1;
  const isLastHole = holeResults.length >= totalHoles;
  const unitLabel = shortUnitLabel(units);
  const tallies = computePuttCompeteTallies(players, holeResults);
  const leaderboard = [...players].sort((a, b) => (tallies[a] || 0) - (tallies[b] || 0)); // fewer putts is better
  const lastHole = holeResults[holeResults.length - 1];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          HOLE {Math.min(holeNumber, totalHoles)} OF {totalHoles}
        </div>
        <div
          onClick={onExitEarly}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          END COMPETITION
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
        {leaderboard.map((p, i) => (
          <div
            key={p}
            style={{
              flex: "0 0 auto",
              padding: "6px 12px",
              borderRadius: 8,
              background: i === 0 && holeResults.length > 0 ? `${COLORS.fairway}88` : COLORS.turf,
              border: `1px solid ${COLORS.creamDim}22`,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.cream,
              whiteSpace: "nowrap",
            }}
          >
            {i === 0 && holeResults.length > 0 ? "★ " : ""}
            {p} · {tallies[p] || 0} putts
          </div>
        ))}
      </div>

      {!holeComplete ? (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              DISTANCE
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag }}>
              {ftToUnitRound(target, units)}
              <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, marginBottom: 8 }}>
              NOW PUTTING: {players[currentPlayerIdx]?.toUpperCase()}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
              PUTTS TAKEN
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => onSubmitStrokes(n)}
                  style={{
                    flex: 1,
                    padding: "14px 0",
                    borderRadius: 10,
                    border: `2px solid ${ragColor(ragStatusForPutts(n))}`,
                    background: "transparent",
                    color: COLORS.cream,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 22,
                    cursor: "pointer",
                  }}
                >
                  {n === 4 ? "4+" : n}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
              Player {currentPlayerIdx + 1} of {players.length} this hole
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
              HOLE {Math.min(holeNumber, totalHoles)} COMPLETE
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            {lastHole &&
              [...lastHole.putts]
                .sort((a, b) => a.strokes - b.strokes)
                .map((e, i) => (
                  <div
                    key={e.player}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "7px 0",
                      borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      color: COLORS.cream,
                    }}
                  >
                    <div>{e.player}</div>
                    <div>{e.strokes} putt{e.strokes === 1 ? "" : "s"}</div>
                  </div>
                ))}
          </div>
          <button
            onClick={onNextHole}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: COLORS.flag,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            {isLastHole ? "FINISH COMPETITION" : "NEXT HOLE"}
          </button>
        </Card>
      )}

      {holeResults.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, letterSpacing: 1, marginBottom: 6 }}>
            PAST HOLES — TAP TO AMEND
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {holeResults.map((h, i) => (
              <div
                key={i}
                onClick={() => onStartEdit(i)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: COLORS.turf,
                  border: `1px solid ${COLORS.creamDim}22`,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.cream }}>
                  Hole {i + 1} · {ftToUnitRound(h.target, units)}
                  {unitLabel} ·{" "}
                  {h.putts.map((e) => `${e.player} ${e.strokes}`).join(", ")}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.sand }}>EDIT</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingIndex !== null && (
        <PuttingCompeteHoleEditModal
          hole={holeResults[editingIndex]}
          players={players}
          units={units}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}
    </div>
  );
}

function PuttingCompeteSummaryScreen({
  players,
  holeResults,
  units,
  onNewCompetition,
  editingIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}) {
  const tallies = computePuttCompeteTallies(players, holeResults);
  const leaderboard = [...players].sort((a, b) => (tallies[a] || 0) - (tallies[b] || 0));
  const bestTally = tallies[leaderboard[0]] || 0;
  const unitLabel = shortUnitLabel(units);

  // Strokes gained here is always PGA Tour baseline specifically, regardless of whatever
  // handicap baseline is selected in Settings — this is the one explicit exception in the app.
  const sgStats = {};
  players.forEach((p) => {
    let totalSG = 0;
    let count = 0;
    holeResults.forEach((h) => {
      const entry = h.putts.find((e) => e.player === p);
      if (entry) {
        totalSG += sgForPuttTourOnly(h.target, entry.strokes);
        count++;
      }
    });
    sgStats[p] = count ? { total: totalSG, avg: totalSG / count } : null;
  });

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            COMPETITION COMPLETE — {holeResults.length} HOLES
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
            Strokes gained vs PGA Tour baseline
          </div>
        </div>
        {leaderboard.map((p, i) => (
          <div key={p} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: i === 0 ? COLORS.sand : COLORS.cream }}>
                {i === 0 ? "★ " : ""}
                {p}
              </div>
              {sgStats[p] && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim }}>
                  {formatSG(sgStats[p].total)} total SG · {formatSG(sgStats[p].avg)}/putt
                </div>
              )}
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: COLORS.cream }}>{tallies[p] || 0} putts</div>
          </div>
        ))}
      </Card>

      <CollapsibleSection title="Hole by hole — tap a hole to amend" count={holeResults.length}>
        {holeResults.map((h, i) => (
          <Card key={i} style={{ marginBottom: 10, cursor: "pointer" }} onClick={() => onStartEdit(i)}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
              HOLE {i + 1} · {ftToUnitRound(h.target, units)}
              {unitLabel}
            </div>
            {[...h.putts]
              .sort((a, b) => a.strokes - b.strokes)
              .map((e) => (
                <div key={e.player} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.cream }}>
                  <div>{e.player}</div>
                  <div>{e.strokes}</div>
                </div>
              ))}
          </Card>
        ))}
      </CollapsibleSection>

      {editingIndex !== null && (
        <PuttingCompeteHoleEditModal
          hole={holeResults[editingIndex]}
          players={players}
          units={units}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}

      <button
        onClick={onNewCompetition}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW COMPETITION
      </button>
    </div>
  );
}

// ===== Putting section screens =====

function ShortGameLog({ shots, units, onEditShot }) {
  const yLabel = longUnitLabel(units);
  const shortLabel = shortUnitLabel(units);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ width: 22 }}>#</div>
        <div style={{ width: 60 }}>LIE</div>
        <div style={{ flex: 1 }}>DIST</div>
        <div style={{ width: 55, textAlign: "right" }}>{shortLabel.toUpperCase()}</div>
        <div style={{ width: 50, textAlign: "right" }}>SG</div>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {/* Newest shot first — display order only; original index/number preserved (see ShotLog). */}
        {shots.map((s, i) => i).reverse().map((i) => {
          const s = shots[i];
          const sg = sgForShortGameShot(s.lie, s.target, s.resultFt);
          return (
            <div
              key={i}
              onClick={() => onEditShot && onEditShot(i)}
              style={{
                display: "flex",
                padding: "7px 12px",
                borderTop: `1px solid ${COLORS.creamDim}11`,
                color: COLORS.cream,
                cursor: onEditShot ? "pointer" : "default",
              }}
            >
              <div style={{ width: 22, color: COLORS.creamDim }}>{i + 1}</div>
              <div style={{ width: 60, fontSize: 10, color: COLORS.creamDim }}>{LIE_LABELS[s.lie]}</div>
              <div style={{ flex: 1 }}>
                {ydsToUnitRound(s.target, units)}
                {yLabel}
              </div>
              <div style={{ width: 55, textAlign: "right" }}>
                {fmt1(ftToUnit(s.resultFt, units))}
                {shortLabel}
              </div>
              <div style={{ width: 50, textAlign: "right", color: sgRagColor(sg) }}>{formatSG(sg)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LieToggle({ lie, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 0",
        borderRadius: 10,
        border: active ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
        background: active ? COLORS.fairway : "transparent",
        color: active ? COLORS.cream : COLORS.creamDim,
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 14,
        letterSpacing: 1,
        cursor: "pointer",
      }}
    >
      {LIE_LABELS[lie]}
    </button>
  );
}

function ClubToggle({ club, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 2px",
        borderRadius: 10,
        border: active ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
        background: active ? COLORS.fairway : "transparent",
        color: active ? COLORS.cream : COLORS.creamDim,
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 11,
        letterSpacing: 0.3,
        cursor: "pointer",
        textAlign: "center",
      }}
    >
      {CLUB_LABELS[club]}
    </button>
  );
}

function ShortGameSetupScreen({
  shortShotCount,
  setShortShotCount,
  shortMinYds,
  shortMaxYds,
  setShortMinYds,
  setShortMaxYds,
  shortLies,
  onToggleLie,
  onStart,
  activeSaved,
  onResume,
  onDiscard,
  onViewAnalysis,
  onLoadTestData,
  units,
}) {
  const invalidRange =
    shortMinYds < 5 || shortMaxYds > 40 || shortMinYds >= shortMaxYds || shortLies.length === 0;
  const unitLabel = longUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>SHORT GAME</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Chipping & pitching
        </div>
      </div>

      {activeSaved && (
        <Card style={{ marginBottom: 10, border: `1px solid ${COLORS.sand}66` }}>
          <SectionLabel>Session in progress</SectionLabel>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, marginTop: 3 }}>
            Shot {activeSaved.shortShots.length + 1} of {activeSaved.shortShotCount}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
            {ydsToUnitRound(activeSaved.shortMinYds, units)}-{ydsToUnitRound(activeSaved.shortMaxYds, units)}
            {unitLabel} window
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={onResume}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 8,
                border: "none",
                background: COLORS.sand,
                color: COLORS.turfDark,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              RESUME
            </button>
            <button
              onClick={onDiscard}
              style={{
                padding: "9px 14px",
                borderRadius: 8,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              DISCARD
            </button>
          </div>
        </Card>
      )}

      <Card>
        <SectionLabel>Shots this session</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[9, 18, 27].map((n) => (
            <PillOption key={n} label={n} active={shortShotCount === n} onClick={() => setShortShotCount(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>
          Distance window ({unitLabel}, {ydsToUnitRound(5, units)}-{ydsToUnitRound(40, units)})
        </SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField
            label="MIN"
            value={ydsToUnitRound(shortMinYds, units)}
            onChange={(v) => setShortMinYds(unitToYdsRound(v, units))}
          />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField
            label="MAX"
            value={ydsToUnitRound(shortMaxYds, units)}
            onChange={(v) => setShortMaxYds(unitToYdsRound(v, units))}
          />
        </div>
        {(shortMinYds < 5 || shortMaxYds > 40 || shortMinYds >= shortMaxYds) && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Keep it between {ydsToUnitRound(5, units)} and {ydsToUnitRound(40, units)}
            {unitLabel}, with max greater than min.
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Lies to practice</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <LieToggle lie="fairway" active={shortLies.includes("fairway")} onClick={() => onToggleLie("fairway")} />
          <LieToggle lie="rough" active={shortLies.includes("rough")} onClick={() => onToggleLie("rough")} />
          <LieToggle lie="bunker" active={shortLies.includes("bunker")} onClick={() => onToggleLie("bunker")} />
        </div>
        {shortLies.length === 0 && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Select at least one lie.
          </div>
        )}
      </Card>

      <button
        onClick={onStart}
        disabled={invalidRange}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: invalidRange ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: invalidRange ? "not-allowed" : "pointer",
        }}
      >
        START SESSION
      </button>

      <div
        onClick={onViewAnalysis}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        View short game analysis
      </div>
    </div>
  );
}

function ShortGamePracticeScreen({
  shots,
  shotCount,
  currentShot,
  resultInput,
  setResultInput,
  onSubmit,
  onReroll,
  onExit,
  units,
  editingShotIndex,
  onStartEditShot,
  onSaveEditShot,
  onCancelEditShot,
}) {
  const shotNum = shots.length + 1;
  const liveAvgSG = shots.length ? avg(shots.map((s) => sgForShortGameShot(s.lie, s.target, s.resultFt))) : null;
  const liveAvgFt = shots.length ? avg(shots.map((s) => s.resultFt)) : null;
  const yLabel = longUnitLabel(units);
  const shortLabel = shortUnitLabel(units);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          SHOT {shotNum} OF {shotCount}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          SAVE &amp; EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            {LIE_LABELS[currentShot.lie]}
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag, marginTop: 2 }}>
            {ydsToUnitRound(currentShot.target, units)}
            <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{yLabel}</span>
          </div>
        </div>

        <div
          onClick={onReroll}
          style={{
            textAlign: "center",
            marginTop: 8,
            color: COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          DIFFERENT SHOT
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 5 }}>
            RESULT — {shortLabel.toUpperCase()} FROM HOLE
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              inputMode="decimal"
              value={resultInput}
              onChange={(e) => setResultInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              placeholder="0"
              style={{
                flex: 1,
                background: COLORS.turfDark,
                border: `1px solid ${COLORS.creamDim}33`,
                borderRadius: 8,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 24,
                padding: "7px 12px",
                boxSizing: "border-box",
              }}
            />
            <button
              // Deliberately wrapped, not `onClick={onSubmit}` directly: onSubmit takes an
              // optional overrideFt (used by "Holed it" below to pass 0), and React's onClick
              // otherwise passes the click SyntheticEvent as that first argument — which then
              // fails submitShortGameShot's isNaN(overrideFt) check and silently no-ops. This is
              // why the button looked clickable but never actually logged a shot.
              onClick={() => onSubmit()}
              disabled={resultInput === ""}
              style={{
                padding: "0 18px",
                borderRadius: 8,
                border: "none",
                background: resultInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: resultInput === "" ? "not-allowed" : "pointer",
              }}
            >
              LOG
            </button>
          </div>
          <div
            onClick={() => onSubmit(0)}
            style={{
              textAlign: "center",
              marginTop: 10,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: COLORS.creamDim,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Holed it
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <StatBox
          label="AVG SG / SHOT"
          value={liveAvgSG !== null ? formatSG(liveAvgSG) : "—"}
          valueColor={liveAvgSG !== null ? sgRagColor(liveAvgSG) : COLORS.cream}
        />
        <StatBox
          label={`AVG ${shortLabel.toUpperCase()}`}
          value={liveAvgFt !== null ? `${fmt1(ftToUnit(liveAvgFt, units))}${shortLabel}` : "—"}
        />
      </div>

      {shots.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>This session — tap a shot to amend</SectionLabel>
          <div style={{ marginTop: 4 }}>
            <ShortGameLog shots={shots} units={units} onEditShot={onStartEditShot} />
          </div>
        </div>
      )}

      {editingShotIndex !== null && (
        <ShortGameShotEditModal shot={shots[editingShotIndex]} units={units} onSave={onSaveEditShot} onCancel={onCancelEditShot} />
      )}
    </div>
  );
}

// Lets someone correct a previous Short Game shot — the lie, the target distance, and the
// result distance from the hole are all editable, covering everything that could've been
// mistyped or misremembered at the time.
function ShortGameShotEditModal({ shot, units, onSave, onCancel }) {
  const [lie, setLie] = useState(shot.lie);
  const [targetInput, setTargetInput] = useState(String(fmt1(ydsToUnit(shot.target, units))));
  const [resultInput, setResultInput] = useState(String(fmt1(ftToUnit(shot.resultFt, units))));
  const yLabel = longUnitLabel(units);
  const shortLabel = shortUnitLabel(units);

  function handleSave() {
    const target = unitToYds(parseFloat(targetInput) || 0, units);
    const resultFt = unitToFt(parseFloat(resultInput) || 0, units);
    onSave({ lie, target, resultFt });
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT SHOT
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            LIE
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {Object.keys(LIE_LABELS).map((l) => (
              <button
                key={l}
                onClick={() => setLie(l)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: lie === l ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                  background: lie === l ? COLORS.fairway : "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {LIE_LABELS[l]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            TARGET DISTANCE ({yLabel.toUpperCase()})
          </div>
          <input
            type="number"
            inputMode="decimal"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            style={{
              width: "100%",
              background: COLORS.turfDark,
              border: `1px solid ${COLORS.creamDim}33`,
              borderRadius: 8,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 20,
              padding: "8px 12px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            RESULT ({shortLabel.toUpperCase()} FROM HOLE)
          </div>
          <input
            type="number"
            inputMode="decimal"
            value={resultInput}
            onChange={(e) => setResultInput(e.target.value)}
            style={{
              width: "100%",
              background: COLORS.turfDark,
              border: `1px solid ${COLORS.creamDim}33`,
              borderRadius: 8,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 20,
              padding: "8px 12px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// Historical-session detail + edit view for Short Game. Reuses ShortGameLog for display and the
// same ShortGameShotEditModal used for live-session editing.
function ShortGameSessionDetailModal({ session, units, onEditShot, onClose }) {
  const [editingShotIndex, setEditingShotIndex] = useState(null);
  const sessionAvgSG = avg(session.shots.map((sh) => sgForShortGameShot(sh.lie, sh.target, sh.resultFt)));

  function handleSave(updatedShot) {
    onEditShot(editingShotIndex, updatedShot);
    setEditingShotIndex(null);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 380,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          SESSION DETAIL
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          {new Date(session.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          {"  ·  "}
          {session.shotCount} shots · {session.minYds}-{session.maxYds}y · {session.lies.map((l) => LIE_LABELS[l]).join("/")}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <StatBox label="AVG SG / SHOT" value={formatSG(sessionAvgSG)} valueColor={sgRagColor(sessionAvgSG)} />
          <StatBox label="AVG FT FROM HOLE" value={`${session.avgResultFt.toFixed(1)}ft`} />
        </div>

        <div style={{ marginTop: 16 }}>
          <SectionLabel>Shot by shot — tap a shot to amend</SectionLabel>
          <div style={{ marginTop: 6 }}>
            <ShortGameLog shots={session.shots} units={units} onEditShot={setEditingShotIndex} />
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>

      {editingShotIndex !== null && (
        <div onClick={(e) => e.stopPropagation()}>
          <ShortGameShotEditModal
            shot={session.shots[editingShotIndex]}
            units={units}
            onSave={handleSave}
            onCancel={() => setEditingShotIndex(null)}
          />
        </div>
      )}
    </div>
  );
}

function ShortGameSummaryScreen({ shots, onNewSession, storageError, units, feedback }) {
  const avgResultFt = avg(shots.map((s) => s.resultFt));
  const sgValues = shots.map((s) => ({ ...s, sg: sgForShortGameShot(s.lie, s.target, s.resultFt) }));
  const avgSG = avg(sgValues.map((s) => s.sg));
  const totalSG = sgValues.reduce((a, s) => a + s.sg, 0);
  const best = sgValues.reduce((b, s) => (s.sg > b.sg ? s : b), sgValues[0]);
  const worst = sgValues.reduce((w, s) => (s.sg < w.sg ? s : w), sgValues[0]);
  const shortLabel = shortUnitLabel(units);

  return (
    <div>
      <SessionFeedbackBanner feedback={feedback} />
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            SESSION COMPLETE — {shots.length} SHOTS
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="TOTAL SG" value={formatSG(totalSG)} valueColor={sgRagColor(avgSG)} />
          <StatBox label="AVG SG / SHOT" value={formatSG(avgSG)} valueColor={sgRagColor(avgSG)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox
            label={`AVG ${shortLabel.toUpperCase()} FROM HOLE`}
            value={`${fmt1(ftToUnit(avgResultFt, units))}${shortLabel}`}
          />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <StatBox label="BEST SHOT" value={formatSG(best.sg)} valueColor={sgRagColor(best.sg)} />
          <StatBox label="WORST SHOT" value={formatSG(worst.sg)} valueColor={sgRagColor(worst.sg)} />
        </div>
      </Card>

      <div style={{ marginTop: 10 }}>
        <SectionLabel>Full log</SectionLabel>
        <div style={{ marginTop: 4 }}>
          <ShortGameLog shots={shots} units={units} />
        </div>
      </div>

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this session to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onNewSession}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW SESSION
      </button>
    </div>
  );
}

// Entry point for the whole Putting section — same tile-chooser pattern as RangeChooseScreen
// (THE RANGE) and YardagesChooseScreen: one full-width horizontal tile per option, each with its
// own illustration, stacked vertically. Replaces the old inline 3-button mode-switcher that used
// to live at the top of a single combined setup screen.
function PuttingChooseScreen({ onNavigate }) {
  const options = [
    {
      key: "random",
      label: "RANDOM PRACTICE",
      subtitle: "Random distances in a range you set — track how many you hole",
      screen: "puttingRandomSetup",
      Illustration: PuttingRandomIllustration,
    },
    {
      key: "clock",
      label: "AROUND THE CLOCK",
      subtitle: "One putt from every distance, 3-10ft",
      screen: "puttingClockIntro",
      Illustration: PuttingClockIllustration,
    },
    {
      key: "startline",
      label: "START LINE",
      subtitle: "10 putts through a gate — how many get through clean",
      screen: "puttingStartLineIntro",
      Illustration: PuttingStartLineIllustration,
    },
    {
      key: "pace",
      label: "PACE CONTROL",
      subtitle: "Random distances, scored on proximity to the hole",
      screen: "puttingPaceSetup",
      Illustration: PuttingPaceIllustration,
    },
    {
      key: "course",
      label: "ON COURSE",
      subtitle: "Track a real round, hole by hole — you enter every putt",
      screen: "puttingCourseSetup",
      Illustration: OnCourseIllustration,
    },
  ];
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>PUTTING</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Choose what you're working on
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {options.map((o) => (
          <div
            key={o.key}
            onClick={() => onNavigate(o.screen)}
            style={{
              position: "relative",
              height: 120,
              borderRadius: 14,
              overflow: "hidden",
              cursor: "pointer",
              border: `1px solid ${COLORS.creamDim}22`,
            }}
          >
            <o.Illustration />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(180deg, transparent 20%, ${COLORS.turfDark}dd 100%)`,
              }}
            />
            <div style={{ position: "absolute", left: 12, bottom: 10, right: 12 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 22,
                  letterSpacing: 0.5,
                  lineHeight: 1.05,
                  color: COLORS.cream,
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {o.label}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                {o.subtitle}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PuttingRandomSetupScreen({
  puttCount,
  setPuttCount,
  puttMinFt,
  puttMaxFt,
  setPuttMinFt,
  setPuttMaxFt,
  puttIncludeBreak,
  setPuttIncludeBreak,
  onStart,
  activeSaved,
  onResume,
  onDiscard,
  onViewAnalysis,
  onLoadTestData,
  units,
}) {
  const invalidRange = puttMinFt >= puttMaxFt || puttMinFt < 3;
  const unitLabel = shortUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>
          RANDOM PRACTICE
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Putting
        </div>
      </div>

      {activeSaved && (
        <Card style={{ marginBottom: 10, border: `1px solid ${COLORS.sand}66` }}>
          <SectionLabel>Session in progress</SectionLabel>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, marginTop: 3 }}>
            Putt {activeSaved.putts.length + 1} of {activeSaved.puttCount}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
            {ftToUnitRound(activeSaved.puttMinFt, units)}-{ftToUnitRound(activeSaved.puttMaxFt, units)}
            {unitLabel} window
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={onResume}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 8,
                border: "none",
                background: COLORS.sand,
                color: COLORS.turfDark,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              RESUME
            </button>
            <button
              onClick={onDiscard}
              style={{
                padding: "9px 14px",
                borderRadius: 8,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              DISCARD
            </button>
          </div>
        </Card>
      )}

      <Card>
        <SectionLabel>Putts this session</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {[9, 18, 27].map((n) => (
            <PillOption key={n} label={n} active={puttCount === n} onClick={() => setPuttCount(n)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Distance window ({unitLabel}, {ftToUnitRound(3, units)}{unitLabel} min)</SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
          <NumberField
            label="MIN"
            value={ftToUnitRound(puttMinFt, units)}
            onChange={(v) => setPuttMinFt(unitToFtRound(v, units))}
          />
          <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 12 }}>—</div>
          <NumberField
            label="MAX"
            value={ftToUnitRound(puttMaxFt, units)}
            onChange={(v) => setPuttMaxFt(unitToFtRound(v, units))}
          />
        </div>
        {invalidRange && (
          <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            Min can't go below {ftToUnitRound(3, units)}{unitLabel}, and max must be greater than min.
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Include break?</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4, lineHeight: 1.5 }}>
          Log which way each putt breaks — left to right, straight, or right to left — so Analysis
          can show which break direction you're strongest and weakest on.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <PillOption label="NO" active={!puttIncludeBreak} onClick={() => setPuttIncludeBreak(false)} />
          <PillOption label="YES" active={puttIncludeBreak} onClick={() => setPuttIncludeBreak(true)} />
        </div>
      </Card>

      <button
        onClick={onStart}
        disabled={invalidRange}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: invalidRange ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: invalidRange ? "not-allowed" : "pointer",
        }}
      >
        START SESSION
      </button>

      <div
        onClick={onViewAnalysis}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        View putting analysis
      </div>
    </div>
  );
}

function PuttingCourseSetupScreen({
  onCourseHoles,
  onUpdateCourseHole,
  onFinishOnCourse,
  onClearOnCourse,
  onLoadTestCourseData,
  onViewAnalysis,
  units,
}) {
  const [courseDistanceInput, setCourseDistanceInput] = useState("");
  const courseInputRef = useRef(null);
  const courseCompleted = onCourseHoles.filter(isHoleComplete);
  const courseCompletedWithNumbers = onCourseHoles
    .map((h, i) => ({
      hole: i + 1,
      distanceFt: h.putts[0]?.distanceFt,
      strokes: h.putts.length,
      holedFromFt: h.putts[h.putts.length - 1]?.distanceFt,
      noPutt: h.noPutt || false,
    }))
    .filter((h) => isHoleComplete(onCourseHoles[h.hole - 1]));
  const onCourseInProgress = courseCompleted.length > 0;
  const courseCurrentIndex = onCourseHoles.findIndex((h) => !isHoleComplete(h));
  const lastTouchedIndex = onCourseHoles.reduce((acc, h, i) => (h.putts.length > 0 || h.noPutt ? i : acc), -1);
  const unitLabel = shortUnitLabel(units);

  function recordPutt(made) {
    const val = unitToFt(parseFloat(courseDistanceInput), units);
    if (isNaN(val) || val < 0) return;
    const hole = onCourseHoles[courseCurrentIndex];
    const newPutts = [...hole.putts, { distanceFt: val, made }];
    onUpdateCourseHole(courseCurrentIndex, "putts", newPutts);
    setCourseDistanceInput("");
    // Keep the numeric keypad open between putts rather than making the user tap the field
    // again every time — same fix as Range practice, and just as valuable here since a full
    // round is 18+ separate entries in a row.
    if (courseInputRef.current) courseInputRef.current.focus();
  }

  // Rare case: chipped in from off the green, so there's no putt at all to record for this hole.
  function markNoPutt() {
    onUpdateCourseHole(courseCurrentIndex, "noPutt", true);
    setCourseDistanceInput("");
  }

  // Undoes the single most recent putt entry — whether that's a putt already recorded on the
  // hole currently in progress, the last (made) putt of the hole before it, or a "no putt"
  // chip-in marking — in each case, that hole reopens for continued entry.
  function undoLastPutt() {
    setCourseDistanceInput("");
    if (courseCurrentIndex !== -1 && onCourseHoles[courseCurrentIndex].putts.length > 0) {
      onUpdateCourseHole(courseCurrentIndex, "putts", onCourseHoles[courseCurrentIndex].putts.slice(0, -1));
    } else if (lastTouchedIndex !== -1) {
      const prev = onCourseHoles[lastTouchedIndex];
      if (prev.noPutt) {
        onUpdateCourseHole(lastTouchedIndex, "noPutt", false);
      } else {
        onUpdateCourseHole(lastTouchedIndex, "putts", prev.putts.slice(0, -1));
      }
    }
    if (courseInputRef.current) courseInputRef.current.focus();
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>
            ON COURSE
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
            Putting
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim }}>
          {courseCompleted.length} OF 18 HOLES LOGGED
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {lastTouchedIndex !== -1 && (
            <div
              onClick={undoLastPutt}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: COLORS.sand,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              UNDO LAST PUTT
            </div>
          )}
          {onCourseInProgress && (
            <div
              onClick={onClearOnCourse}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: COLORS.creamDim,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              CLEAR
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        <StatBox
          label="TOTAL SG"
          value={formatSG(
            courseCompletedWithNumbers.filter((h) => !h.noPutt).reduce((a, h) => a + sgForPutt(h.distanceFt, h.strokes), 0)
          )}
          valueColor={sgRagColor(
            courseCompletedWithNumbers.filter((h) => !h.noPutt).length
              ? courseCompletedWithNumbers.filter((h) => !h.noPutt).reduce((a, h) => a + sgForPutt(h.distanceFt, h.strokes), 0) /
                  courseCompletedWithNumbers.filter((h) => !h.noPutt).length
              : 0
          )}
        />
        <StatBox label="TOTAL PUTTS" value={courseCompletedWithNumbers.reduce((a, h) => a + h.strokes, 0)} />
      </div>

      {courseCurrentIndex === -1 ? (
        <Card style={{ textAlign: "center", padding: "22px 16px" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1 }}>
            ALL 18 HOLES LOGGED
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 6 }}>
            Tap Finish Round below to save.
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
            HOLE {courseCurrentIndex + 1} OF 18 · PUTT {onCourseHoles[courseCurrentIndex].putts.length + 1}
          </div>
          <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginTop: 8 }}>
            {onCourseHoles[courseCurrentIndex].putts.length === 0 ? "FIRST PUTT DISTANCE" : "NEXT PUTT DISTANCE"} ({unitLabel.toUpperCase()})
          </div>
          <input
            ref={courseInputRef}
            autoFocus
            type="number"
            inputMode="decimal"
            value={courseDistanceInput}
            onChange={(e) => setCourseDistanceInput(e.target.value)}
            placeholder="0"
            style={{
              width: "100%",
              marginTop: 6,
              background: COLORS.turfDark,
              border: `1px solid ${COLORS.creamDim}33`,
              borderRadius: 8,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 32,
              padding: "8px 14px",
              boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginTop: 12, marginBottom: 6, textAlign: "center" }}>
            DID IT GO IN?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => recordPutt(true)}
              disabled={courseDistanceInput === ""}
              style={{
                flex: 1,
                padding: "16px 0",
                borderRadius: 10,
                border: "none",
                background: courseDistanceInput === "" ? `${COLORS.fairway}66` : COLORS.fairway,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 20,
                letterSpacing: 1,
                cursor: courseDistanceInput === "" ? "not-allowed" : "pointer",
              }}
            >
              MAKE
            </button>
            <button
              onClick={() => recordPutt(false)}
              disabled={courseDistanceInput === ""}
              style={{
                flex: 1,
                padding: "16px 0",
                borderRadius: 10,
                border: `2px solid ${courseDistanceInput === "" ? COLORS.creamDim + "55" : COLORS.flag}`,
                background: "transparent",
                color: courseDistanceInput === "" ? COLORS.creamDim : COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 20,
                letterSpacing: 1,
                cursor: courseDistanceInput === "" ? "not-allowed" : "pointer",
              }}
            >
              MISS
            </button>
          </div>
          {onCourseHoles[courseCurrentIndex].putts.length === 0 && (
            <div
              onClick={markNoPutt}
              style={{
                textAlign: "center",
                marginTop: 10,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: COLORS.creamDim,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              No putt taken (chipped in)
            </div>
          )}
        </Card>
      )}

      <button
        onClick={onFinishOnCourse}
        disabled={courseCompleted.length === 0}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "12px 0",
          borderRadius: 12,
          border: "none",
          background: courseCompleted.length === 0 ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 18,
          letterSpacing: 2,
          cursor: courseCompleted.length === 0 ? "not-allowed" : "pointer",
        }}
      >
        FINISH ROUND
      </button>

      {courseCompletedWithNumbers.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <SectionLabel>This round</SectionLabel>
          <div
            style={{
              marginTop: 6,
              border: `1px solid ${COLORS.creamDim}22`,
              borderRadius: 10,
              overflow: "hidden",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
            }}
          >
            <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
              <div style={{ width: 40 }}>HOLE</div>
              <div style={{ flex: 1 }}>DIST</div>
              <div style={{ width: 55, textAlign: "right" }}>PUTTS</div>
              <div style={{ width: 55, textAlign: "right" }}>SG</div>
            </div>
            {courseCompletedWithNumbers.map((h, i) => {
              if (h.noPutt) {
                return (
                  <div
                    key={h.hole}
                    style={{
                      display: "flex",
                      padding: "7px 12px",
                      borderTop: i > 0 ? `1px solid ${COLORS.creamDim}11` : "none",
                      color: COLORS.creamDim,
                    }}
                  >
                    <div style={{ width: 40, color: COLORS.creamDim }}>{h.hole}</div>
                    <div style={{ flex: 1, fontStyle: "italic" }}>Chipped in</div>
                    <div style={{ width: 55, textAlign: "right" }}>—</div>
                    <div style={{ width: 55, textAlign: "right" }}>—</div>
                  </div>
                );
              }
              const sg = sgForPutt(h.distanceFt, h.strokes);
              return (
                <div
                  key={h.hole}
                  style={{
                    display: "flex",
                    padding: "7px 12px",
                    borderTop: i > 0 ? `1px solid ${COLORS.creamDim}11` : "none",
                    color: COLORS.cream,
                  }}
                >
                  <div style={{ width: 40, color: COLORS.creamDim }}>{h.hole}</div>
                  <div style={{ flex: 1 }}>
                    {fmt1(ftToUnit(h.distanceFt, units))}
                    {unitLabel}
                  </div>
                  <div style={{ width: 55, textAlign: "right", color: ragColor(ragStatusForPutts(h.strokes)) }}>
                    {h.strokes}
                  </div>
                  <div style={{ width: 55, textAlign: "right", color: sgRagColor(sg) }}>{formatSG(sg)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div
        onClick={onViewAnalysis}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        View putting analysis
      </div>
    </div>
  );
}

function PuttingClockIntroScreen({ history, onStart }) {
  const best = history.length ? Math.max(...history.map((s) => s.made)) : null;
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>
          AROUND THE CLOCK
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          One putt from every distance, 3-10ft
        </div>
      </div>

      <Card>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: COLORS.cream, lineHeight: 1.6 }}>
          8 putts laid out around the hole — one from every distance between 3ft and 10ft. Which
          distance sits where gets reshuffled every round, so it's never the same layout twice.
          Tap a distance, say whether you made it, and work your way around until all 8 are done.
        </div>

        {best !== null && (
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <StatBox label="BEST SCORE" value={`${best}/8`} valueColor={best === 8 ? COLORS.fairwayLight : COLORS.cream} />
            <StatBox label="ROUNDS PLAYED" value={history.length} />
          </div>
        )}
      </Card>

      <button
        onClick={onStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        START ROUND
      </button>
    </div>
  );
}

// Radial "clock face" layout: 8 spokes run from a central hole out to 8 balls at 3-10ft, each
// spoke's length scaled to its own distance (10ft reaches furthest) and its angular position
// shuffled every round by startClockRound. Tapping an unanswered spoke opens the made/missed
// prompt for that distance; answering it colors the spoke (green = made, red/orange = missed)
// and, once all 8 are answered, the parent (recordClockPutt) moves on to the summary screen.
function PuttingClockPlayScreen({ putts, pendingIndex, onOpenPutt, onRecordResult, onCancelPrompt, onExit }) {
  const answeredCount = putts.filter((p) => p.strokes !== null).length;
  const madeCount = putts.filter((p) => p.strokes === 1).length;
  const pending = pendingIndex !== null ? putts[pendingIndex] : null;

  const CENTER = 180;
  const R_MIN = 65;
  const R_MAX = 155;
  const MARKER_R = 15;

  function radiusFor(ft) {
    return R_MIN + ((ft - 3) / (10 - 3)) * (R_MAX - R_MIN);
  }
  function pointFor(ft, angleDeg) {
    const r = radiusFor(ft);
    const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 so 0deg points straight up, like 12 o'clock
    return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
  }
  function statusColor(strokes) {
    if (strokes === 1) return COLORS.fairwayLight;
    if (strokes === 2) return COLORS.flag;
    return COLORS.creamDim;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          {answeredCount} OF 8 PUTTS
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          EXIT
        </div>
      </div>

      <Card>
        <svg viewBox={`0 0 ${CENTER * 2} ${CENTER * 2}`} style={{ width: "100%", height: "auto", display: "block" }}>
          <circle cx={CENTER} cy={CENTER} r={R_MAX + 18} fill="none" stroke={`${COLORS.creamDim}22`} strokeDasharray="4 7" />
          {putts.map((p, i) => {
            const { x, y } = pointFor(p.targetFt, p.angleDeg);
            const color = statusColor(p.strokes);
            const answered = p.strokes !== null;
            return (
              <g key={i} onClick={() => onOpenPutt(i)} style={{ cursor: answered ? "default" : "pointer" }}>
                {/* Wide invisible line under the thin visible one — a fat-finger-friendly tap
                    target without visually thickening the spoke itself. */}
                <line x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="transparent" strokeWidth="30" />
                <line
                  x1={CENTER}
                  y1={CENTER}
                  x2={x}
                  y2={y}
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity={answered ? 0.9 : 0.55}
                />
                <circle cx={x} cy={y} r={MARKER_R} fill={COLORS.turf} stroke={color} strokeWidth="3" />
                <text
                  x={x}
                  y={y + 5}
                  textAnchor="middle"
                  fontFamily="'Bebas Neue', sans-serif"
                  fontSize="16"
                  fill={COLORS.cream}
                >
                  {p.targetFt}
                </text>
              </g>
            );
          })}
          {/* Hole + flag, drawn last so it sits on top of every spoke's inner end */}
          <circle cx={CENTER} cy={CENTER} r="11" fill={COLORS.turfDark} stroke={COLORS.cream} strokeWidth="1.5" />
          <line x1={CENTER} y1={CENTER - 2} x2={CENTER + 18} y2={CENTER - 24} stroke={COLORS.cream} strokeWidth="2" opacity="0.75" />
          <polygon points={`${CENTER + 18},${CENTER - 24} ${CENTER + 30},${CENTER - 20} ${CENTER + 18},${CENTER - 14}`} fill={COLORS.flag} opacity="0.9" />
        </svg>
      </Card>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <StatBox
          label="MADE"
          value={`${madeCount}/${answeredCount}`}
          valueColor={answeredCount > 0 && madeCount === answeredCount ? COLORS.fairwayLight : COLORS.cream}
        />
        <StatBox label="REMAINING" value={8 - answeredCount} />
      </div>

      {pending && (
        <div
          onClick={onCancelPrompt}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,22,15,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: COLORS.turf,
              border: `1px solid ${COLORS.creamDim}33`,
              borderRadius: 14,
              padding: 22,
              maxWidth: 340,
              width: "100%",
              textAlign: "center",
            }}
          >
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, letterSpacing: 2 }}>
              PUTT
            </div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: COLORS.cream, lineHeight: 1 }}>
              {pending.targetFt}FT
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: COLORS.creamDim, marginTop: 6 }}>
              Did you make it?
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                onClick={() => onRecordResult(true)}
                style={{
                  flex: 1,
                  padding: "13px 0",
                  borderRadius: 10,
                  border: "none",
                  background: COLORS.fairway,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 17,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                MADE IT
              </button>
              <button
                onClick={() => onRecordResult(false)}
                style={{
                  flex: 1,
                  padding: "13px 0",
                  borderRadius: 10,
                  border: `2px solid ${COLORS.flag}`,
                  background: "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 17,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                MISSED
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PuttingClockSummaryScreen({ session, onPlayAgain, onExit, storageError, units }) {
  const perfect = session.made === 8;
  const sgList = session.putts.map((p) => sgForPutt(p.targetFt, p.strokes));
  const avgSG = avg(sgList);
  const totalSG = sgList.reduce((a, b) => a + b, 0);

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            {perfect ? "PERFECT ROUND!" : "ROUND COMPLETE"}
          </div>
          <div
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 56,
              lineHeight: 1,
              color: perfect ? COLORS.fairwayLight : COLORS.cream,
              marginTop: 4,
            }}
          >
            {session.made}
            <span style={{ fontSize: 22, color: COLORS.creamDim }}> / 8</span>
          </div>
          {perfect && (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.fairwayLight, marginTop: 4 }}>
              ★ Every putt from 3 to 10ft — clean sweep.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="AVG SG / PUTT" value={formatSG(avgSG)} valueColor={sgRagColor(avgSG)} />
          <StatBox label="TOTAL SG" value={formatSG(totalSG)} valueColor={sgRagColor(avgSG)} />
        </div>
      </Card>

      <div style={{ marginTop: 10 }}>
        <SectionLabel>Putt by putt</SectionLabel>
        <div style={{ marginTop: 4 }}>
          <PuttLog putts={session.putts} units={units} />
        </div>
      </div>

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this round to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onPlayAgain}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        {perfect ? "GO AGAIN" : "PLAY AGAIN"}
      </button>

      <div
        onClick={onExit}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        Back to Putting
      </div>
    </div>
  );
}

// ===== Putting — "Start Line" gate drill screens =====
function PuttingStartLineIntroScreen({ history, onStart }) {
  const best = history.length ? Math.max(...history.map((s) => s.made)) : null;
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>
          START LINE
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          10 putts through a 15in gate
        </div>
      </div>

      <Card>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: COLORS.cream, lineHeight: 1.6 }}>
          Set up a gate about 15 inches wide, 15 inches in front of your putter face — two tees or
          alignment sticks work fine. Hit 10 putts, aiming to roll the ball through the gate
          without touching either side. Play all 10 for real, then come back and enter how many
          got through clean — no need to confirm make or miss one at a time.
        </div>

        {best !== null && (
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <StatBox label="BEST SCORE" value={`${best}/10`} valueColor={best === 10 ? COLORS.fairwayLight : COLORS.cream} />
            <StatBox label="ROUNDS PLAYED" value={history.length} />
          </div>
        )}
      </Card>

      <button
        onClick={onStart}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        START DRILL
      </button>
    </div>
  );
}

function PuttingStartLinePlayScreen({ madeInput, setMadeInput, onSubmit, onExit }) {
  const parsed = parseInt(madeInput, 10);
  const valid = madeInput !== "" && !isNaN(parsed) && parsed >= 0 && parsed <= 10;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          START LINE — 10 PUTTS
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1.5 }}>
            GATE — 15IN WIDE, 15IN AHEAD
          </div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: COLORS.creamDim, marginTop: 8, lineHeight: 1.5 }}>
            Play all 10 putts through the gate, then enter how many got through cleanly.
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontSize: 10,
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: 6,
              textAlign: "center",
              letterSpacing: 1,
            }}
          >
            PUTTS THROUGH THE GATE
          </div>
          <input
            type="number"
            inputMode="numeric"
            value={madeInput}
            onChange={(e) => setMadeInput(e.target.value)}
            placeholder="0"
            autoFocus
            style={{
              width: "100%",
              textAlign: "center",
              background: COLORS.turfDark,
              border: `1px solid ${COLORS.creamDim}33`,
              borderRadius: 10,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 48,
              padding: "10px 12px",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              textAlign: "center",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: COLORS.creamDim,
              marginTop: 6,
            }}
          >
            out of 10
          </div>
        </div>

        <button
          onClick={onSubmit}
          disabled={!valid}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "13px 0",
            borderRadius: 12,
            border: "none",
            background: !valid ? `${COLORS.fairway}66` : COLORS.flag,
            color: COLORS.cream,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 20,
            letterSpacing: 1,
            cursor: !valid ? "not-allowed" : "pointer",
          }}
        >
          SUBMIT SCORE
        </button>
      </Card>
    </div>
  );
}

function PuttingStartLineSummaryScreen({ session, onPlayAgain, onExit, storageError }) {
  const perfect = session.made === session.total;
  const pct = Math.round((session.made / session.total) * 100);

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            {perfect ? "PERFECT SCORE!" : "DRILL COMPLETE"}
          </div>
          <div
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 56,
              lineHeight: 1,
              color: perfect ? COLORS.fairwayLight : COLORS.cream,
              marginTop: 4,
            }}
          >
            {session.made}
            <span style={{ fontSize: 22, color: COLORS.creamDim }}> / {session.total}</span>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, marginTop: 4 }}>
            {pct}% through the gate
          </div>
          {perfect && (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.fairwayLight, marginTop: 4 }}>
              ★ Every putt through clean.
            </div>
          )}
        </div>
      </Card>

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this round to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onPlayAgain}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        {perfect ? "GO AGAIN" : "PLAY AGAIN"}
      </button>

      <div
        onClick={onExit}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        Back to Putting
      </div>
    </div>
  );
}

// ===== Putting — "Pace Control" screens =====
function PuttingPaceSetupScreen({ selectedDistances, onToggleDistance, puttsPerDistance, setPuttsPerDistance, onStart, onViewAnalysis, units }) {
  const canStart = selectedDistances.length > 0;
  const totalPutts = selectedDistances.length * puttsPerDistance;
  const maxPoints = totalPutts * 3;
  const unitLabel = shortUnitLabel(units);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1, lineHeight: 1 }}>
          PACE CONTROL
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Random distances, scored on proximity to the hole
        </div>
      </div>

      <Card>
        <SectionLabel>Distances to include</SectionLabel>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {PACE_DISTANCES_FT.map((ft) => (
            <div
              key={ft}
              onClick={() => onToggleDistance(ft)}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "12px 4px",
                borderRadius: 8,
                border: selectedDistances.includes(ft) ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                background: selectedDistances.includes(ft) ? COLORS.fairway : "transparent",
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 16,
                cursor: "pointer",
              }}
            >
              {ftToUnitRound(ft, units)}
              {unitLabel}
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Putts per distance</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <PillOption label={3} active={puttsPerDistance === 3} onClick={() => setPuttsPerDistance(3)} />
          <PillOption label={5} active={puttsPerDistance === 5} onClick={() => setPuttsPerDistance(5)} />
        </div>
      </Card>

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>Scoring</SectionLabel>
        <div style={{ marginTop: 8 }}>
          {PACE_POINT_OPTIONS.map((o, i) => (
            <div
              key={o.points}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "5px 0",
                borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
              }}
            >
              <span style={{ color: pacePointColor(o.points) }}>{o.label}</span>
              <span style={{ color: COLORS.creamDim }}>{o.radiusLabel}</span>
            </div>
          ))}
        </div>
      </Card>

      {canStart && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 10, textAlign: "center" }}>
          {totalPutts} putt{totalPutts === 1 ? "" : "s"} total · {maxPoints} max points
        </div>
      )}

      <button
        onClick={onStart}
        disabled={!canStart}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: !canStart ? `${COLORS.fairway}66` : COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22,
          letterSpacing: 2,
          cursor: !canStart ? "not-allowed" : "pointer",
        }}
      >
        START DRILL
      </button>
      {!canStart && (
        <div style={{ color: COLORS.creamDim, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}>
          Select at least one distance.
        </div>
      )}

      {onViewAnalysis && (
        <div
          onClick={onViewAnalysis}
          style={{
            textAlign: "center",
            marginTop: 12,
            color: COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          View analysis
        </div>
      )}
    </div>
  );
}

function PuttingPacePlayScreen({ putts, currentIndex, onRecordPoints, onExit, units }) {
  const current = putts[currentIndex];
  const unitLabel = shortUnitLabel(units);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          PUTT {currentIndex + 1} OF {putts.length}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: COLORS.sand, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            PUTT FROM
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.cream, marginTop: 2 }}>
            {ftToUnitRound(current.targetFt, units)}
            <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, textAlign: "center" }}>
            HOW CLOSE DID IT FINISH?
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {PACE_POINT_OPTIONS.map((o) => (
              <button
                key={o.points}
                onClick={() => onRecordPoints(o.points)}
                style={{
                  padding: "16px 4px",
                  borderRadius: 10,
                  border: `2px solid ${pacePointColor(o.points)}`,
                  background: "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 18,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div
            style={{
              marginTop: 10,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: COLORS.creamDim,
              textAlign: "center",
              lineHeight: 1.7,
            }}
          >
            {PACE_POINT_OPTIONS.map((o) => `${o.points} = ${o.radiusLabel}`).join("  ·  ")}
          </div>
        </div>
      </Card>
    </div>
  );
}

function paceRoundStats(session) {
  const pct = session.maxPoints > 0 ? Math.round((session.totalPoints / session.maxPoints) * 100) : 0;
  const avgPoints = session.putts.length ? avg(session.putts.map((p) => p.points || 0)) : 0;
  return { pct, avgPoints };
}

function PaceLog({ putts, units, onEditPoints }) {
  const unitLabel = shortUnitLabel(units);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ flex: 1 }}>#</div>
        <div style={{ flex: 2 }}>DISTANCE</div>
        <div style={{ width: 60, textAlign: "right" }}>PTS</div>
      </div>
      {putts.map((p, i) => (
        <div
          key={i}
          onClick={onEditPoints ? () => onEditPoints(i) : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "7px 12px",
            borderTop: i > 0 ? `1px solid ${COLORS.creamDim}11` : "none",
            color: COLORS.cream,
            cursor: onEditPoints ? "pointer" : "default",
          }}
        >
          <div style={{ flex: 1, color: COLORS.creamDim }}>{i + 1}</div>
          <div style={{ flex: 2 }}>
            {ftToUnitRound(p.targetFt, units)}
            {unitLabel}
          </div>
          <div style={{ width: 60, textAlign: "right", color: pacePointColor(p.points) }}>{p.points ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}

function PuttingPaceSummaryScreen({ session, onPlayAgain, onExit, storageError, units }) {
  const { pct, avgPoints } = paceRoundStats(session);
  const perfect = session.totalPoints === session.maxPoints;
  const unitLabel = shortUnitLabel(units);

  const byDistance = [...new Set(session.putts.map((p) => p.targetFt))]
    .sort((a, b) => a - b)
    .map((ft) => {
      const puttsAtFt = session.putts.filter((p) => p.targetFt === ft);
      return {
        targetFt: ft,
        total: puttsAtFt.reduce((a, p) => a + (p.points || 0), 0),
        max: puttsAtFt.length * 3,
        count: puttsAtFt.length,
      };
    });

  return (
    <div>
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            {perfect ? "PERFECT ROUND!" : "DRILL COMPLETE"}
          </div>
          <div
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 56,
              lineHeight: 1,
              color: perfect ? COLORS.fairwayLight : COLORS.cream,
              marginTop: 4,
            }}
          >
            {session.totalPoints}
            <span style={{ fontSize: 22, color: COLORS.creamDim }}> / {session.maxPoints}</span>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, marginTop: 4 }}>
            {pct}% of max points
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="AVG PTS / PUTT" value={avgPoints.toFixed(1)} valueColor={paceRagColor((avgPoints / 3) * 100)} />
          <StatBox label="PUTTS" value={session.putts.length} />
        </div>
      </Card>

      <div style={{ marginTop: 10 }}>
        <SectionLabel>By distance</SectionLabel>
        <div style={{ marginTop: 6 }}>
          {byDistance.map((b, i) => (
            <div
              key={b.targetFt}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
              }}
            >
              <span style={{ color: COLORS.creamDim }}>
                {ftToUnitRound(b.targetFt, units)}
                {unitLabel} ({b.count} putts)
              </span>
              <span style={{ color: paceRagColor((b.total / b.max) * 100) }}>
                {b.total}/{b.max}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <SectionLabel>Putt by putt</SectionLabel>
        <div style={{ marginTop: 4 }}>
          <PaceLog putts={session.putts} units={units} />
        </div>
      </div>

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this round to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onPlayAgain}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 1,
          cursor: "pointer",
        }}
      >
        {perfect ? "GO AGAIN" : "PLAY AGAIN"}
      </button>

      <div
        onClick={onExit}
        style={{
          textAlign: "center",
          marginTop: 12,
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        Back to Putting
      </div>
    </div>
  );
}

function PuttLog({ putts, units, onEditShot }) {
  const unitLabel = shortUnitLabel(units);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.creamDim}22`,
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
        <div style={{ width: 32 }}>#</div>
        <div style={{ flex: 1 }}>DISTANCE</div>
        <div style={{ width: 55, textAlign: "right" }}>PUTTS</div>
        <div style={{ width: 55, textAlign: "right" }}>SG</div>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {/* Newest putt first — display order only; original index/number preserved (see ShotLog). */}
        {putts.map((p, i) => i).reverse().map((i) => {
          const p = putts[i];
          const sg = sgForPutt(p.targetFt, p.strokes);
          return (
            <div
              key={i}
              onClick={() => onEditShot && onEditShot(i)}
              style={{
                display: "flex",
                padding: "7px 12px",
                borderTop: `1px solid ${COLORS.creamDim}11`,
                color: COLORS.cream,
                cursor: onEditShot ? "pointer" : "default",
              }}
            >
              <div style={{ width: 32, color: COLORS.creamDim }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                {fmt1(ftToUnit(p.targetFt, units))}
                {unitLabel}
                {p.break != null && (
                  <div style={{ fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                    {PUTT_BREAK_LABELS[p.break] || p.break}
                  </div>
                )}
              </div>
              <div style={{ width: 55, textAlign: "right", color: ragColor(ragStatusForPutts(p.strokes)) }}>{p.strokes}</div>
              <div style={{ width: 55, textAlign: "right", color: sgRagColor(sg) }}>{formatSG(sg)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PuttingPracticeScreen({
  putts,
  puttCount,
  currentTarget,
  puttMinFt,
  puttMaxFt,
  includeBreak,
  currentBreak,
  onSetCurrentBreak,
  onSubmit,
  runningAvg,
  onExit,
  units,
  editingShotIndex,
  onStartEditShot,
  onSaveEditShot,
  onCancelEditShot,
}) {
  const puttNum = putts.length + 1;
  const unitLabel = shortUnitLabel(units);
  // When break-tracking is on, require a break to be picked before the putt can be logged — keeps
  // every putt in a break-tracked session actually tagged, rather than silently skippable.
  const canSubmitPutt = !includeBreak || currentBreak != null;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          PUTT {puttNum} OF {puttCount}
        </div>
        <div
          onClick={onExit}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: COLORS.creamDim,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          SAVE &amp; EXIT
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            DISTANCE
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, color: COLORS.flag }}>
            {ftToUnitRound(currentTarget, units)}
            <span style={{ fontSize: 20, marginLeft: 6, color: COLORS.creamDim }}>{unitLabel}</span>
          </div>
        </div>

        <DistanceGauge
          min={ftToUnitRound(puttMinFt, units)}
          max={ftToUnitRound(puttMaxFt, units)}
          target={ftToUnitRound(currentTarget, units)}
          actual={null}
          unit={unitLabel}
        />

        {includeBreak && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>
              BREAK
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {PUTT_BREAK_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => onSetCurrentBreak(o.key)}
                  style={{
                    flex: 1,
                    padding: "10px 2px",
                    borderRadius: 10,
                    border: currentBreak === o.key ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                    background: currentBreak === o.key ? COLORS.fairway : "transparent",
                    color: currentBreak === o.key ? COLORS.cream : COLORS.creamDim,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 12,
                    letterSpacing: 0.3,
                    cursor: "pointer",
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>
            PUTTS TAKEN
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => canSubmitPutt && onSubmit(n)}
                disabled={!canSubmitPutt}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 10,
                  border: `2px solid ${canSubmitPutt ? ragColor(ragStatusForPutts(n)) : COLORS.creamDim + "33"}`,
                  background: "transparent",
                  color: canSubmitPutt ? COLORS.cream : COLORS.creamDim,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 24,
                  cursor: canSubmitPutt ? "pointer" : "not-allowed",
                  opacity: canSubmitPutt ? 1 : 0.6,
                }}
              >
                {n}
              </button>
            ))}
          </div>
          {includeBreak && !canSubmitPutt && (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 6 }}>
              Pick a break direction above first.
            </div>
          )}
        </div>
      </Card>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <StatBox
          label="AVG SG / PUTT"
          value={putts.length ? formatSG(avg(putts.map((p) => sgForPutt(p.targetFt, p.strokes)))) : "—"}
          valueColor={putts.length ? sgRagColor(avg(putts.map((p) => sgForPutt(p.targetFt, p.strokes)))) : COLORS.cream}
        />
        <StatBox label="AVG PUTTS" value={runningAvg.toFixed(2)} />
      </div>

      {putts.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>This session — tap a shot to amend</SectionLabel>
          <div style={{ marginTop: 4 }}>
            <PuttLog putts={putts} units={units} onEditShot={onStartEditShot} />
          </div>
        </div>
      )}

      {editingShotIndex !== null && (
        <PuttShotEditModal shot={putts[editingShotIndex]} units={units} onSave={onSaveEditShot} onCancel={onCancelEditShot} />
      )}
    </div>
  );
}

// Lets someone correct a previous practice putt — both the target distance and strokes taken.
function PuttShotEditModal({ shot, units, onSave, onCancel }) {
  const [targetInput, setTargetInput] = useState(String(fmt1(ftToUnit(shot.targetFt, units))));
  const [strokes, setStrokes] = useState(shot.strokes);
  // Only this putt's own session had break-tracking on if it carries a "break" field at all —
  // older putts, and putts from sessions where the feature was off, simply have no such key.
  const hasBreak = shot.break !== undefined;
  const [breakVal, setBreakVal] = useState(shot.break ?? null);
  const unitLabel = shortUnitLabel(units);

  function handleSave() {
    const targetFt = unitToFt(parseFloat(targetInput) || 0, units);
    onSave({ targetFt, strokes, ...(hasBreak ? { break: breakVal } : {}) });
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT PUTT
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            DISTANCE ({unitLabel.toUpperCase()})
          </div>
          <input
            type="number"
            inputMode="decimal"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            style={{
              width: "100%",
              background: COLORS.turfDark,
              border: `1px solid ${COLORS.creamDim}33`,
              borderRadius: 8,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 20,
              padding: "8px 12px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            PUTTS TAKEN
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setStrokes(n)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 8,
                  border: strokes === n ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                  background: strokes === n ? COLORS.fairway : "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                {n === 4 ? "4+" : n}
              </button>
            ))}
          </div>
        </div>

        {hasBreak && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
              BREAK
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {PUTT_BREAK_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setBreakVal(o.key)}
                  style={{
                    flex: 1,
                    padding: "10px 2px",
                    borderRadius: 8,
                    border: breakVal === o.key ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                    background: breakVal === o.key ? COLORS.fairway : "transparent",
                    color: breakVal === o.key ? COLORS.cream : COLORS.creamDim,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 11,
                    letterSpacing: 0.3,
                    cursor: "pointer",
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// Historical-session detail + edit view for Putting practice sessions. Reuses PuttLog for display
// and the same PuttShotEditModal used for live-session editing.
function PuttingSessionDetailModal({ session, units, onEditShot, onClose }) {
  const [editingShotIndex, setEditingShotIndex] = useState(null);
  const sessionAvgSG = avg(session.putts.map((p) => sgForPutt(p.targetFt, p.strokes)));

  function handleSave(updatedShot) {
    onEditShot(editingShotIndex, updatedShot);
    setEditingShotIndex(null);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 380,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          SESSION DETAIL
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          {new Date(session.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          {"  ·  "}
          {session.puttCount} putts · {session.puttMinFt}-{session.puttMaxFt}ft
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <StatBox label="AVG SG / PUTT" value={formatSG(sessionAvgSG)} valueColor={sgRagColor(sessionAvgSG)} />
          <StatBox label="AVG PUTTS" value={session.avgStrokes.toFixed(2)} />
        </div>

        <div style={{ marginTop: 16 }}>
          <SectionLabel>Putt by putt — tap a putt to amend</SectionLabel>
          <div style={{ marginTop: 6 }}>
            <PuttLog putts={session.putts} units={units} onEditShot={setEditingShotIndex} />
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>

      {editingShotIndex !== null && (
        <div onClick={(e) => e.stopPropagation()}>
          <PuttShotEditModal
            shot={session.putts[editingShotIndex]}
            units={units}
            onSave={handleSave}
            onCancel={() => setEditingShotIndex(null)}
          />
        </div>
      )}
    </div>
  );
}

function PuttingSummaryScreen({ putts, onNewSession, storageError, units, feedback, isOnCourse, chipIns }) {
  const avgStrokes = avg(putts.map((p) => p.strokes));
  const avgSG = avg(putts.map((p) => sgForPutt(p.targetFt, p.strokes)));
  const totalSG = putts.reduce((a, p) => a + sgForPutt(p.targetFt, p.strokes), 0);
  const onePutts = putts.filter((p) => p.strokes <= 1).length;
  const onePuttPct = (onePutts / putts.length) * 100;
  const threePutts = putts.filter((p) => p.strokes >= 3).length;
  const ftMade = putts.reduce((a, p) => {
    if (p.holedFromFt != null) return a + p.holedFromFt;
    return a + (p.strokes === 1 ? p.targetFt : 0);
  }, 0);
  const distMin = Math.min(...putts.map((p) => p.targetFt));
  const distMax = Math.max(...putts.map((p) => p.targetFt));
  const unitLabel = shortUnitLabel(units);

  return (
    <div>
      <SessionFeedbackBanner feedback={feedback} />
      <Card>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2 }}>
            {isOnCourse ? "ROUND COMPLETE" : "SESSION COMPLETE"} — {putts.length} PUTTS · {ftToUnitRound(distMin, units)}-{ftToUnitRound(distMax, units)}
            {unitLabel.toUpperCase()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="TOTAL SG" value={formatSG(totalSG)} valueColor={sgRagColor(avgSG)} />
          <StatBox label="AVG SG / PUTT" value={formatSG(avgSG)} valueColor={sgRagColor(avgSG)} />
        </div>
        {isOnCourse ? (
          <>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="AVG PUTTS" value={avgStrokes.toFixed(2)} />
              <StatBox label="TOTAL PUTTS" value={putts.reduce((a, p) => a + p.strokes, 0)} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="1-PUTTS" value={`${onePutts} (${onePuttPct.toFixed(0)}%)`} valueColor={COLORS.fairwayLight} />
              <StatBox label="3+ PUTTS" value={threePutts} valueColor={threePutts > 0 ? COLORS.flag : COLORS.cream} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="FT MADE" value={`${fmt1(ftToUnit(ftMade, units))}${unitLabel}`} valueColor={COLORS.sand} />
            </div>
            {chipIns > 0 && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 8 }}>
                + {chipIns} hole{chipIns === 1 ? "" : "s"} chipped in, no putt taken
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="AVG PUTTS" value={avgStrokes.toFixed(2)} />
              <StatBox label="1-PUTT %" value={`${onePuttPct.toFixed(0)}%`} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <StatBox label="1-PUTTS" value={onePutts} valueColor={COLORS.fairwayLight} />
              <StatBox label="3+ PUTTS" value={threePutts} valueColor={threePutts > 0 ? COLORS.flag : COLORS.cream} />
            </div>
          </>
        )}
      </Card>

      <div style={{ marginTop: 10 }}>
        <SectionLabel>Full log</SectionLabel>
        <div style={{ marginTop: 4 }}>
          <PuttLog putts={putts} units={units} />
        </div>
      </div>

      {storageError && (
        <div style={{ color: COLORS.flag, fontSize: 11, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          Couldn't save this session to history — it's still shown above.
        </div>
      )}

      <button
        onClick={onNewSession}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.flag,
          color: COLORS.cream,
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 20,
          letterSpacing: 2,
          cursor: "pointer",
        }}
      >
        NEW SESSION
      </button>
    </div>
  );
}

function formatSG(sg) {
  const sign = sg > 0 ? "+" : "";
  return `${sign}${sg.toFixed(2)}`;
}

function CollapsibleSection({ title, count, children }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <SectionLabel>{title}</SectionLabel>
        <div
          onClick={() => setExpanded(!expanded)}
          className="no-print"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: COLORS.sand,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          {expanded ? "COLLAPSE" : `EXPAND (${count})`}
        </div>
      </div>
      {/* Always rendered for print (so a printed report includes full history), just visually hidden on screen until expanded. */}
      <div style={{ marginTop: 8, display: expanded ? "block" : "none" }} className={expanded ? "" : "print-only"}>
        {children}
      </div>
    </div>
  );
}

function SendReportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="no-print"
      style={{
        width: "100%",
        marginTop: 18,
        padding: "13px 0",
        borderRadius: 12,
        border: `1px solid ${COLORS.sand}66`,
        background: "transparent",
        color: COLORS.sand,
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 18,
        letterSpacing: 1.5,
        cursor: "pointer",
      }}
    >
      SEND REPORT
    </button>
  );
}

function PrintHeader({ title, timescale }) {
  const scaleLabel = TIMESCALES.find((t) => t.key === timescale)?.label || "ALL";
  return (
    <div className="print-only" style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24 }}>THE PRACTICE APP</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, marginTop: 2 }}>
        {title} — {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} — Period: {scaleLabel}
      </div>
    </div>
  );
}

// Print flow: rather than relying on window.print() capturing whatever's currently visible,
// this flips a "printMode" flag that makes the component render BOTH Insights and Graphs
// content together (not just whichever tab is selected), waits two animation frames for the
// browser to actually lay that out, then prints. The double-wait matters — Recharts measures its
// own container size to draw a chart, and a chart that was never actually visible on screen
// (e.g. sitting in a display:none block waiting for print) reports zero size and renders blank.
// Making the content genuinely visible first, even briefly, avoids that entirely.
function usePrintMode() {
  const [printMode, setPrintMode] = useState(false);
  useEffect(() => {
    if (!printMode) return;
    let raf2;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.print();
        setPrintMode(false);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [printMode]);
  return [printMode, () => setPrintMode(true)];
}

function DeleteConfirmBar({ onConfirm, onCancel, style }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        borderRadius: 8,
        background: `${COLORS.flag}1a`,
        border: `1px solid ${COLORS.flag}55`,
        ...style,
      }}
    >
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.cream }}>Delete this session?</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onConfirm}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: COLORS.flag,
            color: COLORS.cream,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          DELETE
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}

// Wraps a card-style row so it can be deleted either by tapping the × control or by
// swiping left on touch devices. Either path reveals an inline confirm step —
// nothing is deleted until the person explicitly confirms.
function SwipeToDelete({ onDelete, children, style }) {
  const [confirming, setConfirming] = useState(false);
  const touchStartX = useRef(null);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -40) setConfirming(true);
    touchStartX.current = null;
  }

  if (confirming) {
    return (
      <DeleteConfirmBar
        onConfirm={() => {
          setConfirming(false);
          onDelete();
        }}
        onCancel={() => setConfirming(false)}
        style={{ marginBottom: 12, ...style }}
      />
    );
  }

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={{ position: "relative" }}>
      {children}
      <div
        onClick={() => setConfirming(true)}
        title="Delete"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          width: 20,
          height: 20,
          borderRadius: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: COLORS.creamDim,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ×
      </div>
    </div>
  );
}

// ===== On-course putting tracker =====

function CourseRoundRow({ session, isFirst, onDelete, onView }) {
  const [confirming, setConfirming] = useState(false);
  const touchStartX = useRef(null);
  const stats = courseRoundStats(session);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -40) setConfirming(true);
    touchStartX.current = null;
  }

  if (confirming) {
    return (
      <div style={{ padding: "6px 8px" }}>
        <DeleteConfirmBar
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          onCancel={() => setConfirming(false)}
        />
      </div>
    );
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={onView}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "7px 12px",
        borderTop: isFirst ? "none" : `1px solid ${COLORS.creamDim}11`,
        color: COLORS.cream,
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1.3, color: COLORS.creamDim }}>
        {new Date(session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
      </div>
      <div style={{ width: 60, textAlign: "right", color: sgRagColor(stats.avgSG) }}>{formatSG(stats.totalSG)}</div>
      <div style={{ width: 55, textAlign: "right" }}>{stats.totalPutts}</div>
      <div style={{ width: 60, textAlign: "right" }}>{stats.ftMade}ft</div>
      <div
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        title="Delete"
        style={{
          width: 20,
          textAlign: "right",
          cursor: "pointer",
          color: COLORS.creamDim,
          fontSize: 14,
        }}
      >
        ×
      </div>
    </div>
  );
}

function PuttBucketRow({ bucket }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: COLORS.cream }}>{bucket.label}ft</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          {bucket.count} putts · {bucket.avgStrokes.toFixed(2)} avg
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: sgRagColor(bucket.avgSG) }}>
          {formatSG(bucket.avgSG)}
        </div>
        {bucket.improvement !== null && bucket.improvement !== undefined && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: bucket.improvement > 0 ? COLORS.fairwayLight : COLORS.flag,
            }}
          >
            {bucket.improvement > 0 ? "▲" : "▼"} {Math.abs(bucket.improvement).toFixed(2)} SG
          </div>
        )}
      </div>
    </div>
  );
}

function PuttInsightCard({ title, subtitle, items, emptyText }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, padding: "6px 0" }}>
            {emptyText}
          </div>
        ) : (
          items.map((b, i) => (
            <div key={b.label} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <PuttBucketRow bucket={b} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// Same idea as PuttBucketRow/PuttInsightCard above but for break-of-putt buckets ("Left to right" /
// "Straight" / "Right to left") instead of distance bands — kept separate because PuttBucketRow
// hardcodes a "ft" suffix on its label that doesn't make sense for a break direction.
function PuttBreakBucketRow({ bucket }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: COLORS.cream }}>{bucket.label}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
          {bucket.count} putts · {bucket.avgStrokes.toFixed(2)} avg
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: sgRagColor(bucket.avgSG) }}>
          {formatSG(bucket.avgSG)}
        </div>
      </div>
    </div>
  );
}

function PuttBreakInsightCard({ title, subtitle, items, emptyText }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, padding: "6px 0" }}>
            {emptyText}
          </div>
        ) : (
          items.map((b, i) => (
            <div key={b.breakDir} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
              <PuttBreakBucketRow bucket={b} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function FeetPicker({ min, max, onMin, onMax, onPreset, activePresetLabel }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {FEET_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onPreset(p)}
            style={{
              padding: "7px 11px",
              borderRadius: 8,
              border: activePresetLabel === p.label ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: activePresetLabel === p.label ? COLORS.fairway : "transparent",
              color: activePresetLabel === p.label ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <NumberField label="MIN FT" value={min} onChange={onMin} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", paddingTop: 14 }}>—</div>
        <NumberField label="MAX FT" value={max} onChange={onMax} />
      </div>
    </div>
  );
}

const PUTTING_SUBTABS = [
  { key: "practice", label: "RANDOM" },
  { key: "clock", label: "AROUND THE CLOCK" },
  { key: "startline", label: "START LINE" },
  { key: "pace", label: "PACE CONTROL" },
  { key: "course", label: "ON COURSE" },
];

function PuttingAnalysisHub({
  history,
  loaded,
  onDeleteSession,
  onEditSessionShot,
  clockHistory,
  clockLoaded,
  onDeleteClockSession,
  onEditClockSessionShot,
  startLineHistory,
  startLineLoaded,
  onDeleteStartLineSession,
  onEditStartLineSession,
  paceHistory,
  paceLoaded,
  onDeletePaceSession,
  onEditPacePutt,
  units,
}) {
  const [subTab, setSubTab] = useState("practice"); // practice | clock | startline | pace | course

  const practiceHistory = history.filter((s) => s.type !== "course");
  const courseHistory = history.filter((s) => s.type === "course");

  return (
    <div>
      {/* Five sub-tabs now — wraps to two rows on narrow screens rather than squeezing each
          label unreadably thin. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {PUTTING_SUBTABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            style={{
              flex: "1 1 30%",
              padding: "9px 4px",
              borderRadius: 8,
              border: subTab === t.key ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
              background: subTab === t.key ? COLORS.fairway : "transparent",
              color: subTab === t.key ? COLORS.cream : COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "practice" && (
        <PuttingAnalysisBody
          history={practiceHistory}
          loaded={loaded}
          onDeleteSession={onDeleteSession}
          onEditSessionShot={onEditSessionShot}
          units={units}
        />
      )}
      {subTab === "clock" && (
        <PuttingClockAnalysisBody
          history={clockHistory}
          loaded={clockLoaded}
          onDeleteSession={onDeleteClockSession}
          onEditSessionShot={onEditClockSessionShot}
          units={units}
        />
      )}
      {subTab === "startline" && (
        <PuttingStartLineAnalysisBody
          history={startLineHistory}
          loaded={startLineLoaded}
          onDeleteSession={onDeleteStartLineSession}
          onEditSession={onEditStartLineSession}
        />
      )}
      {subTab === "pace" && (
        <PuttingPaceAnalysisBody
          history={paceHistory}
          loaded={paceLoaded}
          onDeleteSession={onDeletePaceSession}
          onEditPutt={onEditPacePutt}
          units={units}
        />
      )}
      {subTab === "course" && (
        <OnCourseAnalysisBody
          history={courseHistory}
          loaded={loaded}
          onDeleteSession={onDeleteSession}
          onEditSessionShot={onEditSessionShot}
          units={units}
        />
      )}
    </div>
  );
}

function clockRoundStats(session) {
  const sgList = session.putts.map((p) => sgForPutt(p.targetFt, p.strokes));
  return {
    totalSG: sgList.reduce((a, b) => a + b, 0),
    avgSG: avg(sgList),
  };
}

// Around the Clock's own analysis tab — deliberately simpler than PuttingAnalysisBody/
// OnCourseAnalysisBody (no trend chart, no strengths/weaknesses insight cards): a fixed 3-10ft/
// 8-putt drill doesn't vary session to session the way random-distance practice does, so a score
// history plus overall stats covers what's actually useful here.
function PuttingClockAnalysisBody({ history, loaded, onDeleteSession, onEditSessionShot, units }) {
  const [timescale, setTimescale] = useState("all");
  const [selectedRoundId, setSelectedRoundId] = useState(null);
  // Looked up fresh from `history` (rather than kept as a snapshot) so an edit made inside the
  // detail modal is reflected immediately — same pattern as OnCourseAnalysisBody's selectedRound.
  const selectedRound = selectedRoundId ? history.find((s) => s.id === selectedRoundId) : null;

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading rounds…</div>;
  }

  const filtered = filterByTimescale(history, timescale);

  if (filtered.length === 0) {
    return (
      <div>
        <TimescalePicker value={timescale} onChange={setTimescale} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No Around the Clock rounds in this window yet. Play a round to see it here.
        </div>
      </div>
    );
  }

  const statsList = filtered.map(clockRoundStats);
  const bestScore = Math.max(...filtered.map((s) => s.made));
  const avgScore = avg(filtered.map((s) => s.made));
  const avgSG = avg(statsList.map((s) => s.avgSG));
  const perfectRounds = filtered.filter((s) => s.made === 8).length;

  return (
    <div>
      <TimescalePicker value={timescale} onChange={setTimescale} />

      <Card style={{ marginBottom: 14, marginTop: 12 }}>
        <SectionLabel>Overview</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
          One putt from every distance, 3-10ft
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="ROUNDS PLAYED" value={filtered.length} />
          <StatBox label="BEST SCORE" value={`${bestScore}/8`} valueColor={bestScore === 8 ? COLORS.fairwayLight : COLORS.cream} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="AVG SCORE" value={`${avgScore.toFixed(1)}/8`} />
          <StatBox label="AVG SG / PUTT" value={formatSG(avgSG)} valueColor={sgRagColor(avgSG)} />
        </div>
        {perfectRounds > 0 && (
          <div style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.fairwayLight }}>
            ★ {perfectRounds} perfect round{perfectRounds === 1 ? "" : "s"} (8/8)
          </div>
        )}
      </Card>

      <CollapsibleSection title="All rounds" count={filtered.length}>
        <div
          style={{
            border: `1px solid ${COLORS.creamDim}22`,
            borderRadius: 10,
            overflow: "hidden",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
            <div style={{ flex: 1.3 }}>DATE</div>
            <div style={{ width: 55, textAlign: "right" }}>SCORE</div>
            <div style={{ width: 60, textAlign: "right" }}>SG</div>
            <div style={{ width: 20 }} />
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {[...filtered]
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map((s, i) => (
                <ClockRoundRow key={s.id} session={s} isFirst={i === 0} onDelete={() => onDeleteSession(s.id)} onView={() => setSelectedRoundId(s.id)} />
              ))}
          </div>
        </div>
      </CollapsibleSection>

      {selectedRound && (
        <PuttingSessionDetailModal
          session={selectedRound}
          units={units}
          onEditShot={(puttIndex, updated) => onEditSessionShot(selectedRound.id, puttIndex, updated)}
          onClose={() => setSelectedRoundId(null)}
        />
      )}
    </div>
  );
}

function ClockRoundRow({ session, isFirst, onDelete, onView }) {
  const [confirming, setConfirming] = useState(false);
  const touchStartX = useRef(null);
  const stats = clockRoundStats(session);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -40) setConfirming(true);
    touchStartX.current = null;
  }

  if (confirming) {
    return (
      <div style={{ padding: "6px 8px" }}>
        <DeleteConfirmBar
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          onCancel={() => setConfirming(false)}
        />
      </div>
    );
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={onView}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "7px 12px",
        borderTop: isFirst ? "none" : `1px solid ${COLORS.creamDim}11`,
        color: COLORS.cream,
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1.3, color: COLORS.creamDim }}>
        {new Date(session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
      </div>
      <div style={{ width: 55, textAlign: "right", color: session.made === 8 ? COLORS.fairwayLight : COLORS.cream }}>
        {session.made}/8
      </div>
      <div style={{ width: 60, textAlign: "right", color: sgRagColor(stats.avgSG) }}>{formatSG(stats.totalSG)}</div>
      <div
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        title="Delete"
        style={{
          width: 20,
          textAlign: "right",
          cursor: "pointer",
          color: COLORS.creamDim,
          fontSize: 14,
        }}
      >
        ×
      </div>
    </div>
  );
}

// ===== Start Line's own analysis tab — same "simpler than the full trend charts" reasoning as
// Around the Clock: a fixed 10-putt gate drill, score history + overview is what's useful. =====
function StartLineEditModal({ session, onSave, onCancel }) {
  const [madeInput, setMadeInput] = useState(String(session.made));
  const parsed = parseInt(madeInput, 10);
  const valid = madeInput !== "" && !isNaN(parsed) && parsed >= 0 && parsed <= 10;

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT SCORE
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            PUTTS THROUGH THE GATE (OF 10)
          </div>
          <input
            type="number"
            inputMode="numeric"
            value={madeInput}
            onChange={(e) => setMadeInput(e.target.value)}
            autoFocus
            style={{
              width: "100%",
              background: COLORS.turfDark,
              border: `1px solid ${COLORS.creamDim}33`,
              borderRadius: 8,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 24,
              padding: "8px 12px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={() => valid && onSave(parsed)}
            disabled={!valid}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: valid ? COLORS.fairway : `${COLORS.fairway}66`,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: valid ? "pointer" : "not-allowed",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

function StartLineRoundRow({ session, isFirst, onDelete, onEdit }) {
  const [confirming, setConfirming] = useState(false);
  const touchStartX = useRef(null);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -40) setConfirming(true);
    touchStartX.current = null;
  }

  if (confirming) {
    return (
      <div style={{ padding: "6px 8px" }}>
        <DeleteConfirmBar
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          onCancel={() => setConfirming(false)}
        />
      </div>
    );
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={onEdit}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "7px 12px",
        borderTop: isFirst ? "none" : `1px solid ${COLORS.creamDim}11`,
        color: COLORS.cream,
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1.3, color: COLORS.creamDim }}>
        {new Date(session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
      </div>
      <div style={{ flex: 1, textAlign: "right", color: session.made === session.total ? COLORS.fairwayLight : COLORS.cream }}>
        {session.made}/{session.total}
      </div>
      <div
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        title="Delete"
        style={{ width: 20, textAlign: "right", cursor: "pointer", color: COLORS.creamDim, fontSize: 14 }}
      >
        ×
      </div>
    </div>
  );
}

function PuttingStartLineAnalysisBody({ history, loaded, onDeleteSession, onEditSession }) {
  const [timescale, setTimescale] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const editingSession = editingId ? history.find((s) => s.id === editingId) : null;

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading rounds…</div>;
  }

  const filtered = filterByTimescale(history, timescale);

  if (filtered.length === 0) {
    return (
      <div>
        <TimescalePicker value={timescale} onChange={setTimescale} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No Start Line rounds in this window yet. Play the drill to see it here.
        </div>
      </div>
    );
  }

  const bestScore = Math.max(...filtered.map((s) => s.made));
  const avgScore = avg(filtered.map((s) => s.made));
  const perfectRounds = filtered.filter((s) => s.made === s.total).length;
  const trendData = [...filtered]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => ({
      dateLabel: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      made: s.made,
    }));

  return (
    <div>
      <TimescalePicker value={timescale} onChange={setTimescale} />

      <Card style={{ marginBottom: 14, marginTop: 12 }}>
        <SectionLabel>Overview</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
          10 putts through a 15in gate
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="ROUNDS PLAYED" value={filtered.length} />
          <StatBox label="BEST SCORE" value={`${bestScore}/10`} valueColor={bestScore === 10 ? COLORS.fairwayLight : COLORS.cream} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="AVG SCORE" value={`${avgScore.toFixed(1)}/10`} />
          <StatBox label="AVG %" value={`${Math.round((avgScore / 10) * 100)}%`} />
        </div>
        {perfectRounds > 0 && (
          <div style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.fairwayLight }}>
            ★ {perfectRounds} perfect round{perfectRounds === 1 ? "" : "s"} (10/10)
          </div>
        )}
      </Card>

      {trendData.length > 1 && (
        <Card style={{ marginBottom: 14 }}>
          <SectionLabel>Trend</SectionLabel>
          <div style={{ height: 140, marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={`${COLORS.creamDim}22`} />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}
                  axisLine={{ stroke: `${COLORS.creamDim}33` }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 10]}
                  tick={{ fill: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  width={26}
                />
                <Tooltip
                  contentStyle={{
                    background: COLORS.turfDark,
                    border: `1px solid ${COLORS.creamDim}33`,
                    borderRadius: 8,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                  }}
                  labelStyle={{ color: COLORS.creamDim }}
                  itemStyle={{ color: COLORS.cream }}
                />
                <Line type="monotone" dataKey="made" stroke={COLORS.fairwayLight} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <CollapsibleSection title="All rounds" count={filtered.length}>
        <div
          style={{
            border: `1px solid ${COLORS.creamDim}22`,
            borderRadius: 10,
            overflow: "hidden",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
            <div style={{ flex: 1.3 }}>DATE</div>
            <div style={{ flex: 1, textAlign: "right" }}>SCORE</div>
            <div style={{ width: 20 }} />
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {[...filtered]
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map((s, i) => (
                <StartLineRoundRow
                  key={s.id}
                  session={s}
                  isFirst={i === 0}
                  onDelete={() => onDeleteSession(s.id)}
                  onEdit={() => setEditingId(s.id)}
                />
              ))}
          </div>
        </div>
      </CollapsibleSection>

      {editingSession && (
        <StartLineEditModal
          session={editingSession}
          onSave={(newMade) => {
            onEditSession(editingSession.id, newMade);
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

// ===== Pace Control's own analysis tab =====
function PacePuttEditModal({ putt, units, onSave, onCancel }) {
  const [points, setPoints] = useState(putt.points);
  const unitLabel = shortUnitLabel(units);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          EDIT PUTT
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          From {ftToUnitRound(putt.targetFt, units)}
          {unitLabel}
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 6 }}>
            POINTS
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {PACE_POINT_OPTIONS.map((o) => (
              <button
                key={o.points}
                onClick={() => setPoints(o.points)}
                style={{
                  padding: "10px 4px",
                  borderRadius: 8,
                  border: points === o.points ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                  background: points === o.points ? COLORS.fairway : "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: `1px solid ${COLORS.creamDim}33`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={() => onSave(points)}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: COLORS.fairway,
              color: COLORS.cream,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

function PaceRoundRow({ session, isFirst, onDelete, onView }) {
  const [confirming, setConfirming] = useState(false);
  const touchStartX = useRef(null);
  const { pct } = paceRoundStats(session);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -40) setConfirming(true);
    touchStartX.current = null;
  }

  if (confirming) {
    return (
      <div style={{ padding: "6px 8px" }}>
        <DeleteConfirmBar
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          onCancel={() => setConfirming(false)}
        />
      </div>
    );
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={onView}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "7px 12px",
        borderTop: isFirst ? "none" : `1px solid ${COLORS.creamDim}11`,
        color: COLORS.cream,
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1.2, color: COLORS.creamDim }}>
        {new Date(session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
      </div>
      <div style={{ flex: 1.3, color: COLORS.creamDim, fontSize: 11 }}>{session.distances.map((d) => `${d}ft`).join("/")}</div>
      <div style={{ width: 65, textAlign: "right", color: paceRagColor(pct) }}>
        {session.totalPoints}/{session.maxPoints}
      </div>
      <div
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        title="Delete"
        style={{ width: 20, textAlign: "right", cursor: "pointer", color: COLORS.creamDim, fontSize: 14 }}
      >
        ×
      </div>
    </div>
  );
}

// Historical-round detail + edit view for Pace Control rounds. Reuses PaceLog for display and
// PacePuttEditModal for amending an individual putt's points, same pattern as
// PuttingSessionDetailModal/PuttShotEditModal for regular putting practice.
function PaceRoundDetailModal({ session, units, onEditPutt, onClose }) {
  const [editingPuttIndex, setEditingPuttIndex] = useState(null);
  const { pct, avgPoints } = paceRoundStats(session);

  function handleSave(newPoints) {
    onEditPutt(editingPuttIndex, newPoints);
    setEditingPuttIndex(null);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,22,15,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.turf,
          border: `1px solid ${COLORS.creamDim}33`,
          borderRadius: 14,
          padding: 20,
          maxWidth: 380,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1, color: COLORS.cream }}>
          ROUND DETAIL
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
          {new Date(session.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          {"  ·  "}
          {session.distances.map((d) => `${d}ft`).join("/")} · {session.puttsPerDistance}/distance
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <StatBox label="SCORE" value={`${session.totalPoints}/${session.maxPoints}`} valueColor={paceRagColor(pct)} />
          <StatBox label="AVG PTS / PUTT" value={avgPoints.toFixed(1)} />
        </div>

        <div style={{ marginTop: 16 }}>
          <SectionLabel>Putt by putt — tap a putt to amend</SectionLabel>
          <div style={{ marginTop: 6 }}>
            <PaceLog putts={session.putts} units={units} onEditPoints={setEditingPuttIndex} />
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "11px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}33`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>

      {editingPuttIndex !== null && (
        <div onClick={(e) => e.stopPropagation()}>
          <PacePuttEditModal
            putt={session.putts[editingPuttIndex]}
            units={units}
            onSave={handleSave}
            onCancel={() => setEditingPuttIndex(null)}
          />
        </div>
      )}
    </div>
  );
}

function PuttingPaceAnalysisBody({ history, loaded, onDeleteSession, onEditPutt, units }) {
  const [timescale, setTimescale] = useState("all");
  const [selectedRoundId, setSelectedRoundId] = useState(null);
  const selectedRound = selectedRoundId ? history.find((s) => s.id === selectedRoundId) : null;
  const unitLabel = shortUnitLabel(units);

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading rounds…</div>;
  }

  const filtered = filterByTimescale(history, timescale);

  if (filtered.length === 0) {
    return (
      <div>
        <TimescalePicker value={timescale} onChange={setTimescale} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No Pace Control rounds in this window yet. Play the drill to see it here.
        </div>
      </div>
    );
  }

  const totalPoints = filtered.reduce((a, s) => a + s.totalPoints, 0);
  const maxPoints = filtered.reduce((a, s) => a + s.maxPoints, 0);
  const overallPct = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;
  const allPutts = filtered.flatMap((s) => s.putts);
  const avgPointsPerPutt = allPutts.length ? avg(allPutts.map((p) => p.points || 0)) : 0;

  const distanceBuckets = PACE_DISTANCES_FT.map((ft) => {
    const puttsAtFt = allPutts.filter((p) => p.targetFt === ft);
    if (!puttsAtFt.length) return null;
    const total = puttsAtFt.reduce((a, p) => a + (p.points || 0), 0);
    const max = puttsAtFt.length * 3;
    return { targetFt: ft, count: puttsAtFt.length, total, max, pct: Math.round((total / max) * 100) };
  }).filter(Boolean);

  return (
    <div>
      <TimescalePicker value={timescale} onChange={setTimescale} />

      <Card style={{ marginBottom: 14, marginTop: 12 }}>
        <SectionLabel>Overview</SectionLabel>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="ROUNDS PLAYED" value={filtered.length} />
          <StatBox label="OVERALL %" value={`${overallPct}%`} valueColor={paceRagColor(overallPct)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="AVG PTS / PUTT" value={avgPointsPerPutt.toFixed(1)} valueColor={paceRagColor((avgPointsPerPutt / 3) * 100)} />
          <StatBox label="TOTAL PUTTS" value={allPutts.length} />
        </div>
      </Card>

      {distanceBuckets.length > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <SectionLabel>By distance</SectionLabel>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
            Across every round in this window
          </div>
          <div style={{ marginTop: 8 }}>
            {distanceBuckets.map((b, i) => (
              <div
                key={b.targetFt}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none",
                }}
              >
                <div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: COLORS.cream }}>
                    {ftToUnitRound(b.targetFt, units)}
                    {unitLabel}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
                    {b.count} putts
                  </div>
                </div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: paceRagColor(b.pct) }}>
                  {b.total}/{b.max}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <CollapsibleSection title="All rounds" count={filtered.length}>
        <div
          style={{
            border: `1px solid ${COLORS.creamDim}22`,
            borderRadius: 10,
            overflow: "hidden",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
            <div style={{ flex: 1.2 }}>DATE</div>
            <div style={{ flex: 1.3 }}>DISTANCES</div>
            <div style={{ width: 65, textAlign: "right" }}>SCORE</div>
            <div style={{ width: 20 }} />
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {[...filtered]
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map((s, i) => (
                <PaceRoundRow
                  key={s.id}
                  session={s}
                  isFirst={i === 0}
                  onDelete={() => onDeleteSession(s.id)}
                  onView={() => setSelectedRoundId(s.id)}
                />
              ))}
          </div>
        </div>
      </CollapsibleSection>

      {selectedRound && (
        <PaceRoundDetailModal
          session={selectedRound}
          units={units}
          onEditPutt={(puttIndex, newPoints) => onEditPutt(selectedRound.id, puttIndex, newPoints)}
          onClose={() => setSelectedRoundId(null)}
        />
      )}
    </div>
  );
}

function OnCourseAnalysisBody({ history, loaded, onDeleteSession, onEditSessionShot, units }) {
  const [timescale, setTimescale] = useState("all");
  const [printMode, triggerPrint] = usePrintMode();
  const [selectedRoundId, setSelectedRoundId] = useState(null);
  // Looked up fresh from `history` (rather than keeping a snapshot) so the summary modal reflects
  // an edit immediately without needing to be closed and reopened.
  const selectedRound = selectedRoundId ? history.find((s) => s.id === selectedRoundId) : null;

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading rounds…</div>;
  }

  const filtered = filterByTimescale(history, timescale);

  if (filtered.length === 0) {
    return (
      <div>
        <TimescalePicker value={timescale} onChange={setTimescale} />
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No on-course rounds in this window yet. Track a round to see it here.
        </div>
      </div>
    );
  }

  const trend = courseRoundTrendData(filtered);
  const totalPutts = trend.reduce((a, r) => a + r.totalPutts, 0);
  const totalFtMade = trend.reduce((a, r) => a + r.ftMade, 0);
  const totalSG = trend.reduce((a, r) => a + r.totalSG, 0);
  const avgSGPerRound = totalSG / trend.length;
  const avgSGPerPutt = totalSG / totalPutts;
  const analysis = computePuttingAnalysis(filtered);

  return (
    <div>
      <PrintHeader title="Putting Analysis — On Course" timescale={timescale} />
      <TimescalePicker value={timescale} onChange={setTimescale} />

      <Card style={{ marginBottom: 14 }}>
        <SectionLabel>Overview</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
          vs PGA Tour baseline
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="ROUNDS" value={trend.length} />
          <StatBox label="TOTAL PUTTS" value={totalPutts} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="AVG SG / ROUND" value={formatSG(avgSGPerRound)} valueColor={sgRagColor(avgSGPerPutt)} />
          <StatBox label="AVG SG / PUTT" value={formatSG(avgSGPerPutt)} valueColor={sgRagColor(avgSGPerPutt)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="AVG FT MADE / ROUND" value={`${(totalFtMade / trend.length).toFixed(0)}ft`} />
        </div>
        {analysis && (
          <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
            {Math.abs(analysis.trendDelta) < 0.03 ? (
              <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
            ) : analysis.trendDelta > 0 ? (
              <span style={{ color: COLORS.fairwayLight }}>
                ▲ Trending better — SG up {analysis.trendDelta.toFixed(2)} from start to end of period
              </span>
            ) : (
              <span style={{ color: COLORS.flag }}>
                ▼ Trending worse — SG down {Math.abs(analysis.trendDelta).toFixed(2)} from start to end of period
              </span>
            )}
          </div>
        )}
      </Card>

      {analysis && (
        <>
          <PuttInsightCard
            title="Strengths"
            subtitle="Distance bands where you gain the most strokes on the PGA Tour baseline"
            items={analysis.strengths}
            emptyText="Not enough putts in any single band yet."
          />

          <PuttInsightCard
            title="Focus areas"
            subtitle="Distance bands where you lose the most strokes to the PGA Tour baseline"
            items={analysis.weaknesses}
            emptyText="Not enough putts in any single band yet."
          />

          <PuttInsightCard
            title="Biggest improvements"
            subtitle="Bands where strokes gained has risen most from earlier to later rounds"
            items={analysis.mostImproved}
            emptyText="Not enough repeat putts in a single band to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <PuttInsightCard
              title="Slipping"
              subtitle="Bands where strokes gained has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}
        </>
      )}

      <Card style={{ marginBottom: 14 }}>
        <SectionLabel>Strokes gained per round</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Total SG for each round, vs PGA Tour baseline
        </div>
        <div style={{ height: 200, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: `${COLORS.creamDim}33` }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: `${COLORS.creamDim}33` }}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
              <Tooltip content={<ChartTooltip suffix=" SG" />} />
              <Line
                type="monotone"
                dataKey="totalSG"
                stroke={COLORS.flag}
                strokeWidth={2}
                dot={{ fill: COLORS.flag, r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <SectionLabel>Feet of putts made per round</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
          Combined distance of every putt holed
        </div>
        <div style={{ height: 200, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: `${COLORS.creamDim}33` }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: `${COLORS.creamDim}33` }}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip suffix="ft" />} />
              <Bar dataKey="ftMade" radius={[4, 4, 0, 0]} fill={COLORS.sand} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <CollapsibleSection title="All rounds" count={filtered.length}>
        <div
          style={{
            border: `1px solid ${COLORS.creamDim}22`,
            borderRadius: 10,
            overflow: "hidden",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", padding: "8px 12px", background: `${COLORS.turf}aa`, color: COLORS.creamDim }}>
            <div style={{ flex: 1.3 }}>DATE</div>
            <div style={{ width: 60, textAlign: "right" }}>SG</div>
            <div style={{ width: 55, textAlign: "right" }}>PUTTS</div>
            <div style={{ width: 60, textAlign: "right" }}>FT MADE</div>
            <div style={{ width: 20 }} />
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {[...filtered]
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map((s, i) => (
                <CourseRoundRow key={s.id} session={s} isFirst={i === 0} onDelete={() => onDeleteSession(s.id)} onView={() => setSelectedRoundId(s.id)} />
              ))}
          </div>
        </div>
      </CollapsibleSection>

      <SendReportButton onClick={triggerPrint} />

      {selectedRound && (
        <RoundSummaryModal
          session={selectedRound}
          units={units}
          onEditShot={(holeIndex, updatedHole) => onEditSessionShot(selectedRound.id, holeIndex, updatedHole)}
          onClose={() => setSelectedRoundId(null)}
        />
      )}
    </div>
  );
}

function PuttingAnalysisBody({ history, loaded, onDeleteSession, onEditSessionShot, units }) {
  const [tab, setTab] = useState("insights");
  const [printMode, triggerPrint] = usePrintMode();
  const [timescale, setTimescale] = useState("all");
  const [viewingSessionId, setViewingSessionId] = useState(null);
  const viewingSession = viewingSessionId ? history.find((s) => s.id === viewingSessionId) : null;
  const [minFt, setMinFt] = useState(0);
  const [maxFt, setMaxFt] = useState(100);
  const [activePreset, setActivePreset] = useState("All");

  if (!loaded) {
    return <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace" }}>Loading sessions…</div>;
  }

  const filtered = filterByTimescale(history, timescale);
  const analysis = computePuttingAnalysis(filtered);
  const breakAnalysis = computePuttingBreakAnalysis(filtered);
  const trend = puttingSessionTrendData(filtered, minFt, maxFt);
  const graphBuckets = puttingBucketChartData(filtered, minFt, maxFt);
  const hasGraphData = trend.length > 0;

  function handlePreset(p) {
    setActivePreset(p.label);
    setMinFt(p.min);
    setMaxFt(p.max);
  }

  function handleManualChange(setter) {
    return (v) => {
      setActivePreset(null);
      setter(v);
    };
  }

  return (
    <div>
      <PrintHeader title="Putting Analysis — Random" timescale={timescale} />
      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => setTab("insights")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "insights" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "insights" ? COLORS.fairway : "transparent",
            color: tab === "insights" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          INSIGHTS
        </button>
        <button
          onClick={() => setTab("graphs")}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: tab === "graphs" ? `1px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
            background: tab === "graphs" ? COLORS.fairway : "transparent",
            color: tab === "graphs" ? COLORS.cream : COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          GRAPHS
        </button>
      </div>

      <TimescalePicker value={timescale} onChange={setTimescale} />


      {!analysis && (
        <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10 }}>
          No sessions in this window yet. Log a putting session to see your analysis here.
        </div>
      )}

      {analysis && (tab === "insights" || printMode) && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
              vs PGA Tour baseline
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="SESSIONS" value={analysis.sessionCount} />
              <StatBox label="PUTTS" value={analysis.puttCount} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="AVG SG / PUTT" value={formatSG(analysis.overallAvgSG)} valueColor={sgRagColor(analysis.overallAvgSG)} />
              <StatBox label="AVG PUTTS" value={analysis.overallAvgStrokes.toFixed(2)} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <StatBox label="1-PUTT %" value={`${analysis.onePuttPct.toFixed(0)}%`} />
              <StatBox label="3+ PUTT %" value={`${analysis.threePuttPct.toFixed(0)}%`} valueColor={analysis.threePuttPct > 0 ? COLORS.flag : COLORS.cream} />
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              {Math.abs(analysis.trendDelta) < 0.03 ? (
                <span style={{ color: COLORS.creamDim }}>◆ Steady across this period</span>
              ) : analysis.trendDelta > 0 ? (
                <span style={{ color: COLORS.fairwayLight }}>
                  ▲ Trending better — SG up {analysis.trendDelta.toFixed(2)} from start to end of period
                </span>
              ) : (
                <span style={{ color: COLORS.flag }}>
                  ▼ Trending worse — SG down {Math.abs(analysis.trendDelta).toFixed(2)} from start to end of period
                </span>
              )}
            </div>
          </Card>

          <PuttInsightCard
            title="Strengths"
            subtitle="Distance bands where you gain the most strokes on the PGA Tour baseline"
            items={analysis.strengths}
            emptyText="Not enough putts in any single band yet."
          />

          <PuttInsightCard
            title="Focus areas"
            subtitle="Distance bands where you lose the most strokes to the PGA Tour baseline"
            items={analysis.weaknesses}
            emptyText="Not enough putts in any single band yet."
          />

          <PuttInsightCard
            title="Biggest improvements"
            subtitle="Bands where strokes gained has risen most from earlier to later sessions"
            items={analysis.mostImproved}
            emptyText="Not enough repeat putts in a single band to detect a trend yet."
          />

          {analysis.regressing.length > 0 && (
            <PuttInsightCard
              title="Slipping"
              subtitle="Bands where strokes gained has been falling"
              items={analysis.regressing}
              emptyText=""
            />
          )}

          {breakAnalysis && (
            <>
              <PuttBreakInsightCard
                title="Strengths by break"
                subtitle="Which way the putt broke, where you gain the most strokes on the PGA Tour baseline"
                items={breakAnalysis.strengths}
                emptyText="Not enough putts logged with a break direction yet."
              />

              <PuttBreakInsightCard
                title="Focus areas by break"
                subtitle="Which way the putt broke, where you lose the most strokes to the PGA Tour baseline"
                items={breakAnalysis.weaknesses}
                emptyText="Not enough putts logged with a break direction yet."
              />
            </>
          )}

          <CollapsibleSection title="All sessions" count={filtered.length}>
            {filtered.length === 0 ? (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim }}>
                No sessions in this window.
              </div>
            ) : (
              filtered.map((s) => {
                const sessionAvgSG = avg(s.putts.map((p) => sgForPutt(p.targetFt, p.strokes)));
                return (
                  <SwipeToDelete key={s.id} onDelete={() => onDeleteSession(s.id)}>
                    <Card style={{ marginBottom: 12, cursor: "pointer" }} onClick={() => setViewingSessionId(s.id)}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, paddingRight: 20 }}>
                        {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        {"  ·  "}
                        {s.puttCount} putts · {s.puttMinFt}-{s.puttMaxFt}ft
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                        <StatBox label="AVG SG / PUTT" value={formatSG(sessionAvgSG)} valueColor={sgRagColor(sessionAvgSG)} />
                        <StatBox label="AVG PUTTS" value={s.avgStrokes.toFixed(2)} />
                      </div>
                    </Card>
                  </SwipeToDelete>
                );
              })
            )}
          </CollapsibleSection>

          {viewingSession && (
            <PuttingSessionDetailModal
              session={viewingSession}
              units={units}
              onEditShot={(shotIndex, updatedShot) => onEditSessionShot(viewingSession.id, shotIndex, updatedShot)}
              onClose={() => setViewingSessionId(null)}
            />
          )}
        </>
      )}

      {analysis && (tab === "graphs" || printMode) && (
        <div>
          <FeetPicker
            min={minFt}
            max={maxFt}
            onMin={handleManualChange(setMinFt)}
            onMax={handleManualChange(setMaxFt)}
            onPreset={handlePreset}
            activePresetLabel={activePreset}
          />

          {!hasGraphData && (
            <div style={{ color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
              No putts match this timescale + distance combination yet.
            </div>
          )}

          {hasGraphData && (
            <>
              <Card style={{ marginBottom: 14 }}>
                <SectionLabel>Strokes gained over time</SectionLabel>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
                  Average SG per putt per session, vs PGA Tour baseline, {minFt}-{maxFt}ft putts only
                </div>
                <div style={{ height: 200, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                      <Tooltip content={<ChartTooltip suffix=" SG" />} />
                      <Line
                        type="monotone"
                        dataKey="avgSG"
                        stroke={COLORS.flag}
                        strokeWidth={2}
                        dot={{ fill: COLORS.flag, r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <SectionLabel>Strokes gained by distance band</SectionLabel>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
                  Bands within {minFt}-{maxFt}ft, this timescale
                </div>
                <div style={{ height: 220, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={graphBuckets} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={`${COLORS.creamDim}22`} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: COLORS.creamDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: `${COLORS.creamDim}33` }}
                        tickLine={false}
                      />
                      <ReferenceLine y={0} stroke={COLORS.creamDim} strokeDasharray="3 3" strokeOpacity={0.5} />
                      <Tooltip content={<ChartTooltip suffix=" SG" />} />
                      <Bar dataKey="avgSG" radius={[4, 4, 0, 0]}>
                        {graphBuckets.map((b, i) => (
                          <Cell key={i} fill={sgRagColor(b.avgSG)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    marginTop: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: COLORS.creamDim,
                  }}
                >
                  <span>
                    <span style={{ color: COLORS.fairwayLight }}>●</span> ≥0 (tour avg or better)
                  </span>
                  <span>
                    <span style={{ color: COLORS.sand }}>●</span> ≥-0.15
                  </span>
                  <span>
                    <span style={{ color: COLORS.flag }}>●</span> &lt;-0.15
                  </span>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      <SendReportButton onClick={triggerPrint} />
    </div>
  );
}

function InfoToggle({ label, text }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: COLORS.sand,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
          display: "inline-block",
        }}
      >
        ⓘ {label}
      </div>
      {open && (
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: COLORS.creamDim,
            marginTop: 6,
            lineHeight: 1.6,
            background: COLORS.turfDark,
            border: `1px solid ${COLORS.creamDim}22`,
            borderRadius: 8,
            padding: 10,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

const BASELINE_SKILL_ORDER = ["tour", "scratch", "5", "10", "15", "20", "25", "30"]; // best to worst

function suggestBaselineFromHandicap(handicap) {
  const n = parseFloat(handicap);
  if (isNaN(n)) return "tour";
  let natural;
  if (n <= 0) natural = "scratch";
  else if (n <= 7) natural = "5";
  else if (n <= 12) natural = "10";
  else if (n <= 17) natural = "15";
  else if (n <= 22) natural = "20";
  else if (n <= 27) natural = "25";
  else natural = "30";
  // Suggest the next tier up from where the handicap actually sits — a small aspirational nudge
  // rather than a dead-on match. Clamped at "tour" for scratch/plus players since there's nothing better.
  const idx = BASELINE_SKILL_ORDER.indexOf(natural);
  return BASELINE_SKILL_ORDER[Math.max(0, idx - 1)];
}

export function ProfileSetupWizard({ onComplete }) {
  const [step, setStep] = useState("name"); // name | handicap | device | device-method | baseline
  const [name, setName] = useState("");
  const [handicap, setHandicap] = useState("");
  const [device, setDevice] = useState(null); // "yes" | "no"
  const [deviceMethod, setDeviceMethod] = useState(null); // "distance" | "rating"
  const [baseline, setBaseline] = useState("tour");

  function handleNameNext() {
    if (!name.trim()) return;
    setStep("handicap");
  }

  function handleHandicapNext() {
    setBaseline(suggestBaselineFromHandicap(handicap));
    setStep("device");
  }

  function handleDeviceYes() {
    setDevice("yes");
    setStep("baseline");
  }

  function handleDeviceNo() {
    setDevice("no");
    setStep("device-method");
  }

  function handleDeviceMethod(method) {
    setDeviceMethod(method);
    setStep("baseline");
  }

  function handleBaselineConfirm() {
    const rangeTrackingMode = device === "yes" ? "distance" : deviceMethod;
    onComplete({
      name,
      handicap: handicap.trim() === "" ? null : handicap,
      rangeTrackingMode,
      baselineHandicap: baseline,
    });
  }

  const cardStyle = { maxWidth: 420, margin: "0 auto" };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.turfDark,
        color: COLORS.cream,
        padding: "40px 16px",
        boxSizing: "border-box",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <style>{FONT_IMPORT}</style>
      <div style={cardStyle}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginBottom: 14 }}>
          {{ name: "STEP 1 OF 4", handicap: "STEP 2 OF 4", device: "STEP 3 OF 4", "device-method": "STEP 3 OF 4", baseline: "STEP 4 OF 4" }[step]}
        </div>

        {step === "name" && (
          <Card>
            <SectionLabel>What's your name?</SectionLabel>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleNameNext()}
              placeholder="Your name"
              autoFocus
              style={{
                width: "100%",
                marginTop: 10,
                background: COLORS.turfDark,
                border: `1px solid ${COLORS.creamDim}33`,
                borderRadius: 8,
                color: COLORS.cream,
                fontFamily: "'Inter', sans-serif",
                fontSize: 16,
                padding: "10px 12px",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={handleNameNext}
              disabled={!name.trim()}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: !name.trim() ? `${COLORS.fairway}66` : COLORS.fairway,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: !name.trim() ? "not-allowed" : "pointer",
              }}
            >
              CONTINUE
            </button>
          </Card>
        )}

        {step === "handicap" && (
          <Card>
            <SectionLabel>What's your handicap?</SectionLabel>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 4 }}>
              Helps suggest a sensible starting point on the next screen — you can leave this blank.
            </div>
            <input
              type="number"
              inputMode="decimal"
              value={handicap}
              onChange={(e) => setHandicap(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleHandicapNext()}
              placeholder="e.g. 14"
              autoFocus
              style={{
                width: "100%",
                marginTop: 10,
                background: COLORS.turfDark,
                border: `1px solid ${COLORS.creamDim}33`,
                borderRadius: 8,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 20,
                padding: "10px 12px",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={handleHandicapNext}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: COLORS.fairway,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              {handicap.trim() ? "CONTINUE" : "SKIP — I DON'T TRACK ONE"}
            </button>
          </Card>
        )}

        {step === "device" && (
          <Card>
            <SectionLabel>Setup</SectionLabel>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
              Do you have access to a launch monitor or distance measuring device?
            </div>
            <InfoToggle
              label="What counts?"
              text="This can also include range tracking facilities such as TopTracer or Trackman Range."
            />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                onClick={handleDeviceYes}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 10,
                  border: "none",
                  background: COLORS.flag,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 18,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                YES
              </button>
              <button
                onClick={handleDeviceNo}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.creamDim}33`,
                  background: "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 18,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                NO
              </button>
            </div>
          </Card>
        )}

        {step === "device-method" && (
          <Card>
            <SectionLabel>No device? No problem</SectionLabel>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
              Would you still like to enter a distance for each shot (paced off or estimated), or rate
              your own strike out of 5 instead?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              <button
                onClick={() => handleDeviceMethod("distance")}
                style={{
                  padding: "12px 0",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.creamDim}33`,
                  background: "transparent",
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                ENTER A DISTANCE
              </button>
              <button
                onClick={() => handleDeviceMethod("rating")}
                style={{
                  padding: "12px 0",
                  borderRadius: 10,
                  border: "none",
                  background: COLORS.flag,
                  color: COLORS.cream,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  letterSpacing: 1,
                  cursor: "pointer",
                }}
              >
                RATE EACH SHOT OUT OF 5
              </button>
            </div>
            <div
              onClick={() => setStep("device")}
              style={{
                textAlign: "center",
                marginTop: 12,
                color: COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              BACK
            </div>
          </Card>
        )}

        {step === "baseline" && (
          <Card>
            <SectionLabel>Choose your strokes gained baseline</SectionLabel>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, marginTop: 8, lineHeight: 1.5 }}>
              Every shot you log gets compared to this skill level.
            </div>
            <InfoToggle
              label="What's this?"
              text="Strokes gained measures each shot against how a player at your chosen level would be expected to do from the same spot. Pick PGA Tour to compare yourself against professionals, or a handicap level to compare against golfers closer to your own game — your numbers will look very different depending on which you pick, but neither is 'more correct,' just a different yardstick."
            />
            {handicap.trim() && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.sand, marginTop: 10 }}>
                Based on the handicap you entered, we've suggested {BASELINE_OPTIONS.find((b) => b.key === baseline)?.label} below — tap any option to change it, then confirm.
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 14 }}>
              {BASELINE_OPTIONS.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setBaseline(b.key)}
                  style={{
                    padding: "9px 2px",
                    borderRadius: 8,
                    border: baseline === b.key ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                    background: baseline === b.key ? COLORS.fairway : "transparent",
                    color: baseline === b.key ? COLORS.cream : COLORS.creamDim,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    letterSpacing: 0.3,
                    cursor: "pointer",
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleBaselineConfirm}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                background: COLORS.flag,
                color: COLORS.cream,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 18,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              CONFIRM — {BASELINE_OPTIONS.find((b) => b.key === baseline)?.label}
            </button>
          </Card>
        )}

        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 12, lineHeight: 1.5 }}>
          Everything here can be changed later in Settings.
        </div>
      </div>
    </div>
  );
}
