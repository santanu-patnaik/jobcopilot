#!/usr/bin/env node
/**
 * JobPilot Backend Scanner
 * Runs nightly for all profiles: Discovery → Cache → Ollama Screen → Claude ATS
 * Usage: node scanner.js [profileName]
 *        node scanner.js          ← runs ALL profiles
 *        node scanner.js you      ← runs only "you" profile
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const PROFILES  = path.join(ROOT, "profiles");
const DATA      = path.join(ROOT, "data");

fs.mkdirSync(DATA, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(profileName, msg, level = "info") {
  const ts = new Date().toISOString().slice(11, 19);
  const tag = level === "error" ? "ERR" : level === "warn" ? "WRN" : level === "success" ? " OK" : "INF";
  console.log(`[${ts}] [${tag}] [${profileName}] ${msg}`);
}

function readJSON(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function hashJob(company, title, url) {
  const str = `${company}|${title}|${url}`.toLowerCase().replace(/\s+/g, "");
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── API Keys ─────────────────────────────────────────────────────────────────

function getAnthropicKey() {
  const keyFile = path.join(ROOT, "data", "api_keys.json");
  const keys = readJSON(keyFile, {});
  if (keys.anthropic) return keys.anthropic;
  // fallback: env var
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  throw new Error("Anthropic API key not found. Add it via the app UI or set ANTHROPIC_API_KEY env var.");
}

// ── Job ID Cache ──────────────────────────────────────────────────────────────

function loadCache(profileDir) {
  return readJSON(path.join(profileDir, "cache.json"), { seenIds: {}, lastRun: null });
}

function saveCache(profileDir, cache) {
  writeJSON(path.join(profileDir, "cache.json"), cache);
}

function isNewJob(cache, jobId) {
  return !cache.seenIds[jobId];
}

function markJobSeen(cache, jobId) {
  cache.seenIds[jobId] = new Date().toISOString();
}

// Prune cache entries older than 90 days
function pruneCache(cache) {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(cache.seenIds)) {
    if (new Date(ts).getTime() < cutoff) delete cache.seenIds[id];
  }
}

// ── Claude Discovery Scan ─────────────────────────────────────────────────────

async function scanCompany(company, config, apiKey, profileName) {
  const categoryLabels = config.jobCategories.filter(c => c.enabled).map(c => c.label);
  const keywords       = config.jobCategories.filter(c => c.enabled).flatMap(c => c.keywords);
  const { location, remote, experienceLevel } = config.preferences;

  const prompt = `Search ${company.name}'s careers website for open job postings matching the criteria below.
Use web search to find: site:${new URL(company.careerUrl).hostname} jobs OR visit ${company.careerUrl} directly.

TARGET ROLES (match any): ${categoryLabels.join(", ")}
KEYWORDS (match any): ${keywords.join(", ")}
LOCATION PREFERENCE: ${location} or Remote
EXPERIENCE: ${experienceLevel}

Instructions:
- Search broadly — include jobs posted in the last 30 days, not just today
- If you find ANY matching open roles, include them even if the exact post date is unknown
- Do not filter out jobs just because you are unsure of the date
- Include up to 10 best matches

CRITICAL: Your ENTIRE response must be a single valid JSON array.
Start with [ and end with ]. No markdown, no explanation, no backticks.

Each object must have:
- "title": job title
- "company": "${company.name}"
- "location": city/state or "Remote"
- "remote": "Remote", "Hybrid", or "On-site"
- "category": best match from [${categoryLabels.join(", ")}]
- "url": direct job URL or ${company.careerUrl}
- "postedDate": ISO date if known, otherwise "${new Date().toISOString().slice(0,10)}"
- "description": 2-3 sentence summary of the role

If truly no matching open roles exist: []`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API ${response.status}: ${err.slice(0, 120)}`);
  }

  const data = await response.json();

  // When web_search tools are used, Claude may return multiple content blocks.
  // We need to look at tool_result blocks AND text blocks for the final JSON answer.
  const allText = (data.content || [])
    .map(b => {
      if (b.type === "text") return b.text;
      // tool_result content can be nested
      if (b.type === "tool_result") {
        return Array.isArray(b.content)
          ? b.content.filter(c => c.type === "text").map(c => c.text).join("")
          : (typeof b.content === "string" ? b.content : "");
      }
      return "";
    })
    .join("\n")
    .trim();

  if (!allText) {
    log(profileName, `Empty response from Claude for ${company.name}`, "warn");
    return [];
  }

  // Strategy 1: strip markdown fences and parse directly
  try {
    const cleaned = allText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    // Find the first [ and last ] to isolate the array
    const start = cleaned.indexOf("[");
    const end   = cleaned.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      const jobs = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(jobs)) return jobs;
    }
  } catch { /* try next strategy */ }

  // Strategy 2: regex extract JSON array from anywhere in the text
  try {
    const match = allText.match(/\[[\s\S]*\]/);
    if (match) {
      const jobs = JSON.parse(match[0]);
      if (Array.isArray(jobs)) return jobs;
    }
  } catch { /* try next strategy */ }

  // Strategy 3: ask Claude to re-emit just the JSON (one retry, no web search)
  try {
    log(profileName, `Retrying JSON extraction for ${company.name}...`, "warn");
    const retryResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: allText },
          { role: "user", content: "Output ONLY the JSON array from your previous response. No explanation, no markdown, no backticks. Start with [ and end with ]." },
        ],
      }),
    });
    const retryData = await retryResp.json();
    const retryText = (retryData.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const jobs = JSON.parse(retryText);
    if (Array.isArray(jobs)) return jobs;
  } catch { /* fall through */ }

  log(profileName, `Could not parse JSON from ${company.name} after 3 strategies`, "warn");
  // Write raw response to a debug file so you can inspect it
  const debugDir  = path.join(PROFILES, profileName, "logs");
  fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(
    path.join(debugDir, `debug_${company.name.replace(/\s+/g, "_")}_${Date.now()}.txt`),
    allText,
    "utf8"
  );
  log(profileName, `Raw response saved to profiles/${profileName}/logs/ for inspection`, "warn");
  return [];
}

