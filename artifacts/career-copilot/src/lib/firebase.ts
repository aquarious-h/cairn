import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

// Public Firebase web app configuration for the Cairn project. These values
// identify the client app and are safe to ship to the browser. Set the
// VITE_FIREBASE_* environment variables to point the app at a different
// Firebase project.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAS3E8qnO6Lprj86hNi4IFeZ4BWcRrK80I",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "cairn-1b6a0.firebaseapp.com",
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    "https://cairn-1b6a0-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "cairn-1b6a0",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:909439541490:web:d6faa6eddd8281f1c2b06b",
};

export const firebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.trim().length > 0,
);

const firebaseApp = firebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
export const firebaseDatabase = firebaseApp ? getDatabase(firebaseApp) : null;
