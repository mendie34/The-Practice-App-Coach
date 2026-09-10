// Firebase-backed storage + auth layer for the Coach app.
//
// Talks to the SAME Firebase project as the player app (the-practice-app-52ce6), so a coach
// account and a player account both live in one Firestore database and can reference each other.
//
// Data model:
//   coaches/{uid}                 — coach profile doc: { name, bio, email, createdAt }
//   coachLinks/{playerId_coachId} — one doc per player<->coach relationship:
//                                   { playerId, playerName, playerEmail, coachId, coachName,
//                                     status: "pending" | "approved" | "declined",
//                                     requestedAt, respondedAt }
//   Doc id is always `${playerId}_${coachId}` (never auto-generated) so there's at most one link
//   per pair, and both this app and the player app can read/write a specific link without a
//   query — just doc(db, "coachLinks", `${playerId}_${coachId}`).
//
// See firestore.rules (repo root) for the access rules this relies on — read there is scoped to
// the two people a link names, and only the named player can create it / the named coach can
// approve or decline it.
import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig.js";

const app = initializeApp(firebaseConfig, "coach-app");

export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ===== Auth (same pattern as the player app's storage.js, for identical behavior) =====

export function signUp(email, password, remember = true) {
  return setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence).then(() =>
    createUserWithEmailAndPassword(auth, email, password)
  );
}

export function signIn(email, password, remember = true) {
  return setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence).then(() =>
    signInWithEmailAndPassword(auth, email, password)
  );
}

export function signOutUser() {
  return firebaseSignOut(auth);
}

// cb receives the Firebase User object (or null when signed out). Returns the unsubscribe fn.
export function watchAuthState(cb) {
  return onAuthStateChanged(auth, cb);
}

// ===== Coach profile =====

export async function getCoachProfile(uid) {
  const snap = await getDoc(doc(db, "coaches", uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveCoachProfile(uid, profile) {
  await setDoc(doc(db, "coaches", uid), profile, { merge: true });
}

// ===== Coach <-> player links =====

function linkDocId(playerId, coachId) {
  return `${playerId}_${coachId}`;
}
function linkDocRef(playerId, coachId) {
  return doc(db, "coachLinks", linkDocId(playerId, coachId));
}

// Live-subscribes to every link naming this coach, split into "pending requests" and "approved
// roster" — matches the shape CoachApp.jsx's dashboard already expects (requests[] / roster[]).
// Returns an unsubscribe function; call it on unmount / sign-out.
export function watchCoachLinks(coachId, { onRequests, onRoster }) {
  const linksRef = collection(db, "coachLinks");

  const pendingQuery = query(linksRef, where("coachId", "==", coachId), where("status", "==", "pending"));
  const unsubPending = onSnapshot(pendingQuery, (snap) => {
    const requests = snap.docs.map((d) => ({
      id: d.id,
      playerId: d.data().playerId,
      playerName: d.data().playerName,
      playerEmail: d.data().playerEmail,
      requestedAt: d.data().requestedAt,
    }));
    requests.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
    onRequests(requests);
  });

  const approvedQuery = query(linksRef, where("coachId", "==", coachId), where("status", "==", "approved"));
  const unsubApproved = onSnapshot(approvedQuery, (snap) => {
    const roster = snap.docs.map((d) => ({
      id: d.data().playerId,
      linkId: d.id,
      playerName: d.data().playerName,
      playerEmail: d.data().playerEmail,
      connectedAt: d.data().respondedAt,
    }));
    roster.sort((a, b) => (b.connectedAt || 0) - (a.connectedAt || 0));
    onRoster(roster);
  });

  return () => {
    unsubPending();
    unsubApproved();
  };
}

export async function approveLink(playerId, coachId) {
  await updateDoc(linkDocRef(playerId, coachId), { status: "approved", respondedAt: Date.now() });
}

export async function declineLink(playerId, coachId) {
  await updateDoc(linkDocRef(playerId, coachId), { status: "declined", respondedAt: Date.now() });
}

// Ends an APPROVED link from the coach's side — removes a player from the roster. Firestore
// rules only allow this while status is "approved"; the doc is simply deleted, same as a
// player disconnecting or withdrawing a still-pending request.
export async function removeFromRoster(playerId, coachId) {
  await deleteDoc(linkDocRef(playerId, coachId));
}

// ===== Reading a connected player's real practice data =====

// The subset of the player app's APP_DATA_KEYS that the coach-side stats screens need. Kept as
// its own list (rather than importing the player app's) since the two apps are separate repos —
// see realStats.js for how each key's raw JSON string gets turned into stats.
const PLAYER_STATS_KEYS = ["golf:sessions", "tee:sessions", "shortgame:sessions", "putting:sessions"];

function playerAppDataDocRef(playerId, key) {
  return doc(db, "users", playerId, "appData", key);
}

// Reads a connected player's raw appData docs (same users/{uid}/appData/{key} shape the player
// app itself writes to). Relies on firestore.rules allowing a coach to read these docs once an
// "approved" coachLinks doc exists for that player+coach pair. Returns a flat
// { [storageKey]: rawJsonStringOrNull } object — realStats.js's computeStatsFromAppData parses it.
export async function loadPlayerAppData(playerId) {
  const entries = {};
  await Promise.all(
    PLAYER_STATS_KEYS.map(async (key) => {
      const snap = await getDoc(playerAppDataDocRef(playerId, key));
      entries[key] = snap.exists() ? snap.data().value : null;
    })
  );
  return entries;
}