// ── Ollama Screening ──────────────────────────────────────────────────────────

async function ollamaScreen(job, config, profileName) {
  const { location, remote, experienceLevel } = config.preferences;
  const resumeKeywords = config.resumes.map(r => ({ id: r.id, name: r.name, keywords: r.keywords }));

  const prompt = `You are a job screening assistant. Evaluate if this job matches the candidate's criteria.

JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location} (${job.remote})
Description: ${job.description || "N/A"}

CANDIDATE CRITERIA:
Preferred location: ${location}
Accept remote: ${remote}
Experience level: ${experienceLevel}
Target roles: ${config.jobCategories.filter(c => c.enabled).map(c => c.label).join(", ")}

RESUME VERSIONS AVAILABLE:
${resumeKeywords.map(r => `- ${r.name} (id: ${r.id}): matches roles like ${r.keywords.slice(0,4).join(", ")}`).join("\n")}

Respond ONLY with valid JSON, no markdown:
{
  "passes": true or false,
  "reason": "one sentence explanation",
  "resume_id": "id of best matching resume or null if fails",
  "resume_confidence": "high" or "medium" or "low",
  "score": 0-100
}`;

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.preferences.ollamaModel || "mistral",
        prompt,
        stream: false,
        format: "json",
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) throw new Error(`Ollama ${response.status}`);
    const data = await response.json();
    const result = JSON.parse(data.response);
    return { ollamaAvailable: true, ...result };
  } catch (err) {
    // Ollama unavailable — pass through to Claude
    log(profileName, `Ollama unavailable (${err.message.slice(0,40)}), passing job to Claude directly`, "warn");
    return { ollamaAvailable: false, passes: true, resume_id: null, resume_confidence: "low", score: 50 };
  }
}

// ── Claude ATS Scoring ────────────────────────────────────────────────────────

