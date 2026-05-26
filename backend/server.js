#!/usr/bin/env node
/**
 * JobPilot Local API Server
 * Bridges the React UI with the local filesystem (profiles, results, applications)
 * Usage: node backend/server.js
 * Runs on http://localhost:3001
 */

import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const PROFILES  = path.join(ROOT, "profiles");
const DATA      = path.join(ROOT, "data");
const PORT      = 3001;

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJSON(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// ── Route Handlers ────────────────────────────────────────────────────────────

function getProfiles() {
  if (!fs.existsSync(PROFILES)) return [];
  return fs.readdirSync(PROFILES)
    .filter(p => fs.existsSync(path.join(PROFILES, p, "config.json")))
    .map(id => {
      const cfg = readJSON(path.join(PROFILES, id, "config.json"), {});
      return { id, name: cfg.profile?.name || id };
    });
}

function getResults(profileId) {
  return readJSON(path.join(PROFILES, profileId, "results.json"), []);
}

function getApprovalQueue(profileId) {
  return readJSON(path.join(PROFILES, profileId, "approval_queue.json"), []);
}

function getApplications(profileId) {
  return readJSON(path.join(PROFILES, profileId, "applications.json"), []);
}

function getConfig(profileId) {
  return readJSON(path.join(PROFILES, profileId, "config.json"), {});
}

function saveConfig(profileId, config) {
  writeJSON(path.join(PROFILES, profileId, "config.json"), config);
}

function getLastRun() {
  return readJSON(path.join(DATA, "last_run.json"), null);
}

// Move pending results into approval queue (called after scanner run)
function syncApprovalQueue(profileId) {
  const results   = getResults(profileId);
  const queuePath = path.join(PROFILES, profileId, "approval_queue.json");
  const existing  = readJSON(queuePath, []);
  const existingIds = new Set(existing.map(j => j.jobId));

  // Include jobs that are pending_approval OR have no status but have ATS scores
  const pending = results.filter(j =>
    !existingIds.has(j.jobId) &&
    (j.status === "pending_approval" || (!j.status && j.ats && j.ats.ats_score !== null))
  );

  if (pending.length > 0) {
    // Ensure status and profileId are set correctly
    pending.forEach(j => {
      if (!j.status) j.status = "pending_approval";
      if (!j.profileId) j.profileId = profileId;
    });
    const updated = [...pending, ...existing];
    writeJSON(queuePath, updated);
    return pending.length;
  }
  return 0;
}

// ── Router ────────────────────────────────────────────────────────────────────

async function router(req, res) {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();
  const parts  = url.pathname.split("/").filter(Boolean); // ["api", "profiles", ...]

  // OPTIONS preflight
  if (method === "OPTIONS") return send(res, 200, {});

  // GET /api/profiles
  if (method === "GET" && parts[1] === "profiles" && !parts[2]) {
    return send(res, 200, getProfiles());
  }

  // GET /api/lastrun
  if (method === "GET" && parts[1] === "lastrun") {
    return send(res, 200, getLastRun());
  }

  const profileId = parts[2];
  if (!profileId) return send(res, 404, { error: "Profile ID required" });

  // GET /api/profiles/:id/results
  if (method === "GET" && parts[3] === "results") {
    return send(res, 200, getResults(profileId));
  }

  // GET /api/profiles/:id/queue
  if (method === "GET" && parts[3] === "queue") {
    syncApprovalQueue(profileId); // auto-sync on fetch
    return send(res, 200, getApprovalQueue(profileId));
  }

  // DELETE /api/profiles/:id/queue/:jobId  (dismiss)
  if (method === "DELETE" && parts[3] === "queue" && parts[4]) {
    const jobId = decodeURIComponent(parts[4]);
    const queue = getApprovalQueue(profileId).filter(j => j.jobId !== jobId);
    writeJSON(path.join(PROFILES, profileId, "approval_queue.json"), queue);
    return send(res, 200, { ok: true });
  }

  // GET /api/profiles/:id/applications
  if (method === "GET" && parts[3] === "applications") {
    return send(res, 200, getApplications(profileId));
  }

  // POST /api/profiles/:id/applications  (log new application)
  if (method === "POST" && parts[3] === "applications") {
    const body = await getBody(req);
    const apps = getApplications(profileId);
    const newApp = {
      id: `app_${Date.now()}`,
      profileId,
      ...body,
      dateApplied: body.dateApplied || new Date().toISOString(),
      status: body.status || "Applied",
      notes: body.notes || "",
    };
    apps.unshift(newApp);
    writeJSON(path.join(PROFILES, profileId, "applications.json"), apps);

    // Remove from queue
    if (body.jobId) {
      const queue = getApprovalQueue(profileId).filter(j => j.jobId !== body.jobId);
      writeJSON(path.join(PROFILES, profileId, "approval_queue.json"), queue);
    }
    return send(res, 201, newApp);
  }

  // PUT /api/profiles/:id/applications/:appId  (update status/notes)
  if (method === "PUT" && parts[3] === "applications" && parts[4]) {
    const appId = parts[4];
    const body  = await getBody(req);
    const apps  = getApplications(profileId).map(a =>
      a.id === appId ? { ...a, ...body } : a
    );
    writeJSON(path.join(PROFILES, profileId, "applications.json"), apps);
    return send(res, 200, { ok: true });
  }

  // GET /api/profiles/:id/config
  if (method === "GET" && parts[3] === "config") {
    return send(res, 200, getConfig(profileId));
  }

  // PUT /api/profiles/:id/config
  if (method === "PUT" && parts[3] === "config") {
    const body = await getBody(req);
    saveConfig(profileId, body);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "Not found" });
}

// ── Start Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (err) {
    console.error("Server error:", err.message);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\nJobPilot API Server running at http://localhost:${PORT}`);
  console.log("Serving profiles from:", PROFILES);
  console.log("\nEndpoints:");
  console.log("  GET  /api/profiles");
  console.log("  GET  /api/profiles/:id/results");
  console.log("  GET  /api/profiles/:id/queue");
  console.log("  GET  /api/profiles/:id/applications");
  console.log("  POST /api/profiles/:id/applications");
  console.log("  PUT  /api/profiles/:id/applications/:appId");
  console.log("  GET  /api/profiles/:id/config");
  console.log("  PUT  /api/profiles/:id/config\n");
});
