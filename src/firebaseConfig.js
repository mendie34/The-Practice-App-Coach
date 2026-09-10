// Firebase project config — these values are NOT secret. Firebase's web config identifies which
// project to talk to; it doesn't grant access to anything by itself. Real access control comes
// from Firestore Security Rules and Firebase Auth, not from hiding this object.
//
// SAME Firebase project the player app uses (the-practice-app-52ce6), web app "practice-app-web"
// — the Coach app is a separate web app registration talking to the same project, so coaches and
// players can be linked via one shared Firestore database (see storage.js's coachLinks
// collection). Copied verbatim from the player standalone repo's src/firebaseConfig.js.
export const firebaseConfig = {
  apiKey: "AIzaSyC7DnfYxPPgQBwq_SqVqq7lgDsvdGTy5Yw",
  authDomain: "the-practice-app-52ce6.firebaseapp.com",
  projectId: "the-practice-app-52ce6",
  storageBucket: "the-practice-app-52ce6.firebasestorage.app",
  messagingSenderId: "980802982428",
  appId: "1:980802982428:web:77e988768374ab76ecc5d9",
};