async function extractResumeText(resumeFile, resumeName) {
  if (!fs.existsSync(resumeFile)) {
    return null; // file not placed yet
  }

  // Try mammoth for proper docx extraction
  try {
    const mammoth = await import("mammoth");
    const result  = await mammoth.extractRawText({ path: resumeFile });
    const text    = result.value.trim();
    if (text.length > 50) return text.slice(0, 4000);
  } catch { /* mammoth not installed or failed */ }

  // Fallback: read as binary and extract printable ASCII
  try {
    const raw  = fs.readFileSync(resumeFile);
    const text = raw.toString("utf8").replace(/[^\x20-\x7E\n]/g, " ")
      .replace(/\s{3,}/g, " ").trim();
    if (text.length > 50) return text.slice(0, 4000);
  } catch { /* ignore */ }

  return null;
}

async function claudeATS(job, resumeConfig, apiKey, profileName) {
  const resumeFile = path.join(PROFILES, profileName, resumeConfig.file);
  const rawText    = await extractResumeText(resumeFile, resumeConfig.name);

  if (!rawText) {
    // Resume file missing — skip ATS, mark for manual review
    return {
      ats_score: null,
      score_reasoning: `Resume file not found at ${resumeConfig.file}. Please add your resume to profiles/${profileName}/resumes/`,
      suggestions: [],
      keywords_missing: [],
      keywords_matched: [],
      overall_recommendation: "resume_missing",
    };
  }

  const resumeText = rawText;

  const prompt = `You are an ATS (Applicant Tracking System) expert and resume coach.

RESUME (${resumeConfig.name}):
${resumeText}

JOB POSTING:
Title: ${job.title}
Company: ${job.company}
Description: ${job.description || "No description available"}

Score this resume against the job and provide tailored suggestions.

Respond ONLY with valid JSON, no markdown:
{
  "ats_score": 0-100,
  "score_reasoning": "2 sentence explanation of score",
  "suggestions": [
    {
      "type": "add" or "modify" or "reword",
      "section": "Summary / Skills / Experience / etc",
      "original": "existing text or null if adding new",
      "suggested": "improved text",
      "impact": "high" or "medium" or "low",
      "reason": "why this improves ATS match"
    }
  ],
  "keywords_missing": ["keyword1", "keyword2"],
  "keywords_matched": ["keyword1", "keyword2"],
  "overall_recommendation": "apply_as_is" or "apply_with_changes" or "skip"
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude ATS API ${response.status}: ${err.slice(0, 100)}`);
  }

  const data = await response.json();
  const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("").trim();
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Pick Resume for Job ───────────────────────────────────────────────────────

function pickResumeFromKeywords(job, resumes) {
  const haystack = `${job.title} ${job.category} ${job.description || ""}`.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const resume of resumes) {
    const matches = resume.keywords.filter(kw => haystack.includes(kw.toLowerCase())).length;
    const score = matches / resume.keywords.length;
    if (score > bestScore) { bestScore = score; best = resume; }
  }

  return { resume: best || resumes[0], confidence: bestScore > 0.3 ? "high" : bestScore > 0 ? "medium" : "low" };
}

// ── Run One Profile ───────────────────────────────────────────────────────────

