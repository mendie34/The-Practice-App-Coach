import { useState, useEffect } from "react";
import CoachApp, { COLORS, FONT_IMPORT, LOGO_SRC, LOGO_COACH_SRC, Card, SectionLabel } from "./CoachApp.jsx";
import { watchAuthState, signUp, signIn, signOutUser, getCoachProfile, saveCoachProfile } from "./storage.js";

const AUTH_ERROR_MESSAGES = {
  "auth/email-already-in-use": "An account with that email already exists — try signing in instead.",
  "auth/invalid-email": "That doesn't look like a valid email address.",
  "auth/weak-password": "Password should be at least 6 characters.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/user-not-found": "No account found with that email.",
  "auth/too-many-requests": "Too many attempts — please wait a bit and try again.",
  "auth/network-request-failed": "Couldn't reach the server — check your connection and try again.",
};
function friendlyAuthError(err) {
  return AUTH_ERROR_MESSAGES[err && err.code] || (err && err.message) || "Something went wrong. Please try again.";
}

const shellStyle = {
  minHeight: "100vh",
  background: COLORS.turfDark,
  color: COLORS.cream,
  fontFamily: "'Inter', sans-serif",
  padding: "48px 16px",
  boxSizing: "border-box",
};
const cardStyle = {
  maxWidth: 420,
  margin: "0 auto",
  background: `${COLORS.turf}cc`,
  border: `1px solid ${COLORS.creamDim}22`,
  borderRadius: 14,
  padding: "20px 20px 24px",
};
const titleStyle = { fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 1, textAlign: "center" };
const labelStyle = { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.creamDim, marginBottom: 6, marginTop: 14 };
const inputStyle = {
  width: "100%",
  background: COLORS.turfDark,
  border: `1px solid ${COLORS.creamDim}33`,
  borderRadius: 8,
  color: COLORS.cream,
  fontFamily: "'Inter', sans-serif",
  fontSize: 16,
  padding: "10px 12px",
  boxSizing: "border-box",
};
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
const linkButtonStyle = {
  display: "block",
  width: "100%",
  marginTop: 14,
  background: "transparent",
  border: "none",
  color: COLORS.creamDim,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  textDecoration: "underline",
  cursor: "pointer",
  textAlign: "center",
};
const errorStyle = {
  marginTop: 14,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  color: COLORS.flag,
};

function LoadingScreen() {
  return (
    <div style={{ ...shellStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
      <style>{FONT_IMPORT}</style>
      <img src={LOGO_SRC} alt="" style={{ width: 48, height: 48, opacity: 0.8 }} />
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.creamDim }}>Loading…</div>
    </div>
  );
}

// Note: no <form> tag here — a plain div + onClick + onKeyDown submit, same as the demo. This
// mirrors the player app's AuthGate (which does use <form> safely, since it's a normal deployed
// browser page, not a Claude-artifact sandbox) — either pattern is fine in a real deployed app;
// this one is just kept from the demo for consistency with the rest of this codebase's history.
function AuthScreen({ mode, setMode, onSubmit, submitting, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const isSignUp = mode === "signup";
  const canSubmit = email.trim() !== "" && password.length >= 6 && !submitting;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(email.trim(), password, remember);
  }

  return (
    <div style={shellStyle}>
      <style>{FONT_IMPORT}</style>
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <img src={LOGO_COACH_SRC} alt="The Practice App — Coach" style={{ width: 150, height: 195, marginBottom: 10 }} />
        <div style={titleStyle}>THE PRACTICE APP</div>
      </div>
      <div style={cardStyle}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 0.5 }}>
          {isSignUp ? "CREATE COACH ACCOUNT" : "LOG IN"}
        </div>

        <div style={labelStyle}>EMAIL</div>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={inputStyle}
          autoFocus
        />

        <div style={labelStyle}>PASSWORD</div>
        <input
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={isSignUp ? "At least 6 characters" : "Your password"}
          style={inputStyle}
        />

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 16,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            color: COLORS.creamDim,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: COLORS.fairway, cursor: "pointer" }}
          />
          Remember me
        </label>

        {error && <div style={errorStyle}>{error}</div>}

        <button type="button" onClick={handleSubmit} disabled={!canSubmit} style={primaryButtonStyle(!canSubmit)}>
          {submitting ? "PLEASE WAIT…" : isSignUp ? "CREATE ACCOUNT" : "LOG IN"}
        </button>

        <button type="button" onClick={() => setMode(isSignUp ? "signin" : "signup")} style={linkButtonStyle}>
          {isSignUp ? "Already have an account? Log in" : "New here? Create a coach account"}
        </button>
      </div>
    </div>
  );
}

// ===== Coach profile setup (first login only) =====
function CoachProfileSetup({ email, onComplete }) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const canSubmit = name.trim() !== "";

  return (
    <div style={shellStyle}>
      <style>{FONT_IMPORT}</style>
      <div style={cardStyle}>
        <SectionLabel>Set up your coach profile</SectionLabel>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: COLORS.creamDim, marginTop: 6, lineHeight: 1.5 }}>
          This is what players will see when they search for you and send a request.
        </div>

        <div style={labelStyle}>YOUR NAME</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Morgan" style={inputStyle} autoFocus />

        <div style={labelStyle}>BIO / CREDENTIALS (OPTIONAL)</div>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="PGA Class A, junior & college players…"
          rows={3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "'Inter', sans-serif" }}
        />

        <button
          onClick={() => canSubmit && onComplete({ name: name.trim(), bio: bio.trim(), email })}
          disabled={!canSubmit}
          style={primaryButtonStyle(!canSubmit)}
        >
          CONTINUE
        </button>
      </div>
    </div>
  );
}

export default function AuthGate() {
  // loading | signedOut | needsProfile | ready
  const [authState, setAuthState] = useState("loading");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [mode, setMode] = useState("signin");
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const unsub = watchAuthState(async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setProfile(null);
        setAuthState("signedOut");
        return;
      }
      setUser(fbUser);
      try {
        const existingProfile = await getCoachProfile(fbUser.uid);
        if (existingProfile) {
          setProfile(existingProfile);
          setAuthState("ready");
        } else {
          setAuthState("needsProfile");
        }
      } catch (e) {
        // Firestore unreachable (offline on first-ever login, before anything is cached) — fall
        // back to the setup wizard rather than getting stuck; saving will retry once online.
        setAuthState("needsProfile");
      }
    });
    return unsub;
  }, []);

  async function handleAuthSubmit(email, password, remember) {
    setSubmitting(true);
    setAuthError(null);
    try {
      if (mode === "signup") {
        await signUp(email, password, remember);
      } else {
        await signIn(email, password, remember);
      }
      // onAuthStateChanged (above) picks up from here and drives the rest of the flow.
    } catch (e) {
      setAuthError(friendlyAuthError(e));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSignOut() {
    signOutUser();
  }

  async function handleProfileComplete(payload) {
    const uid = user.uid;
    const profileDoc = { name: payload.name, bio: payload.bio, email: payload.email, createdAt: Date.now() };
    await saveCoachProfile(uid, profileDoc);
    setProfile(profileDoc);
    setAuthState("ready");
  }

  if (authState === "loading") {
    return <LoadingScreen />;
  }

  if (authState === "signedOut") {
    return <AuthScreen mode={mode} setMode={setMode} onSubmit={handleAuthSubmit} submitting={submitting} error={authError} />;
  }

  if (authState === "needsProfile") {
    return <CoachProfileSetup email={user.email} onComplete={handleProfileComplete} />;
  }

  return <CoachApp uid={user.uid} profile={profile} onSignOut={handleSignOut} />;
}
