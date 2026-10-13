import crypto from "node:crypto";
import type { RequestHandler } from "express";

type DecodedToken = {
  uid: string;
  email?: string;
  [key: string]: unknown;
};

let cachedCertificates: Record<string, string> | null = null;
let cacheExpiresAt = 0;

async function getGooglePublicKeys(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedCertificates && now < cacheExpiresAt) {
    return cachedCertificates;
  }

  const res = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch Google public keys: ${res.statusText}`);
  }

  const cacheControl = res.headers.get("cache-control");
  const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cacheExpiresAt = now + maxAgeSec * 1000;

  cachedCertificates = (await res.json()) as Record<string, string>;
  return cachedCertificates;
}

function base64UrlDecode(str: string): Buffer {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64");
}

async function verifyFirebaseIdToken(token: string, projectId: string): Promise<DecodedToken> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT token format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64).toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as {
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    auth_time?: number;
    email?: string;
    [key: string]: unknown;
  };

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid JWT header algorithm or key id");
  }

  const certs = await getGooglePublicKeys();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error("Unknown key ID for Firebase token");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  const isValid = verifier.verify(cert, signature);
  if (!isValid) {
    throw new Error("Firebase token signature verification failed");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < nowSec) {
    throw new Error("Firebase token has expired");
  }
  if (typeof payload.auth_time !== "number" || payload.auth_time > nowSec) {
    throw new Error("Firebase token auth_time is in the future");
  }
  if (payload.aud !== projectId) {
    throw new Error(`Firebase token audience mismatch: expected ${projectId}, got ${payload.aud}`);
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error(`Firebase token issuer mismatch: expected https://securetoken.google.com/${projectId}, got ${payload.iss}`);
  }
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Firebase token has no valid subject claim");
  }

  return {
    ...payload,
    uid: payload.sub,
    email: payload.email,
  };
}

export const requireFirebaseUser: RequestHandler = async (req, res, next) => {
  const authorization = req.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    res.status(401).json({ error: "Sign in to use Cairn’s AI features." });
    return;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    "cairn-1b6a0";

  try {
    const decodedToken = await verifyFirebaseIdToken(token, projectId);
    if (!decodedToken.email || !/^[^\s@]+@gmail\.com$/i.test(decodedToken.email)) {
      res.status(403).json({ error: "Use a Gmail address to access Cairn." });
      return;
    }
    next();
  } catch (error) {
    req.log.warn(
      {
        errorType: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Invalid token",
      },
      "Rejected invalid Firebase ID token",
    );
    res.status(401).json({ error: "Your sign-in session has expired. Sign in again." });
  }
};
