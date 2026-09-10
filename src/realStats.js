// Real, Firestore-backed player statistics for the Coach app's player-stat screens — replaces
// the fabricated buildSampleStats() numbers with the SAME strokes-gained math the player app
// itself uses, run over that player's actual session data.
//
// Every formula below (baseline tables, interpolation, sgFor* functions, bucket grouping, trend
// calculation) is copied verbatim from the player app's App.jsx so a player and their coach see
// identical numbers for identical data. The player app supports a per-player adjustable baseline
// (Settings > Baseline); the Coach app intentionally always measures against the PGA Tour baseline
// (see BASELINE_LABEL in CoachApp.jsx) regardless of what the player has set for themselves, so
// every player's numbers stay on the same footing — that's why there's no "currentOffsets" here,
// only the fixed tour tables.
import { useEffect, useState } from "react";
import { loadPlayerAppData } from "./storage.js";

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ===== PGA Tour putting baseline — see App.jsx for the full source citation =====
const PGA_PUTTING_BASELINE = [
  [2, 1.01], [3, 1.05], [4, 1.14], [5, 1.24], [6, 1.34], [7, 1.43], [8, 1.5], [9, 1.56],
  [10, 1.61], [15, 1.78], [20, 1.87], [30, 1.98], [40, 2.06], [50, 2.14], [60, 2.21], [90, 2.36],
];
function pgaBaselinePutts(ft) {
  const table = PGA_PUTTING_BASELINE;
  if (ft <= 0) return 1.0;
  const [firstD, firstP] = table[0];
  if (ft <= firstD) {
    const t = ft / firstD;
    return 1.0 + t * (firstP - 1.0);
  }
  const [lastD, lastP] = table[table.length - 1];
  if (ft >= lastD) {
    const [prevD, prevP] = table[table.length - 2];
    const t = (Math.log(ft) - Math.log(prevD)) / (Math.log(lastD) - Math.log(prevD));
    return prevP + t * (lastP - prevP);
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
function sgForPutt(targetFt, strokes) {
  return pgaBaselinePutts(targetFt) - strokes;
}

// ===== PGA Tour approach-shot baselines (fairway/rough/sand) — see App.jsx for source =====
const FAIRWAY_APPROACH_BASELINE = [[20, 2.4], [80, 2.75], [100, 2.8], [160, 2.85], [180, 3.08], [200, 3.19]];
const ROUGH_APPROACH_BASELINE = [[20, 2.59], [80, 2.96], [100, 3.02], [160, 3.08], [180, 3.31], [200, 3.42]];
const SAND_APPROACH_BASELINE = [[20, 2.53], [80, 3.24], [100, 3.23], [160, 3.21], [180, 3.4], [200, 3.55]];

function interpolateBaseline(table, x) {
  if (x <= 0) return 1.0;
  const [firstD, firstP] = table[0];
  if (x <= firstD) {
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
function pgaBaselineApproach(yds) {
  return interpolateBaseline(FAIRWAY_APPROACH_BASELINE, yds);
}
function pgaBaselineRough(yds) {
  return interpolateBaseline(ROUGH_APPROACH_BASELINE, yds);
}
function pgaBaselineSand(yds) {
  return interpolateBaseline(SAND_APPROACH_BASELINE, yds);
}
function shortGameBaseline(lie, yds) {
  if (lie === "rough") return pgaBaselineRough(yds);
  if (lie === "bunker") return pgaBaselineSand(yds);
  return pgaBaselineApproach(yds);
}

// Range: shot assumed to finish on the green, so the remaining distance is run through the
// putting baseline (same simplifying assumption App.jsx's own sgForApproachShot makes).
function sgForApproachShot(targetYds, actualYds) {
  const missYds = Math.abs(actualYds - targetYds);
  const missFt = missYds * 3;
  return pgaBaselineApproach(targetYds) - pgaBaselinePutts(missFt) - 1;
}

// Short game: resultFt === 0 means holed (no further strokes needed) — see App.jsx's own
// sgForShortGameShot for why that has to be handled separately from "0ft, needs a tap-in".
function sgForShortGameShot(lie, targetYds, resultFt) {
  const remainingStrokes = resultFt <= 0 ? 0 : pgaBaselinePutts(resultFt);
  return shortGameBaseline(lie, targetYds) - remainingStrokes - 1;
}

// Group distances into 10y bands, e.g. "70-80" — identical to App.jsx's bucketFor/bucketSortKey.
function bucketFor(target) {
  const start = Math.floor(target / 10) * 10;
  return `${start}-${start + 10}`;
}
function bucketSortKey(label) {
  return parseInt(label.split("-")[0], 10);
}

const PUTTING_BAND_ORDER = { "0-10": 0, "10-20": 1, "21-30": 2, "30+": 3 };
function puttingBucketFor(ft) {
  if (ft <= 10) return "0-10";
  if (ft <= 20) return "10-20";
  if (ft <= 30) return "21-30";
  return "30+";
}
function puttingBucketSortKey(label) {
  return PUTTING_BAND_ORDER[label] ?? 99;
}

const LIE_LABELS = { fairway: "FAIRWAY", rough: "ROUGH", bunker: "BUNKER" };
const CLUB_LABELS = { driver: "DRIVER", fairway: "FAIRWAY WOOD", hybrid: "HYBRID", iron: "IRON" };

// First-half-vs-second-half-chronologically trend, same method every analysis screen in the
// player app uses: positive = improved (SG went up) across the period, negative = regressed.
function trendDeltaOf(rowsSortedByDate, valueFn) {
  const mid = Math.floor(rowsSortedByDate.length / 2);
  const firstHalf = rowsSortedByDate.slice(0, mid);
  const secondHalf = rowsSortedByDate.slice(mid);
  if (!firstHalf.length || !secondHalf.length) return 0;
  return avg(secondHalf.map(valueFn)) - avg(firstHalf.map(valueFn));
}

function byDate(sessions) {
  return [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
}

const EMPTY_SG_SECTION = { sessionCount: 0, overallAvgSG: 0, trendDelta: 0, buckets: [] };
const EMPTY_TEE_SECTION = { sessionCount: 0, overallHitPct: 0, trendDelta: 0, clubs: [] };

function computeRangeStats(sessions) {
  if (!sessions.length) return EMPTY_SG_SECTION;
  const rows = [];
  byDate(sessions).forEach((s) => {
    (s.shots || []).forEach((sh) => {
      rows.push({ date: s.date, sg: sgForApproachShot(sh.target, sh.actual), bucket: bucketFor(sh.target) });
    });
  });
  if (!rows.length) return { ...EMPTY_SG_SECTION, sessionCount: sessions.length };

  const byBucket = {};
  rows.forEach((r) => (byBucket[r.bucket] ||= []).push(r));
  const buckets = Object.entries(byBucket)
    .map(([label, rs]) => ({ label, count: rs.length, avgSG: avg(rs.map((r) => r.sg)) }))
    .sort((a, b) => bucketSortKey(a.label) - bucketSortKey(b.label));

  return {
    sessionCount: sessions.length,
    overallAvgSG: avg(rows.map((r) => r.sg)),
    trendDelta: trendDeltaOf(rows, (r) => r.sg),
    buckets,
  };
}

function computeTeeAccuracyStats(sessions) {
  if (!sessions.length) return EMPTY_TEE_SECTION;
  const rows = [];
  byDate(sessions).forEach((s) => {
    (s.shots || []).forEach((sh) => rows.push({ date: s.date, club: sh.club, hit: sh.hit }));
  });
  if (!rows.length) return { ...EMPTY_TEE_SECTION, sessionCount: sessions.length };

  const byClub = {};
  rows.forEach((r) => (byClub[r.club] ||= []).push(r));
  const clubs = Object.entries(byClub).map(([club, rs]) => ({
    club: CLUB_LABELS[club] || club,
    count: rs.length,
    hitPct: Math.round((rs.filter((r) => r.hit).length / rs.length) * 100),
  }));

  return {
    sessionCount: sessions.length,
    overallHitPct: Math.round((rows.filter((r) => r.hit).length / rows.length) * 100),
    trendDelta: trendDeltaOf(rows, (r) => (r.hit ? 100 : 0)),
    clubs,
  };
}

function computeShortGameStats(sessions) {
  if (!sessions.length) return EMPTY_SG_SECTION;
  const rows = [];
  byDate(sessions).forEach((s) => {
    (s.shots || []).forEach((sh) =>
      rows.push({ date: s.date, sg: sgForShortGameShot(sh.lie, sh.target, sh.resultFt), lie: sh.lie })
    );
  });
  if (!rows.length) return { ...EMPTY_SG_SECTION, sessionCount: sessions.length };

  const byLie = {};
  rows.forEach((r) => (byLie[r.lie] ||= []).push(r));
  const buckets = Object.entries(byLie).map(([lie, rs]) => ({
    label: LIE_LABELS[lie] || lie,
    count: rs.length,
    avgSG: avg(rs.map((r) => r.sg)),
  }));

  return {
    sessionCount: sessions.length,
    overallAvgSG: avg(rows.map((r) => r.sg)),
    trendDelta: trendDeltaOf(rows, (r) => r.sg),
    buckets,
  };
}

function computePuttingPracticeStats(sessions) {
  if (!sessions.length) return EMPTY_SG_SECTION;
  const rows = [];
  byDate(sessions).forEach((s) => {
    (s.putts || []).forEach((p) =>
      rows.push({ date: s.date, sg: sgForPutt(p.targetFt, p.strokes), bucket: puttingBucketFor(p.targetFt) })
    );
  });
  if (!rows.length) return { ...EMPTY_SG_SECTION, sessionCount: sessions.length };

  const byBucket = {};
  rows.forEach((r) => (byBucket[r.bucket] ||= []).push(r));
  const buckets = Object.entries(byBucket)
    .map(([label, rs]) => ({ label, count: rs.length, avgSG: avg(rs.map((r) => r.sg)) }))
    .sort((a, b) => puttingBucketSortKey(a.label) - puttingBucketSortKey(b.label));

  return {
    sessionCount: sessions.length,
    overallAvgSG: avg(rows.map((r) => r.sg)),
    trendDelta: trendDeltaOf(rows, (r) => r.sg),
    buckets,
  };
}

function computePuttingCourseStats(sessions) {
  if (!sessions.length) return EMPTY_SG_SECTION;
  const rows = [];
  byDate(sessions).forEach((s) => {
    (s.putts || []).forEach((p) => rows.push({ date: s.date, sg: sgForPutt(p.targetFt, p.strokes) }));
  });
  if (!rows.length) return { ...EMPTY_SG_SECTION, sessionCount: sessions.length };

  return {
    sessionCount: sessions.length,
    overallAvgSG: avg(rows.map((r) => r.sg)),
    trendDelta: trendDeltaOf(rows, (r) => r.sg),
    buckets: [],
  };
}

function safeParse(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Turns the player's raw appData (as returned by loadPlayerAppData) into the exact stats shape
// PlayerOverviewScreen / PlayerSectionScreen / CompareResultsScreen already expect — matching
// buildSampleStats()'s return shape field-for-field so no rendering code needed to change.
export function computeStatsFromAppData(appData) {
  const golfSessions = safeParse(appData["golf:sessions"]);
  const teeSessions = safeParse(appData["tee:sessions"]);
  const shortGameSessions = safeParse(appData["shortgame:sessions"]);
  const allPutting = safeParse(appData["putting:sessions"]);
  const puttingPractice = allPutting.filter((s) => s.type !== "course");
  const puttingCourse = allPutting.filter((s) => s.type === "course");

  return {
    range: computeRangeStats(golfSessions),
    teeAccuracy: computeTeeAccuracyStats(teeSessions),
    shortGame: computeShortGameStats(shortGameSessions),
    puttingPractice: computePuttingPracticeStats(puttingPractice),
    puttingCourse: computePuttingCourseStats(puttingCourse),
  };
}

export const EMPTY_STATS = {
  range: EMPTY_SG_SECTION,
  teeAccuracy: EMPTY_TEE_SECTION,
  shortGame: EMPTY_SG_SECTION,
  puttingPractice: EMPTY_SG_SECTION,
  puttingCourse: EMPTY_SG_SECTION,
};

// Loads + computes one player's real stats, re-running whenever playerId changes. Returns
// { stats, loading } — stats is EMPTY_STATS (not null) while loading/on error, so callers that
// already handle "zero sessions yet" also handle "still fetching" with no extra branching.
export function usePlayerStats(playerId) {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(!!playerId);

  useEffect(() => {
    if (!playerId) {
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadPlayerAppData(playerId)
      .then((appData) => {
        if (cancelled) return;
        setStats(computeStatsFromAppData(appData));
      })
      .catch(() => {
        if (cancelled) return;
        setStats(EMPTY_STATS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  return { stats, loading };
}

// Batch version for the Compare screen, which needs several players' stats at once without
// calling a hook inside a loop (against the rules of hooks) — one effect, one Firestore round
// trip per selected player, all resolved together.
export function usePlayerStatsMap(playerIds) {
  const key = playerIds.join(",");
  const [statsById, setStatsById] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      playerIds.map((id) =>
        loadPlayerAppData(id)
          .then((appData) => [id, computeStatsFromAppData(appData)])
          .catch(() => [id, EMPTY_STATS])
      )
    ).then((entries) => {
      if (cancelled) return;
      setStatsById(Object.fromEntries(entries));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { statsById, loading };
}