async function runProfile(profileName) {
  const profileDir = path.join(PROFILES, profileName);
  const configPath = path.join(profileDir, "config.json");

  if (!fs.existsSync(configPath)) {
    console.log(`Profile "${profileName}" not found at ${configPath}`);
    return { profileName, error: "Profile not found", jobsFound: 0, newJobs: 0 };
  }

  const config  = readJSON(configPath);
  const apiKey  = getAnthropicKey();
  const cache   = loadCache(profileDir);
  pruneCache(cache);

  const runStart    = new Date().toISOString();
  const enabledCos  = config.companies.filter(c => c.enabled);
  const allNewJobs  = [];
  const runLog      = [];

  const addLog = (msg, level = "info") => {
    log(profileName, msg, level);
    runLog.push({ ts: new Date().toISOString(), msg, level });
  };

  addLog(`Starting scan — ${enabledCos.length} companies, profile: ${config.profile.name}`);

  // ── Step 1: Discovery ──
  let discoveredJobs = [];
  for (const company of enabledCos) {
    addLog(`Scanning ${company.name}...`);
    try {
      const jobs = await scanCompany(company, config, apiKey, profileName);
      addLog(`  Found ${jobs.length} jobs at ${company.name}`, jobs.length > 0 ? "success" : "info");
      discoveredJobs.push(...jobs);
    } catch (err) {
      addLog(`  Error scanning ${company.name}: ${err.message}`, "error");
    }
    await sleep(1000); // polite delay between API calls
  }

  addLog(`Discovery complete — ${discoveredJobs.length} total jobs found`);

  // ── Step 2: Cache Filter ──
  const freshJobs = [];
  for (const job of discoveredJobs) {
    const id = hashJob(job.company, job.title, job.url);
    job.jobId = id;
    if (isNewJob(cache, id)) {
      freshJobs.push(job);
    }
  }

  addLog(`Cache filter — ${freshJobs.length} new jobs (${discoveredJobs.length - freshJobs.length} already seen)`);

  if (freshJobs.length === 0) {
    addLog("No new jobs to process. Done.", "success");
    cache.lastRun = runStart;
    saveCache(profileDir, cache);
    return { profileName, jobsFound: discoveredJobs.length, newJobs: 0, qualified: 0, runLog };
  }

  // ── Step 3: Ollama Screening ──
  addLog(`Ollama screening ${freshJobs.length} new jobs...`);
  const qualifiedJobs = [];

  for (const job of freshJobs) {
    const screen = await ollamaScreen(job, config, profileName);
    job.ollamaScreen = screen;

    if (screen.passes) {
      // Determine resume: prefer Ollama's pick, fallback to keyword matching
      let resumeId   = screen.resume_id;
      let confidence = screen.resume_confidence;

      if (!resumeId || !config.resumes.find(r => r.id === resumeId)) {
        const pick = pickResumeFromKeywords(job, config.resumes);
        resumeId   = pick.resume.id;
        confidence = pick.confidence;
      }

      job.selectedResumeId         = resumeId;
      job.resumeSelectionConfidence = confidence;
      qualifiedJobs.push(job);
      addLog(`  PASS — ${job.title} @ ${job.company} → resume: ${resumeId} (${confidence})`, "success");
    } else {
      addLog(`  SKIP — ${job.title} @ ${job.company}: ${screen.reason}`, "info");
      markJobSeen(cache, job.jobId); // cache skipped jobs too
    }
    await sleep(500);
  }

  addLog(`Ollama screening complete — ${qualifiedJobs.length} qualified jobs`);

  // ── Step 4: Claude ATS Scoring ──
  addLog(`Running Claude ATS scoring on ${qualifiedJobs.length} jobs...`);
  const threshold = config.preferences.atsScoreThreshold || 75;

  for (const job of qualifiedJobs) {
    const resume = config.resumes.find(r => r.id === job.selectedResumeId) || config.resumes[0];

    try {
      addLog(`  Scoring: ${job.title} @ ${job.company} with "${resume.name}" resume`);
      const ats = await claudeATS(job, resume, apiKey, profileName);
      job.ats = ats;
      job.selectedResumeName = resume.name;
      job.selectedResumeFile = resume.file;

      if (ats.overall_recommendation === "resume_missing") {
        job.autoApply = false;
        job.status    = "resume_missing";
        addLog(`  ⚠ Resume file missing for "${resume.name}" — add file to profiles/${profileName}/resumes/`, "warn");
      } else {
        const autoApply = ats.ats_score >= threshold;
        job.autoApply = autoApply;
        job.status    = "pending_approval";
        addLog(
          `  Score: ${ats.ats_score}/100 — ${autoApply ? "AUTO-APPLY candidate" : "needs review"}`,
          ats.ats_score >= threshold ? "success" : "warn"
        );
      }
    } catch (err) {
      addLog(`  ATS error for ${job.title}: ${err.message}`, "error");
      job.ats   = null;
      job.status = "ats_error";
    }

    markJobSeen(cache, job.jobId);
    allNewJobs.push(job);
    await sleep(1000);
  }

  // ── Step 5: Save Results ──
  const resultsPath = path.join(profileDir, "results.json");
  const existing    = readJSON(resultsPath, []);

  // Prepend new jobs, keep last 500
  const updated = [...allNewJobs, ...existing].slice(0, 500);
  writeJSON(resultsPath, updated);

  cache.lastRun = runStart;
  saveCache(profileDir, cache);

  // ── Step 6: Save Run Log ──
  const logsDir  = path.join(profileDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const logFile  = path.join(logsDir, `run_${runStart.slice(0,10)}.json`);
  writeJSON(logFile, { runStart, runEnd: new Date().toISOString(), profile: profileName, runLog });

  addLog(`Done — ${allNewJobs.length} jobs saved for ${config.profile.name}`, "success");

  return {
    profileName,
    profileDisplayName: config.profile.name,
    email: config.profile.email,
    jobsFound: discoveredJobs.length,
    newJobs: freshJobs.length,
    qualified: qualifiedJobs.length,
    scored: allNewJobs.length,
    autoApplyCandidates: allNewJobs.filter(j => j.autoApply).length,
    topJobs: allNewJobs.sort((a, b) => (b.ats?.ats_score || 0) - (a.ats?.ats_score || 0)).slice(0, 5),
    runLog,
  };
}

// ── Send Email Digest ─────────────────────────────────────────────────────────

function buildEmailBody(summary) {
  const { profileDisplayName, jobsFound, newJobs, qualified, scored, autoApplyCandidates, topJobs, runLog } = summary;
  const errors = runLog.filter(l => l.level === "error").length;

  let body = `JobPilot Nightly Run — ${new Date().toLocaleDateString()}\n`;
  body += `Profile: ${profileDisplayName}\n`;
  body += "=".repeat(50) + "\n\n";
  body += `Companies scanned:     ${jobsFound} jobs discovered\n`;
  body += `New (not seen before): ${newJobs}\n`;
  body += `Passed Ollama screen:  ${qualified}\n`;
  body += `ATS scored:            ${scored}\n`;
  body += `Auto-apply candidates: ${autoApplyCandidates}\n`;
  if (errors) body += `Errors during run:     ${errors} (check agent log)\n`;
  body += "\n";

  if (topJobs?.length) {
    body += "TOP MATCHES:\n" + "-".repeat(40) + "\n";
    topJobs.forEach((j, i) => {
      body += `\n${i + 1}. ${j.title}\n`;
      body += `   Company:  ${j.company}\n`;
      body += `   Location: ${j.location} (${j.remote})\n`;
      body += `   ATS Score: ${j.ats?.ats_score ?? "N/A"}/100\n`;
      body += `   Resume:   ${j.selectedResumeName}\n`;
      body += `   ${j.autoApply ? "★ AUTO-APPLY CANDIDATE" : "→ Review needed"}\n`;
      body += `   URL: ${j.url}\n`;
    });
  }

  body += "\n" + "=".repeat(50) + "\n";
  body += "Open JobPilot to review your approval queue.\n";
  return body;
}

async function sendEmailDigest(summary) {
  if (!summary.email) return;

  const subject = encodeURIComponent(`JobPilot — ${summary.autoApplyCandidates} new matches for ${summary.profileDisplayName}`);
  const body    = encodeURIComponent(buildEmailBody(summary));

  // Write a mailto file the UI can pick up to open
  const mailtoPath = path.join(PROFILES, summary.profileName, "pending_email.json");
  writeJSON(mailtoPath, {
    to: summary.email,
    subject: decodeURIComponent(subject),
    body: decodeURIComponent(body),
    createdAt: new Date().toISOString(),
  });
}

// ── Main Entry ────────────────────────────────────────────────────────────────

async function main() {
  const targetProfile = process.argv[2] || null;
  const testMode      = process.argv.includes("--test");
  const rescoreMode   = process.argv.includes("--rescore");
  const testCompany   = process.argv[process.argv.indexOf("--test") + 1] || null;

  // ── Test mode: run one company and print raw result ──
  if (testMode) {
    const profileName = targetProfile || "you";
    const profileDir  = path.join(PROFILES, profileName);
    const config      = readJSON(path.join(profileDir, "config.json"));
    const apiKey      = getAnthropicKey();
    const company     = testCompany
      ? config.companies.find(c => c.name.toLowerCase().includes(testCompany.toLowerCase()))
      : config.companies.find(c => c.enabled);

    if (!company) { console.log("Company not found."); process.exit(1); }

    console.log(`\n[TEST] Scanning: ${company.name}`);
    console.log(`[TEST] Career URL: ${company.careerUrl}\n`);

    const jobs = await scanCompany(company, config, apiKey, profileName);
    console.log(`\n[TEST] Jobs found: ${jobs.length}`);
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }

  // ── Rescore mode: re-run ATS on queue jobs with 0 or missing scores ──
  if (rescoreMode) {
    const profileName = targetProfile || "you";
    const profileDir  = path.join(PROFILES, profileName);
    const config      = readJSON(path.join(profileDir, "config.json"));
    const apiKey      = getAnthropicKey();
    const queuePath   = path.join(profileDir, "approval_queue.json");
    const queue       = readJSON(queuePath, []);
    const threshold   = config.preferences?.atsScoreThreshold || 75;

    const toRescore = queue.filter(j => !j.ats?.ats_score || j.ats.ats_score === 0);
    console.log(`\nRescore mode — ${toRescore.length} jobs with missing/zero scores\n`);

    for (const job of toRescore) {
      const resume = config.resumes.find(r => r.id === job.selectedResumeId) || config.resumes[0];
      console.log(`Scoring: ${job.title} @ ${job.company} with "${resume.name}" resume`);
      try {
        const ats = await claudeATS(job, resume, apiKey, profileName);
        job.ats = ats;
        job.selectedResumeName = resume.name;
        job.selectedResumeFile = resume.file;
        job.autoApply = ats.ats_score >= threshold;
        job.status    = "pending_approval";
        console.log(`  → Score: ${ats.ats_score}/100 (${ats.overall_recommendation})`);
      } catch (err) {
        console.log(`  → Error: ${err.message}`);
      }
      await sleep(1000);
    }

    // Save updated queue
    writeJSON(queuePath, queue);

    // Also update results.json
    const resultsPath = path.join(profileDir, "results.json");
    const results     = readJSON(resultsPath, []);
    for (const job of toRescore) {
      const idx = results.findIndex(r => r.jobId === job.jobId);
      if (idx !== -1) results[idx] = job;
    }
    writeJSON(resultsPath, results);

    console.log(`\nRescore complete — ${toRescore.length} jobs updated.`);
    return;
  }

  // Discover profiles
  const profileNames = targetProfile
    ? [targetProfile]
    : fs.readdirSync(PROFILES).filter(p => {
        const cfg = path.join(PROFILES, p, "config.json");
        return fs.existsSync(cfg);
      });

  if (profileNames.length === 0) {
    console.log("No profiles found in /profiles directory.");
    process.exit(1);
  }

  console.log(`\nJobPilot Scanner — ${new Date().toLocaleString()}`);
  console.log(`Running ${profileNames.length} profile(s): ${profileNames.join(", ")}\n`);

  const summaries = [];

  for (const name of profileNames) {
    try {
      const summary = await runProfile(name);
      summaries.push(summary);
      await sendEmailDigest(summary);
    } catch (err) {
      console.error(`[FATAL] Profile "${name}" failed: ${err.message}`);
      summaries.push({ profileName: name, error: err.message });
    }
  }

  // Write master run summary for the UI dashboard
  const masterSummary = {
    runAt: new Date().toISOString(),
    profiles: summaries,
  };
  writeJSON(path.join(DATA, "last_run.json"), masterSummary);

  console.log("\n── Run Complete ──");
  summaries.forEach(s => {
    if (s.error) {
      console.log(`  ${s.profileName}: FAILED — ${s.error}`);
    } else {
      console.log(`  ${s.profileName}: ${s.newJobs} new jobs, ${s.qualified} qualified, ${s.autoApplyCandidates} auto-apply candidates`);
    }
  });
  console.log("");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
