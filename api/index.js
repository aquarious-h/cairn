// This file is built by artifacts/api-server/build.mjs during Vercel deployment.
export const config = { maxDuration: 60 };
export default function handler(req, res) {
  res.status(503).json({ error: "Server initializing..." });
}
