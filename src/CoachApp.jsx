import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { watchCoachLinks, approveLink, declineLink, removeFromRoster } from "./storage.js";
import { usePlayerStats, usePlayerStatsMap, EMPTY_STATS } from "./realStats.js";

// ===== THE PRACTICE APP — COACH =====
// Real standalone build. Auth + profile setup live in AuthGate.jsx; this component renders once
// a coach is signed in with a saved profile. Requests/roster come from live Firestore listeners
// (storage.js's watchCoachLinks) instead of the demo's window.storage mock.

// ----- Shared visual system, copied verbatim from the player app for total parity -----
export const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
@media print {
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  * { color: #14291F !important; background: #ffffff !important; border-color: #ccc !important; box-shadow: none !important; }
}
.print-only { display: none; }`;

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

// Real static assets (public/logo.png, public/logo-coach.png) — replaces the demo's inline
// base64 data URIs now that this is a normal deployed web app with a public/ folder.
export const LOGO_SRC = "/logo.png";
export const LOGO_COACH_SRC = "/logo-coach.png";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ----- Sample data, for previewing the dashboard before real requests exist. Entirely client-
// side/ephemeral (never written to Firestore) — see handlePreview/handleExitPreview below. -----
function daysAgo(n) {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}
function sampleRequests() {
  return [
    { id: uid(), playerId: "sample", playerName: "Jamie Reed", playerEmail: "jamie.reed@example.com", requestedAt: daysAgo(0.2) },
    { id: uid(), playerId: "sample", playerName: "Alicia Chen", playerEmail: "alicia.chen@example.com", requestedAt: daysAgo(1) },
  ];
}
function sampleRoster() {
  return [
    { id: uid(), playerName: "Sam Whitfield", playerEmail: "sam.whitfield@example.com", connectedAt: daysAgo(40) },
    { id: uid(), playerName: "Priya Nair", playerEmail: "priya.nair@example.com", connectedAt: daysAgo(12) },
    { id: uid(), playerName: "Tom Baxter", playerEmail: "tom.baxter@example.com", connectedAt: daysAgo(3) },
    { id: uid(), playerName: "Elena Vance", playerEmail: "elena.vance@example.com", connectedAt: daysAgo(65) },
    { id: uid(), playerName: "Marcus Lee", playerEmail: "marcus.lee@example.com", connectedAt: daysAgo(20) },
    { id: uid(), playerName: "Grace Okafor", playerEmail: "grace.okafor@example.com", connectedAt: daysAgo(8) },
    { id: uid(), playerName: "Noah Kessler", playerEmail: "noah.kessler@example.com", connectedAt: daysAgo(51) },
    { id: uid(), playerName: "Aisha Malik", playerEmail: "aisha.malik@example.com", connectedAt: daysAgo(2) },
    { id: uid(), playerName: "Ben Carrasco", playerEmail: "ben.carrasco@example.com", connectedAt: daysAgo(30) },
    { id: uid(), playerName: "Lily Fontaine", playerEmail: "lily.fontaine@example.com", connectedAt: daysAgo(75) },
  ];
}

function formatRelative(ts) {
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
// One consistent color for every player identity box (dashboard tiles, avatar circles) — not
// to be confused with COMPARE_COLORS below, which is intentionally per-player-distinct because
// that's the whole point of the compare charts.
const PLAYER_BOX_GRADIENT = `linear-gradient(160deg, ${COLORS.fairwayLight} 0%, ${COLORS.turfDark} 100%)`;

// One consistent color per player across every compare chart, so e.g. "Priya" is the same
// color in the Range chart as in the Putting chart. Assigned by selection order, not name hash,
// so it stays stable as players are added/removed from the comparison.
const COMPARE_COLORS = [COLORS.fairwayLight, COLORS.sand, COLORS.flag, COLORS.cream, COLORS.fairway];

// Strokes-gained formatting/coloring, copied verbatim from the player app for identical
// behavior — anything shown here should match what the player sees for the same numbers.
function formatSG(sg) {
  const sign = sg > 0 ? "+" : "";
  return `${sign}${sg.toFixed(2)}`;
}
function sgRagColor(avgSG) {
  if (avgSG >= 0) return COLORS.fairwayLight;
  if (avgSG >= -0.15) return COLORS.sand;
  return COLORS.flag;
}
function ratingRagColor(avgRating) {
  if (avgRating >= 4) return COLORS.fairwayLight;
  if (avgRating >= 2.5) return COLORS.sand;
  return COLORS.flag;
}

// ----- Shared style tokens, copied from AuthGate.jsx / App.jsx for exact visual parity -----
const headerBtnStyle = {
  background: "none",
  border: `1px solid ${COLORS.creamDim}55`,
  color: COLORS.creamDim,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  padding: "4px 7px",
  borderRadius: 6,
  cursor: "pointer",
};

export function Card({ children, style, onClick }) {
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
export function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1.5 }}>
      {children}
    </div>
  );
}
export function CoachBadge({ style }) {
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
      COACH
    </div>
  );
}

// ===== Header (post-login shell) =====
function CoachHeader({ screen, onHome, onSettings, onBack }) {
  return (
    <div
      className="no-print"
      style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, gap: 8 }}
    >
      <div onClick={onHome} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
        <img src={LOGO_SRC} alt="" style={{ width: 20, height: 20, flexShrink: 0 }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 19, letterSpacing: 0.5, lineHeight: 1, color: COLORS.cream }}>
            THE PRACTICE APP
          </div>
          <CoachBadge />
        </div>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {screen === "dashboard" ? (
          <button onClick={onSettings} style={headerBtnStyle}>SETTINGS</button>
        ) : (
          <button onClick={onBack} style={headerBtnStyle}>BACK</button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, body, actionLabel, onAction }) {
  return (
    <Card style={{ textAlign: "center", padding: "26px 18px" }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.cream }}>{title}</div>
      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: COLORS.creamDim, marginTop: 8, lineHeight: 1.55 }}>
        {body}
      </div>
      {actionLabel && (
        <button
          onClick={onAction}
          style={{
            marginTop: 16,
            padding: "10px 18px",
            borderRadius: 8,
            border: `1px solid ${COLORS.creamDim}55`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      )}
    </Card>
  );
}

// ===== Player block (grid tile) — small, uniform-colored, phone-friendly =====
function PlayerBlock({ player, onClick, selectMode, selected, atCap }) {
  const disabled = selectMode && atCap && !selected;
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        position: "relative",
        aspectRatio: "1 / 1",
        borderRadius: 10,
        overflow: "hidden",
        cursor: disabled ? "not-allowed" : "pointer",
        border: selected ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}22`,
        background: PLAYER_BOX_GRADIENT,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: `${COLORS.cream}33`, letterSpacing: 1 }}>
          {getInitials(player.playerName)}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, transparent 45%, ${COLORS.turfDark}dd 100%)`,
        }}
      />
      {selectMode && (
        <div
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            width: 17,
            height: 17,
            borderRadius: "50%",
            border: `1.5px solid ${selected ? COLORS.fairwayLight : COLORS.creamDim + "88"}`,
            background: selected ? COLORS.fairway : `${COLORS.turfDark}99`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: COLORS.cream,
            lineHeight: 1,
          }}
        >
          {selected ? "✓" : ""}
        </div>
      )}
      <div style={{ position: "absolute", left: 6, bottom: 5, right: 6 }}>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 12,
            letterSpacing: 0.3,
            lineHeight: 1.15,
            color: COLORS.cream,
            textShadow: "0 1px 4px rgba(0,0,0,0.5)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {player.playerName}
        </div>
      </div>
    </div>
  );
}

// ===== Dashboard: player grid + compare =====
function DashboardScreen({
  requests,
  roster,
  onOpenRequests,
  onOpenPlayer,
  onLoadSample,
  compareMode,
  compareSelected,
  onStartCompare,
  onToggleCompareSelect,
  onCancelCompare,
  onConfirmCompare,
}) {
  const bothEmpty = requests.length === 0 && roster.length === 0;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>{compareMode ? "COMPARE" : "WELCOME BACK"}</SectionLabel>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, marginTop: 2 }}>
          {compareMode ? `Select up to ${MAX_COMPARE} players` : "Your players"}
        </div>
      </div>

      {bothEmpty && (
        <EmptyState
          title="Nothing here yet"
          body="Once a player sends you a request from their Practice App, it'll show up here to approve — then move into your roster below as a block you can tap into. Want to see how it'll look?"
          actionLabel="PREVIEW WITH SAMPLE PLAYERS"
          onAction={onLoadSample}
        />
      )}

      {!bothEmpty && (
        <>
          {!compareMode && requests.length > 0 && (
            <Card
              onClick={onOpenRequests}
              style={{ marginBottom: 16, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream }}>
                  {requests.length} pending request{requests.length === 1 ? "" : "s"}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                  Tap to review
                </div>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: COLORS.creamDim }}>›</div>
            </Card>
          )}

          {roster.length === 0 ? (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, opacity: 0.7, marginBottom: 12 }}>
              Approved players will appear here as blocks you can tap into.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {roster.map((p) => {
                const selected = compareSelected.includes(p.id);
                const atCap = compareSelected.length >= MAX_COMPARE;
                return (
                  <PlayerBlock
                    key={p.id}
                    player={p}
                    selectMode={compareMode}
                    selected={selected}
                    atCap={atCap}
                    onClick={() => (compareMode ? onToggleCompareSelect(p.id) : onOpenPlayer(p.id))}
                  />
                );
              })}
            </div>
          )}

          {!compareMode ? (
            <>
              <button onClick={onStartCompare} disabled={roster.length < 2} style={{ ...primaryButtonStyle(roster.length < 2), marginTop: 20 }}>
                COMPARE PLAYERS
              </button>
              {roster.length > 0 && roster.length < 2 && (
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: COLORS.creamDim,
                    opacity: 0.6,
                    textAlign: "center",
                    marginTop: 8,
                  }}
                >
                  Need at least 2 players on your roster to compare.
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                <button
                  onClick={onCancelCompare}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 10,
                    border: `1px solid ${COLORS.creamDim}55`,
                    background: "transparent",
                    color: COLORS.creamDim,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 16,
                    letterSpacing: 1,
                    cursor: "pointer",
                  }}
                >
                  CANCEL
                </button>
                <button
                  onClick={onConfirmCompare}
                  disabled={compareSelected.length < 2}
                  style={{ ...primaryButtonStyle(compareSelected.length < 2), marginTop: 0, flex: 1 }}
                >
                  CONFIRM {compareSelected.length > 0 ? `(${compareSelected.length})` : ""}
                </button>
              </div>
              {compareSelected.length < 2 && (
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: COLORS.creamDim,
                    opacity: 0.6,
                    textAlign: "center",
                    marginTop: 8,
                  }}
                >
                  Pick at least 2 players.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function primaryButtonStyle(disabled) {
  return {
    width: "100%",
    marginTop: 18,
    padding: "12px 0",
    borderRadius: 10,
    border: "none",
    background: disabled ? `${COLORS.fairway}66` : COLORS.fairway,
    color: COLORS.cream,
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 18,
    letterSpacing: 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

// ===== Requests review screen =====
function RequestRow({ request, onApprove, onDecline, busy }) {
  return (
    <Card style={{ marginBottom: 8 }}>
      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, color: COLORS.cream, fontWeight: 600 }}>
        {request.playerName}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 3 }}>
        {request.playerEmail}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 6, opacity: 0.75 }}>
        Requested {formatRelative(request.requestedAt)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onApprove(request)}
          disabled={busy}
          style={{ ...primaryButtonStyle(busy), marginTop: 0, flex: 1, fontSize: 13, padding: "9px 0" }}
        >
          APPROVE
        </button>
        <button
          onClick={() => onDecline(request)}
          disabled={busy}
          style={{
            flex: 1,
            padding: "9px 0",
            borderRadius: 10,
            border: `1px solid ${COLORS.creamDim}55`,
            background: "transparent",
            color: COLORS.creamDim,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 13,
            letterSpacing: 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          DECLINE
        </button>
      </div>
    </Card>
  );
}
function RequestsScreen({ requests, onApprove, onDecline, busyId }) {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>PENDING REQUESTS</SectionLabel>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginTop: 2 }}>Review requests</div>
      </div>
      {requests.length === 0 ? (
        <EmptyState title="All caught up" body="No pending requests right now." />
      ) : (
        requests.map((r) => <RequestRow key={r.id} request={r} onApprove={onApprove} onDecline={onDecline} busy={busyId === r.id} />)
      )}
    </div>
  );
}

// ===== Player stats — mirrors the player app's own Analysis / Coach Summary pattern, with
// less detail (no per-session log, no editing, no dispersion charts — just the rolled-up
// numbers a coach actually needs). All data below is SAMPLE data, deterministically generated
// per player id so it stays stable across renders, standing in for real Firestore-backed stats
// until the player-side "share stats with my coach" plumbing exists (see project handoff). =====

function seededRandom(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return function next() {
    h = (h * 1103515245 + 12345) >>> 0;
    return (h % 10000) / 10000;
  };
}

const RANGE_BANDS = ["50-60", "70-80", "90-100", "110-120", "130-140"];
const TEE_CLUBS = ["Driver", "3 Wood", "Hybrid", "5 Iron"];
const SG_LIES = ["Fairway", "Rough", "Bunker"];
const PUTT_BANDS = ["3-5ft", "5-7ft", "7-10ft"];
// Coach-side stats always compare against the PGA Tour baseline, regardless of whatever
// baseline each individual player has chosen for themselves in their own app — comparing
// Player A's SG vs. their own 15-handicap baseline against Player B's SG vs. PGA Tour would
// make the numbers meaningless side by side. One fixed, clearly-labeled baseline keeps every
// player's numbers on the same footing.
const BASELINE_LABEL = "PGA TOUR";

// Order here matches the "All stats" list order below.
const SECTION_META = [
  { key: "range", label: "RANGE", metricType: "sg" },
  { key: "teeAccuracy", label: "TEE ACCURACY", metricType: "pct" },
  { key: "shortGame", label: "SHORT GAME", metricType: "sg" },
  { key: "puttingPractice", label: "PUTTING — PRACTICE", metricType: "sg" },
  { key: "puttingCourse", label: "PUTTING — ON COURSE", metricType: "sg" },
];

function buildSampleStats(player) {
  const rng = seededRandom(player.id);
  const sgVal = (spread, base) => Number((base + (rng() - 0.5) * spread).toFixed(2));
  const pctVal = (min, max) => Math.round(min + rng() * (max - min));
  const countVal = (min, max) => Math.round(min + rng() * (max - min));
  const trend = () => Number(((rng() - 0.5) * 0.16).toFixed(2));
  const avgOf = (arr, key) => (arr.length ? Number((arr.reduce((a, b) => a + b[key], 0) / arr.length).toFixed(2)) : 0);

  const rangeBuckets = RANGE_BANDS.map((label) => ({ label, count: countVal(5, 22), avgSG: sgVal(0.6, -0.05) }));
  const shortGameBuckets = SG_LIES.map((label) => ({ label, count: countVal(4, 18), avgSG: sgVal(0.5, -0.05) }));
  const puttBuckets = PUTT_BANDS.map((label) => ({ label, count: countVal(6, 24), avgSG: sgVal(0.4, -0.03) }));
  const teeClubs = TEE_CLUBS.map((club) => ({ club, hitPct: pctVal(40, 90), count: countVal(5, 18) }));

  return {
    range: { sessionCount: countVal(8, 30), overallAvgSG: avgOf(rangeBuckets, "avgSG"), trendDelta: trend(), buckets: rangeBuckets },
    teeAccuracy: {
      sessionCount: countVal(6, 20),
      overallHitPct: Math.round(teeClubs.reduce((a, c) => a + c.hitPct, 0) / teeClubs.length),
      trendDelta: trend() * 8,
      clubs: teeClubs,
    },
    shortGame: { sessionCount: countVal(8, 26), overallAvgSG: avgOf(shortGameBuckets, "avgSG"), trendDelta: trend(), buckets: shortGameBuckets },
    puttingPractice: { sessionCount: countVal(10, 28), overallAvgSG: avgOf(puttBuckets, "avgSG"), trendDelta: trend(), buckets: puttBuckets },
    puttingCourse: { sessionCount: countVal(4, 14), overallAvgSG: sgVal(0.4, -0.05), trendDelta: trend() },
  };
}

function trendMark(delta, threshold) {
  if (Math.abs(delta) < threshold) return { icon: "◆", color: COLORS.creamDim };
  return delta > 0 ? { icon: "▲", color: COLORS.fairwayLight } : { icon: "▼", color: COLORS.flag };
}

function buildGlanceRows(stats) {
  return [
    {
      key: "range",
      label: "Range",
      sessions: stats.range.sessionCount,
      metric: formatSG(stats.range.overallAvgSG),
      metricColor: sgRagColor(stats.range.overallAvgSG),
      trend: trendMark(stats.range.trendDelta, 0.03),
    },
    {
      key: "teeAccuracy",
      label: "Tee Accuracy",
      sessions: stats.teeAccuracy.sessionCount,
      metric: `${stats.teeAccuracy.overallHitPct}% fairways`,
      metricColor: ratingRagColor(stats.teeAccuracy.overallHitPct / 20),
      trend: trendMark(stats.teeAccuracy.trendDelta, 1),
    },
    {
      key: "shortGame",
      label: "Short Game",
      sessions: stats.shortGame.sessionCount,
      metric: formatSG(stats.shortGame.overallAvgSG),
      metricColor: sgRagColor(stats.shortGame.overallAvgSG),
      trend: trendMark(stats.shortGame.trendDelta, 0.03),
    },
    {
      key: "puttingPractice",
      label: "Putting — Practice",
      sessions: stats.puttingPractice.sessionCount,
      metric: formatSG(stats.puttingPractice.overallAvgSG),
      metricColor: sgRagColor(stats.puttingPractice.overallAvgSG),
      trend: trendMark(stats.puttingPractice.trendDelta, 0.03),
    },
    {
      key: "puttingCourse",
      label: "Putting — On Course",
      sessions: stats.puttingCourse.sessionCount,
      metric: formatSG(stats.puttingCourse.overallAvgSG),
      metricColor: sgRagColor(stats.puttingCourse.overallAvgSG),
      trend: trendMark(stats.puttingCourse.trendDelta, 0.03),
    },
  ];
}

function buildSuggestedFocus(stats) {
  const focus = [];
  const strengths = [];
  const worstBy = (arr, key) => [...arr].sort((a, b) => a[key] - b[key])[0];
  const bestBy = (arr, key) => [...arr].sort((a, b) => b[key] - a[key])[0];

  if (stats.range.buckets.length) {
    const w = worstBy(stats.range.buckets, "avgSG");
    const s = bestBy(stats.range.buckets, "avgSG");
    focus.push({ area: "Range", text: `${w.label}y (${formatSG(w.avgSG)})` });
    strengths.push({ area: "Range", text: `${s.label}y (${formatSG(s.avgSG)})` });
  }
  if (stats.teeAccuracy.clubs.length) {
    const w = worstBy(stats.teeAccuracy.clubs, "hitPct");
    const s = bestBy(stats.teeAccuracy.clubs, "hitPct");
    focus.push({ area: "Tee Accuracy", text: `${w.club} (${w.hitPct}%)` });
    strengths.push({ area: "Tee Accuracy", text: `${s.club} (${s.hitPct}%)` });
  }
  if (stats.shortGame.buckets.length) {
    const w = worstBy(stats.shortGame.buckets, "avgSG");
    const s = bestBy(stats.shortGame.buckets, "avgSG");
    focus.push({ area: "Short Game", text: `${w.label} (${formatSG(w.avgSG)})` });
    strengths.push({ area: "Short Game", text: `${s.label} (${formatSG(s.avgSG)})` });
  }
  if (stats.puttingPractice.buckets.length) {
    const w = worstBy(stats.puttingPractice.buckets, "avgSG");
    const s = bestBy(stats.puttingPractice.buckets, "avgSG");
    focus.push({ area: "Putting", text: `${w.label} (${formatSG(w.avgSG)})` });
    strengths.push({ area: "Putting", text: `${s.label} (${formatSG(s.avgSG)})` });
  }
  return { focus, strengths };
}

function StatBox({ label, value, valueColor }) {
  return (
    <div style={{ flex: 1, background: `${COLORS.turf}aa`, border: `1px solid ${COLORS.creamDim}22`, borderRadius: 10, padding: "9px 12px" }}>
      <div style={{ fontSize: 9, color: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: valueColor || COLORS.cream, marginTop: 1 }}>{value}</div>
    </div>
  );
}

// ===== Player overview: at-a-glance vs baseline + suggested focus =====
function PlayerOverviewScreen({ player, onOpenSection, onRemoveFromRoster, previewMode }) {
  const { stats: realStats, loading: statsLoading } = usePlayerStats(previewMode ? null : player.id);
  const stats = previewMode ? buildSampleStats(player) : realStats;
  const glanceRows = buildGlanceRows(stats);
  const { focus, strengths } = buildSuggestedFocus(stats);
  const totalSessions = glanceRows.reduce((a, r) => a + r.sessions, 0);
  const [shared, setShared] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const firstName = player.playerName.split(" ")[0];
  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: `1px solid ${COLORS.creamDim}15` };

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: PLAYER_BOX_GRADIENT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 18,
            color: COLORS.cream,
            flexShrink: 0,
          }}
        >
          {getInitials(player.playerName)}
        </div>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, lineHeight: 1.1 }}>{player.playerName}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>
            SG baseline: {BASELINE_LABEL} · {totalSessions} total sessions
            {!previewMode && statsLoading && " · loading…"}
          </div>
        </div>
      </div>

      <Card>
        <SectionLabel>AT A GLANCE</SectionLabel>
        <div style={{ marginTop: 6 }}>
          {glanceRows.map((r) => (
            <div key={r.key} style={rowStyle}>
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

      <Card style={{ marginTop: 10 }}>
        <SectionLabel>SUGGESTED FOCUS AREAS</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
          Weakest spot in each section — a starting point to bring up with {firstName}
        </div>
        <div style={{ marginTop: 8 }}>
          {focus.map((h, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>{h.area}</div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: COLORS.flag, textAlign: "right" }}>→ {h.text}</div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setShared(true)}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "10px 0",
            borderRadius: 8,
            border: `1px solid ${COLORS.creamDim}55`,
            background: shared ? `${COLORS.fairway}55` : "transparent",
            color: COLORS.creamDim,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: 0.5,
            cursor: "pointer",
          }}
        >
          {shared ? "SHARED WITH PLAYER ✓" : "SHARE WITH PLAYER"}
        </button>
      </Card>

      {strengths.length > 0 && (
        <Card style={{ marginTop: 10 }}>
          <SectionLabel>WHAT'S WORKING</SectionLabel>
          <div style={{ marginTop: 8 }}>
            {strengths.map((h, i) => (
              <div key={i} style={rowStyle}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>{h.area}</div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: COLORS.fairwayLight, textAlign: "right" }}>★ {h.text}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ marginTop: 22, marginBottom: 10 }}>
        <SectionLabel>ALL STATS</SectionLabel>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {SECTION_META.map((s) => {
          const sStats = stats[s.key];
          const metric = s.metricType === "pct" ? `${sStats.overallHitPct}%` : formatSG(sStats.overallAvgSG);
          const color = s.metricType === "pct" ? ratingRagColor(sStats.overallHitPct / 20) : sgRagColor(sStats.overallAvgSG);
          return (
            <Card
              key={s.key}
              onClick={() => onOpenSection(s.key)}
              style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: COLORS.cream }}>{s.label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
                  {sStats.sessionCount} sessions
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, color }}>{metric}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: COLORS.creamDim }}>›</span>
              </div>
            </Card>
          );
        })}
      </div>

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 14, lineHeight: 1.5, opacity: 0.75 }}>
        Sample data for preview — ▲/▼ = trending better/worse · ◆ = steady · Strokes gained is
        approximate, always measured against the PGA Tour baseline here — regardless of whatever
        baseline {firstName} has set for themselves in their own app — so every player's numbers
        stay on the same footing.
      </div>

      {onRemoveFromRoster && (
        <Card style={{ marginTop: 16 }}>
          {!confirmingRemove ? (
            <button
              onClick={() => setConfirmingRemove(true)}
              style={{
                width: "100%",
                padding: "10px 0",
                borderRadius: 8,
                border: `1px solid ${COLORS.creamDim}33`,
                background: "transparent",
                color: COLORS.creamDim,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                letterSpacing: 0.5,
                cursor: "pointer",
              }}
            >
              REMOVE FROM ROSTER
            </button>
          ) : (
            <>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, lineHeight: 1.5 }}>
                Remove {player.playerName} from your roster? They'll lose your shared notes and
                you'll lose access to their stats — they'd need to send a new request to reconnect.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => setConfirmingRemove(false)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 8,
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
                    setConfirmingRemove(false);
                    onRemoveFromRoster(player.id);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 8,
                    border: `1px solid ${COLORS.flag}66`,
                    background: "transparent",
                    color: COLORS.flag,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 14,
                    letterSpacing: 0.5,
                    cursor: "pointer",
                  }}
                >
                  REMOVE
                </button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

// ===== Per-section drill-down (less detail than the player's own analysis: no session log,
// no editing, no charts — just the overview + bucket breakdown a coach needs) =====
function StatBucketRow({ label, sub, valueText, valueColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: COLORS.cream }}>{label}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>{sub}</div>
      </div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: valueColor }}>{valueText}</div>
    </div>
  );
}
function StatInsightCard({ title, subtitle, rows }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {subtitle && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginTop: 2 }}>{subtitle}</div>
      )}
      <div style={{ marginTop: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ borderTop: i > 0 ? `1px solid ${COLORS.creamDim}15` : "none" }}>
            <StatBucketRow {...r} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function PlayerSectionScreen({ player, sectionKey, previewMode }) {
  const { stats: realStats } = usePlayerStats(previewMode ? null : player.id);
  const stats = previewMode ? buildSampleStats(player) : realStats;
  const meta = SECTION_META.find((s) => s.key === sectionKey);
  const s = stats[sectionKey];

  let overviewMetric = "";
  let overviewColor = COLORS.cream;
  let bucketRows = [];
  let bucketSubtitle = "";

  if (sectionKey === "range") {
    overviewMetric = formatSG(s.overallAvgSG);
    overviewColor = sgRagColor(s.overallAvgSG);
    bucketSubtitle = "By distance, best to worst";
    bucketRows = [...s.buckets]
      .sort((a, b) => b.avgSG - a.avgSG)
      .map((b) => ({ label: `${b.label}y`, sub: `${b.count} shots`, valueText: formatSG(b.avgSG), valueColor: sgRagColor(b.avgSG) }));
  } else if (sectionKey === "teeAccuracy") {
    overviewMetric = `${s.overallHitPct}%`;
    overviewColor = ratingRagColor(s.overallHitPct / 20);
    bucketSubtitle = "By club, best to worst";
    bucketRows = [...s.clubs]
      .sort((a, b) => b.hitPct - a.hitPct)
      .map((c) => ({ label: c.club, sub: `${c.count} attempts`, valueText: `${c.hitPct}%`, valueColor: ratingRagColor(c.hitPct / 20) }));
  } else if (sectionKey === "shortGame") {
    overviewMetric = formatSG(s.overallAvgSG);
    overviewColor = sgRagColor(s.overallAvgSG);
    bucketSubtitle = "By lie, best to worst";
    bucketRows = [...s.buckets]
      .sort((a, b) => b.avgSG - a.avgSG)
      .map((b) => ({ label: b.label, sub: `${b.count} shots`, valueText: formatSG(b.avgSG), valueColor: sgRagColor(b.avgSG) }));
  } else if (sectionKey === "puttingPractice") {
    overviewMetric = formatSG(s.overallAvgSG);
    overviewColor = sgRagColor(s.overallAvgSG);
    bucketSubtitle = "By distance, best to worst";
    bucketRows = [...s.buckets]
      .sort((a, b) => b.avgSG - a.avgSG)
      .map((b) => ({ label: b.label, sub: `${b.count} putts`, valueText: formatSG(b.avgSG), valueColor: sgRagColor(b.avgSG) }));
  } else if (sectionKey === "puttingCourse") {
    overviewMetric = formatSG(s.overallAvgSG);
    overviewColor = sgRagColor(s.overallAvgSG);
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>{player.playerName.toUpperCase()}</SectionLabel>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginTop: 2 }}>{meta.label}</div>
      </div>

      <Card style={{ marginBottom: 14 }}>
        <SectionLabel>Overview</SectionLabel>
        {meta.metricType !== "pct" && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
            vs {BASELINE_LABEL} baseline
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <StatBox label="SESSIONS" value={s.sessionCount} />
          <StatBox label={meta.metricType === "pct" ? "FAIRWAYS HIT" : "AVG SG"} value={overviewMetric} valueColor={overviewColor} />
        </div>
      </Card>

      {bucketRows.length > 0 && <StatInsightCard title="Breakdown" subtitle={bucketSubtitle} rows={bucketRows} />}

      {sectionKey === "puttingCourse" && (
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, opacity: 0.7 }}>
          Round-by-round breakdown isn't in this preview yet — just the overall average for now.
        </div>
      )}

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 16, opacity: 0.6 }}>
        Sample data for preview.
      </div>
    </div>
  );
}

// ===== Compare =====
const MAX_COMPARE = 5;

// Weaker baselines make the same shot look better (you're being measured against a lower bar),
// so strokes gained shifts upward as the baseline gets easier. These offsets are illustrative —
// real per-baseline SG needs real shot-level data (see computeOffsets in the player app) — but
// they're enough to make switching baselines here behave the way it will once wired to real data.
const COMPARE_BASELINE_OPTIONS = [
  { key: "tour", label: "PGA TOUR", offset: 0 },
  { key: "scratch", label: "SCRATCH", offset: 0.05 },
  { key: "5", label: "5 HCP", offset: 0.12 },
  { key: "10", label: "10 HCP", offset: 0.2 },
  { key: "15", label: "15 HCP", offset: 0.28 },
  { key: "20", label: "20 HCP", offset: 0.35 },
  { key: "25", label: "25 HCP", offset: 0.42 },
  { key: "30", label: "30 HCP", offset: 0.5 },
];

function CompareTooltip({ active, payload, isPct }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div
      style={{
        background: COLORS.turfDark,
        border: `1px solid ${COLORS.creamDim}33`,
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        color: COLORS.cream,
      }}
    >
      {p.payload.fullName}: {isPct ? `${p.value}%` : formatSG(p.value)}
    </div>
  );
}

function CompareBarChart({ title, subtitle, data, isPct }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>{subtitle}</div>
      <div style={{ marginTop: 10, height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 18, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={`${COLORS.creamDim}22`} />
            <XAxis
              dataKey="name"
              tick={{ fill: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}
              axisLine={{ stroke: `${COLORS.creamDim}33` }}
              tickLine={false}
            />
            <YAxis
              domain={isPct ? [0, 100] : ["dataMin - 0.05", "dataMax + 0.05"]}
              tickFormatter={(v) => (isPct ? `${v}%` : v.toFixed(2))}
              tick={{ fill: COLORS.creamDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip content={<CompareTooltip isPct={isPct} />} cursor={{ fill: `${COLORS.creamDim}11` }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList
                dataKey="value"
                position="top"
                formatter={(v) => (isPct ? `${v}%` : formatSG(v))}
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fill: COLORS.cream }}
              />
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function CompareResultsScreen({ roster, selected, previewMode }) {
  const [baselineKey, setBaselineKey] = useState("tour");
  const baselineOption = COMPARE_BASELINE_OPTIONS.find((b) => b.key === baselineKey) || COMPARE_BASELINE_OPTIONS[0];

  // Keep colors stable by SELECTION order (not roster order), so a player keeps the same
  // color across every chart for as long as they stay selected.
  const orderedSelected = selected.map((id) => roster.find((p) => p.id === id)).filter(Boolean);
  const { statsById: realStatsById } = usePlayerStatsMap(previewMode ? [] : orderedSelected.map((p) => p.id));
  const compareEntries = orderedSelected.map((player, i) => ({
    player,
    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
    stats: previewMode ? buildSampleStats(player) : realStatsById[player.id] || EMPTY_STATS,
  }));

  function chartDataFor(sectionKey, isPct) {
    return compareEntries.map((e) => {
      const s = e.stats[sectionKey];
      // Tee Accuracy is measured performance (fairways hit), not strokes gained, so it doesn't
      // move when the baseline changes — only the SG-based sections do.
      const value = isPct ? s.overallHitPct : Number((s.overallAvgSG + baselineOption.offset).toFixed(2));
      return { name: e.player.playerName.split(" ")[0], fullName: e.player.playerName, value, color: e.color };
    });
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>COMPARE</SectionLabel>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginTop: 2 }}>
          {compareEntries.length} players
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        {compareEntries.map((e) => (
          <div key={e.player.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: e.color, flexShrink: 0 }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim }}>
              {e.player.playerName}
            </span>
          </div>
        ))}
      </div>

      <Card style={{ marginBottom: 18 }}>
        <SectionLabel>BASELINE</SectionLabel>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: COLORS.creamDim, marginTop: 2 }}>
          Applies to every player here — doesn't affect Tee Accuracy, which isn't strokes-gained based
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 10 }}>
          {COMPARE_BASELINE_OPTIONS.map((b) => (
            <button
              key={b.key}
              onClick={() => setBaselineKey(b.key)}
              style={{
                padding: "9px 2px",
                borderRadius: 8,
                border: baselineKey === b.key ? `2px solid ${COLORS.fairwayLight}` : `1px solid ${COLORS.creamDim}33`,
                background: baselineKey === b.key ? COLORS.fairway : "transparent",
                color: baselineKey === b.key ? COLORS.cream : COLORS.creamDim,
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

      {SECTION_META.map((s) => (
        <CompareBarChart
          key={s.key}
          title={s.label}
          subtitle={s.metricType === "pct" ? "% fairways hit" : `Avg strokes gained vs ${baselineOption.label}`}
          data={chartDataFor(s.key, s.metricType === "pct")}
          isPct={s.metricType === "pct"}
        />
      ))}

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: COLORS.creamDim, marginTop: 4, opacity: 0.6 }}>
        Sample data for preview.
      </div>
    </div>
  );
}

// ===== Settings =====
function SettingsScreen({ profile, onSignOut, previewMode, onExitPreview }) {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>SETTINGS</SectionLabel>
      </div>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel>COACH PROFILE</SectionLabel>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, marginTop: 6 }}>{profile?.name || "—"}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim, marginTop: 2 }}>
          {profile?.email || ""}
        </div>
        {profile?.bio && (
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: COLORS.creamDim, marginTop: 8, lineHeight: 1.5 }}>
            {profile.bio}
          </div>
        )}
      </Card>

      {previewMode && (
        <Card style={{ marginBottom: 12 }}>
          <SectionLabel>SAMPLE DATA</SectionLabel>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: COLORS.creamDim, marginTop: 6, lineHeight: 1.5 }}>
            You're currently previewing sample players — this data is local to this screen and was
            never saved. Exit preview to see your real requests and roster.
          </div>
          <button
            onClick={onExitPreview}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "10px 0",
              borderRadius: 8,
              border: `1px solid ${COLORS.creamDim}55`,
              background: "transparent",
              color: COLORS.creamDim,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            EXIT PREVIEW
          </button>
        </Card>
      )}

      <button
        onClick={onSignOut}
        style={{
          width: "100%",
          marginTop: 6,
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
        SIGN OUT
      </button>
    </div>
  );
}

// ===== Top-level app (rendered by AuthGate once a coach is signed in with a saved profile) =====
export default function CoachApp({ uid, profile, onSignOut }) {
  // dashboard | requests | playerDetail | playerSection | compare | settings
  const [screen, setScreen] = useState("dashboard");
  const [requests, setRequests] = useState([]);
  const [roster, setRoster] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [selectedSectionKey, setSelectedSectionKey] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelected, setCompareSelected] = useState([]);

  // Sample-preview state is entirely local/ephemeral — never written to Firestore, so it can't
  // collide with real requests/roster and never needs "clearing" from the backend.
  const [previewMode, setPreviewMode] = useState(false);
  const [previewRequests, setPreviewRequests] = useState(null);
  const [previewRoster, setPreviewRoster] = useState(null);

  // Where BACK goes from each non-dashboard screen — drilling into a stat section should
  // return to that player's overview, not all the way out to the roster.
  const BACK_MAP = {
    requests: "dashboard",
    playerDetail: "dashboard",
    playerSection: "playerDetail",
    compare: "dashboard",
    settings: "dashboard",
  };

  useEffect(() => {
    const unsub = watchCoachLinks(uid, { onRequests: setRequests, onRoster: setRoster });
    return unsub;
  }, [uid]);

  const displayedRequests = previewMode ? previewRequests || [] : requests;
  const displayedRoster = previewMode ? previewRoster || [] : roster;

  function handleLoadSample() {
    setPreviewRequests(sampleRequests());
    setPreviewRoster(sampleRoster());
    setPreviewMode(true);
  }
  function handleExitPreview() {
    setPreviewMode(false);
    setScreen("dashboard");
    setCompareMode(false);
    setCompareSelected([]);
  }

  async function handleApprove(request) {
    if (previewMode) {
      setPreviewRequests((prev) => (prev || []).filter((r) => r.id !== request.id));
      setPreviewRoster((prev) => [
        ...(prev || []),
        { id: request.id, playerName: request.playerName, playerEmail: request.playerEmail, connectedAt: Date.now() },
      ]);
      return;
    }
    setBusyId(request.id);
    try {
      await approveLink(request.playerId, uid);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDecline(request) {
    if (previewMode) {
      setPreviewRequests((prev) => (prev || []).filter((r) => r.id !== request.id));
      return;
    }
    setBusyId(request.id);
    try {
      await declineLink(request.playerId, uid);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveFromRoster(playerId) {
    if (previewMode) {
      setPreviewRoster((prev) => (prev || []).filter((p) => p.id !== playerId));
      setScreen("dashboard");
      return;
    }
    setBusyId(playerId);
    try {
      await removeFromRoster(playerId, uid);
      setScreen("dashboard");
    } finally {
      setBusyId(null);
    }
  }

  function handleOpenPlayer(id) {
    setSelectedPlayerId(id);
    setScreen("playerDetail");
  }
  function handleOpenSection(key) {
    setSelectedSectionKey(key);
    setScreen("playerSection");
  }
  function handleStartCompare() {
    setCompareSelected([]);
    setCompareMode(true);
  }
  function handleToggleCompareSelect(id) {
    setCompareSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  }
  function handleCancelCompare() {
    setCompareMode(false);
    setCompareSelected([]);
  }
  function handleConfirmCompare() {
    setScreen("compare");
  }

  const selectedPlayer = displayedRoster.find((p) => p.id === selectedPlayerId) || null;

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
        <CoachHeader
          screen={screen}
          onHome={() => setScreen("dashboard")}
          onSettings={() => setScreen("settings")}
          onBack={() => setScreen(BACK_MAP[screen] || "dashboard")}
        />

        {screen === "dashboard" && (
          <DashboardScreen
            requests={displayedRequests}
            roster={displayedRoster}
            onOpenRequests={() => setScreen("requests")}
            onOpenPlayer={handleOpenPlayer}
            onLoadSample={handleLoadSample}
            compareMode={compareMode}
            compareSelected={compareSelected}
            onStartCompare={handleStartCompare}
            onToggleCompareSelect={handleToggleCompareSelect}
            onCancelCompare={handleCancelCompare}
            onConfirmCompare={handleConfirmCompare}
          />
        )}

        {screen === "requests" && (
          <RequestsScreen requests={displayedRequests} onApprove={handleApprove} onDecline={handleDecline} busyId={busyId} />
        )}

        {screen === "playerDetail" && selectedPlayer && (
          <PlayerOverviewScreen
            player={selectedPlayer}
            onOpenSection={handleOpenSection}
            onRemoveFromRoster={handleRemoveFromRoster}
            previewMode={previewMode}
          />
        )}

        {screen === "playerSection" && selectedPlayer && selectedSectionKey && (
          <PlayerSectionScreen player={selectedPlayer} sectionKey={selectedSectionKey} previewMode={previewMode} />
        )}

        {screen === "compare" && (
          <CompareResultsScreen roster={displayedRoster} selected={compareSelected} previewMode={previewMode} />
        )}

        {screen === "settings" && (
          <SettingsScreen profile={profile} onSignOut={onSignOut} previewMode={previewMode} onExitPreview={handleExitPreview} />
        )}
      </div>
    </div>
  );
}
