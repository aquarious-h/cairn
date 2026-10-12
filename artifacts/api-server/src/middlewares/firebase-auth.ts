import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { RequestHandler } from "express";

class FirebaseProjectConfigurationError extends Error {}

function getFirebaseAuth() {
  // The project ID is public client configuration; env vars can override it.
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    "cairn-1b6a0";

  const appName = "cairn-career-copilot";
  const app =
    getApps().find((candidate) => candidate.name === appName) ??
    initializeApp({ projectId }, appName);
  return getAuth(app);
}

export const requireFirebaseUser: RequestHandler = async (req, res, next) => {
  const authorization = req.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    res.status(401).json({ error: "Sign in to use Cairn’s AI features." });
    return;
  }

  try {
    const decodedToken = await getFirebaseAuth().verifyIdToken(token);
    if (!decodedToken.email || !/^[^\s@]+@gmail\.com$/i.test(decodedToken.email)) {
      res.status(403).json({ error: "Use a Gmail address to access Cairn." });
      return;
    }
    next();
  } catch (error) {
    if (error instanceof FirebaseProjectConfigurationError) {
      req.log.error({ errorType: error.name }, "Firebase token verification is not configured");
      res.status(503).json({ error: "Authentication is not configured on this server." });
      return;
    }

    req.log.warn(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Rejected invalid Firebase ID token",
    );
    res.status(401).json({ error: "Your sign-in session has expired. Sign in again." });
  }
};
