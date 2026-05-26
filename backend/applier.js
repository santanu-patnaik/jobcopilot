#!/usr/bin/env node
/**
 * JobPilot Auto-Apply Agent
 * Uses Playwright with your existing Chrome profile
 * Handles: LinkedIn Easy Apply, Workday, generic career sites
 * Usage: node backend/applier.js [profileName] [--mode=auto|manual]
 *   auto   = headless, applies to 85+ scored jobs overnight
 *   manual = visible browser, applies to 75-84 scored jobs from queue
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const PROFILES  = path.join(ROOT, "profiles");
const DATA      = path.join(ROOT, "data");

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJSON(p, fallback = null) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; }
  catch { return fallback; }
}

function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function log(profile, msg, level = "info") {
  const ts  = new Date().toISOString().slice(11, 19);
  const tag = { error: "ERR", warn: "WRN", success: " OK", info: "INF" }[level] || "INF";
  console.log(`[${ts}] [${tag}] [${profile}] ${msg}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Human-like random delay between min and max ms
function humanDelay(min = 800, max = 2200) {
  return sleep(min + Math.random() * (max - min));
}

// Find Chrome user data directory on Windows
function findChromeUserData() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data"),
    path.join(process.env.USERPROFILE || "", "AppData", "Local", "Google", "Chrome", "User Data"),
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[0];
}

// ── Resume preparation ────────────────────────────────────────────────────────

async function prepareResume(job, profileDir) {
  // Return the path to the resume file for this job
  const resumeFile = path.join(profileDir, job.selectedResumeFile || "resumes/resume.docx");
  if (fs.existsSync(resumeFile)) return resumeFile;

  // Try alternate extensions
  for (const ext of [".docx", ".pdf"]) {
    const alt = resumeFile.replace(/\.[^.]+$/, ext);
    if (fs.existsSync(alt)) return alt;
  }
  return null;
}

// ── Screenshot helper ─────────────────────────────────────────────────────────

async function takeScreenshot(page, profileDir, jobId, label) {
  const screenshotsDir = path.join(profileDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const filename = `${jobId}_${label}_${Date.now()}.png`;
  const filepath = path.join(screenshotsDir, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

// ── LinkedIn Easy Apply ───────────────────────────────────────────────────────

async function applyLinkedIn(page, job, resumePath, profileDir, profileName) {
  log(profileName, `LinkedIn: navigating to ${job.url}`);
  await page.goto(job.url, { waitUntil: "networkidle", timeout: 30000 });
  await humanDelay();

  // Look for Easy Apply button
  const easyApplyBtn = page.locator('button:has-text("Easy Apply"), .jobs-apply-button').first();
  const hasEasyApply = await easyApplyBtn.isVisible({ timeout: 5000 }).catch(() => false);

  if (!hasEasyApply) {
    log(profileName, `LinkedIn: no Easy Apply button found for ${job.title}`, "warn");
    return { success: false, reason: "no_easy_apply", fallback: true };
  }

  await easyApplyBtn.click();
  await humanDelay(1000, 2000);
  await takeScreenshot(page, profileDir, job.jobId, "01_easy_apply_opened");

  // Handle multi-step Easy Apply modal
  let step = 1;
  const maxSteps = 10;

  while (step <= maxSteps) {
    await humanDelay(500, 1200);

    // Upload resume if file input appears
    const fileInput = page.locator('input[type="file"]').first();
    const hasFileInput = await fileInput.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasFileInput && resumePath) {
      log(profileName, `LinkedIn: uploading resume at step ${step}`);
      await fileInput.setInputFiles(resumePath);
      await humanDelay(1500, 2500);
    }

    // Fill any visible text inputs that are empty (phone, city, etc.)
    const textInputs = page.locator('.jobs-easy-apply-form-section input[type="text"]:visible, .jobs-easy-apply-form-section input[type="tel"]:visible');
    const inputCount = await textInputs.count();
    for (let i = 0; i < inputCount; i++) {
      const input = textInputs.nth(i);
      const val   = await input.inputValue().catch(() => "");
      const label = await input.getAttribute("aria-label") || "";
      if (!val) {
        // Fill common fields
        if (/phone|mobile/i.test(label)) {
          await input.fill("000-000-0000"); // placeholder — user should update
        } else if (/city|location/i.test(label)) {
          await input.fill("Los Angeles, CA");
        }
        await humanDelay(300, 600);
      }
    }

    // Handle dropdowns (years of experience, etc.) — select first non-empty option
    const selects = page.locator('.jobs-easy-apply-form-section select:visible');
    const selectCount = await selects.count();
    for (let i = 0; i < selectCount; i++) {
      const select = selects.nth(i);
      const val    = await select.inputValue().catch(() => "");
      if (!val || val === "") {
        const options = await select.locator("option").all();
        if (options.length > 1) {
          await select.selectOption({ index: 1 });
          await humanDelay(200, 400);
        }
      }
    }

    // Check for Next / Review / Submit button
    const nextBtn   = page.locator('button:has-text("Next"), button:has-text("Continue"), button:has-text("Review")').first();
    const submitBtn = page.locator('button:has-text("Submit application"), button:has-text("Submit")').first();

    const hasSubmit = await submitBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasSubmit) {
      await takeScreenshot(page, profileDir, job.jobId, `0${step}_pre_submit`);
      await submitBtn.click();
      await humanDelay(2000, 3000);
      await takeScreenshot(page, profileDir, job.jobId, `0${step}_submitted`);
      log(profileName, `LinkedIn: submitted application for ${job.title}`, "success");
      return { success: true, platform: "linkedin", screenshotDir: path.join(profileDir, "screenshots") };
    }

    const hasNext = await nextBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasNext) {
      await takeScreenshot(page, profileDir, job.jobId, `0${step}_step`);
      await nextBtn.click();
      step++;
      continue;
    }

    // No button found — stuck
    await takeScreenshot(page, profileDir, job.jobId, `0${step}_stuck`);
    log(profileName, `LinkedIn: stuck at step ${step} for ${job.title}`, "warn");
    return { success: false, reason: "stuck_in_form", fallback: true };
  }

  return { success: false, reason: "max_steps_exceeded", fallback: true };
}

// ── Workday Application ───────────────────────────────────────────────────────

async function applyWorkday(page, job, resumePath, profileDir, profileName) {
  log(profileName, `Workday: navigating to ${job.url}`);
  await page.goto(job.url, { waitUntil: "networkidle", timeout: 30000 });
  await humanDelay(1500, 2500);
  await takeScreenshot(page, profileDir, job.jobId, "01_workday_opened");

  // Look for Apply button
  const applyBtn = page.locator('a:has-text("Apply"), button:has-text("Apply Now"), a:has-text("Apply Now")').first();
  const hasApply = await applyBtn.isVisible({ timeout: 8000 }).catch(() => false);

  if (!hasApply) {
    log(profileName, `Workday: no Apply button found`, "warn");
    return { success: false, reason: "no_apply_button", fallback: true };
  }

  await applyBtn.click();
  await humanDelay(2000, 3000);
  await takeScreenshot(page, profileDir, job.jobId, "02_workday_apply_clicked");

  // Handle sign-in if needed (use existing Chrome session — usually already signed in)
  const signInPrompt = page.locator('text="Sign In", text="Log In"').first();
  const needsSignIn  = await signInPrompt.isVisible({ timeout: 3000 }).catch(() => false);
  if (needsSignIn) {
    log(profileName, `Workday: sign-in required — please complete in browser`, "warn");
    await takeScreenshot(page, profileDir, job.jobId, "03_workday_signin_needed");
    return { success: false, reason: "signin_required", fallback: true };
  }

  // Upload resume
  const fileInput = page.locator('input[type="file"]').first();
  const hasFile   = await fileInput.isVisible({ timeout: 5000 }).catch(() => false);
  if (hasFile && resumePath) {
    log(profileName, `Workday: uploading resume`);
    await fileInput.setInputFiles(resumePath);
    await humanDelay(2000, 3000);
    await takeScreenshot(page, profileDir, job.jobId, "04_workday_resume_uploaded");
  }

  // Fill standard Workday fields
  await fillWorkdayFields(page, job, profileName);
  await humanDelay(1000, 2000);
  await takeScreenshot(page, profileDir, job.jobId, "05_workday_fields_filled");

  // Navigate through steps
  let step = 1;
  const maxSteps = 8;

  while (step <= maxSteps) {
    await humanDelay(800, 1500);

    const nextBtn   = page.locator('[data-automation-id="bottom-navigation-next-button"], button:has-text("Next")').first();
    const submitBtn = page.locator('[data-automation-id="bottom-navigation-submit-button"], button:has-text("Submit")').first();

    const hasSubmit = await submitBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasSubmit) {
      await takeScreenshot(page, profileDir, job.jobId, `0${step + 4}_pre_submit`);
      await submitBtn.click();
      await humanDelay(3000, 5000);
      await takeScreenshot(page, profileDir, job.jobId, `0${step + 4}_submitted`);
      log(profileName, `Workday: submitted application for ${job.title}`, "success");
      return { success: true, platform: "workday", screenshotDir: path.join(profileDir, "screenshots") };
    }

    const hasNext = await nextBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (!hasNext) break;

    await nextBtn.click();
    await humanDelay(1500, 2500);
    await takeScreenshot(page, profileDir, job.jobId, `0${step + 4}_step`);
    step++;
  }

  log(profileName, `Workday: could not complete form for ${job.title}`, "warn");
  return { success: false, reason: "incomplete_form", fallback: true };
}

async function fillWorkdayFields(page, job, profileName) {
  // Fill standard Workday application fields using data-automation-id selectors
  const fields = [
    { selector: '[data-automation-id="legalNameSection_firstName"]', value: "" }, // user fills
    { selector: '[data-automation-id="legalNameSection_lastName"]',  value: "" },
    { selector: '[data-automation-id="addressSection_addressLine1"]', value: "" },
    { selector: '[data-automation-id="addressSection_city"]',         value: "Los Angeles" },
    { selector: '[data-automation-id="phone-device-type"] input',     value: "" },
  ];

  for (const field of fields) {
    if (!field.value) continue; // skip empty placeholders
    try {
      const el = page.locator(field.selector).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        const existing = await el.inputValue().catch(() => "");
        if (!existing) {
          await el.fill(field.value);
          await humanDelay(200, 400);
        }
      }
    } catch { /* field not present on this form */ }
  }
}

// ── Detect Platform ───────────────────────────────────────────────────────────

function detectPlatform(url) {
  if (!url) return "unknown";
  if (/linkedin\.com/i.test(url))  return "linkedin";
  if (/myworkdayjobs|workday/i.test(url)) return "workday";
  if (/greenhouse\.io/i.test(url)) return "greenhouse";
  if (/lever\.co/i.test(url))      return "lever";
  if (/icims\.com/i.test(url))     return "icims";
  if (/taleo\.net/i.test(url))     return "taleo";
  return "generic";
}

// ── Launch Browser (once for all jobs) ────────────────────────────────────────

async function launchBrowser(mode, profileName) {
  const { chromium } = await import("playwright");

  // Use a dedicated Playwright profile to avoid locking your real Chrome profile
  const playwrightProfile = path.join(ROOT, "data", "chrome-profile");
  const headless          = mode === "auto";

  if (!fs.existsSync(playwrightProfile)) {
    log(profileName, "Creating Playwright Chrome profile (first time — you may need to log in)...");
    fs.mkdirSync(path.join(playwrightProfile, "Default"), { recursive: true });
  }

  log(profileName, `Launching Chrome (headless: ${headless})`);

  const context = await chromium.launchPersistentContext(playwrightProfile, {
    headless,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: null,
    slowMo: 100,
    timeout: 60000,
  });

  context.on("page", async page => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  });

  log(profileName, "Chrome launched successfully");
  return context;
}

// ── Apply to a single job (reuses open browser context) ──────────────────────

async function applyToJob(context, job, profileDir, mode, profileName) {
  const page = await context.newPage();

  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const resumePath = await prepareResume(job, profileDir);
    if (!resumePath) {
      log(profileName, `Resume file not found for ${job.title}`, "warn");
      await page.close();
      return { success: false, reason: "no_resume" };
    }

    // ── Pre-check: verify URL is still live ──
    log(profileName, `Checking URL: ${job.url}`);
    const response = await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    const status   = response?.status() || 0;

    if (status === 404 || status === 410) {
      log(profileName, `Job posting expired (HTTP ${status}): ${job.title}`, "warn");
      await page.close();
      return { success: false, reason: "posting_expired", status };
    }

    // Check for soft 404s — page loaded but shows "not found" text
    const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const softExpired = /job (not found|no longer|has been filled|expired|closed|removed|unavailable)/i.test(pageText) ||
                        /this (position|role|job|posting) (is|has been) (closed|filled|removed)/i.test(pageText) ||
                        /we couldn't find that page|oops.*couldn't find/i.test(pageText);

    if (softExpired) {
      log(profileName, `Job posting appears expired (soft 404): ${job.title}`, "warn");
      await page.close();
      return { success: false, reason: "posting_expired_soft" };
    }

    const platform = detectPlatform(job.url);
    const headless  = mode === "auto";
    log(profileName, `Platform: ${platform} — ${job.title}`);

    let result;
    if (platform === "linkedin") {
      result = await applyLinkedIn(page, job, resumePath, profileDir, profileName);
    } else if (platform === "workday") {
      result = await applyWorkday(page, job, resumePath, profileDir, profileName);
    } else {
      log(profileName, `Unknown platform (${platform}) — opening for manual completion`, "warn");
      await page.goto(job.url, { waitUntil: "networkidle", timeout: 30000 });
      await takeScreenshot(page, profileDir, job.jobId, "01_manual_fallback");
      result = { success: false, reason: "manual_required", fallback: true };
    }

    if (result.fallback && !headless) {
      log(profileName, `Manual completion needed — browser tab is open. Press Enter when done...`);
      await new Promise(resolve => process.stdin.once("data", resolve));
      await takeScreenshot(page, profileDir, job.jobId, "99_manual_completed");
      result = { success: true, platform: platform + "_manual" };
    }

    await page.close().catch(() => {});
    return result;

  } catch (err) {
    log(profileName, `Apply error for ${job.title}: ${err.message}`, "error");
    await page.close().catch(() => {});
    return { success: false, reason: "error", error: err.message };
  }
}

// ── Process Queue ─────────────────────────────────────────────────────────────

async function processQueue(profileName, mode) {
  const profileDir   = path.join(PROFILES, profileName);
  const config       = readJSON(path.join(profileDir, "config.json"), {});
  const queuePath    = path.join(profileDir, "approval_queue.json");
  const appsPath     = path.join(profileDir, "applications.json");
  const applyLogPath = path.join(profileDir, "apply_log.json");

  const queue    = readJSON(queuePath, []);
  const apps     = readJSON(appsPath, []);
  const applyLog = readJSON(applyLogPath, []);

  const threshold = mode === "auto" ? 85 : 40;
  const maxScore  = mode === "auto" ? 100 : 84;

  const candidates = queue.filter(j => {
    const score = j.ats?.ats_score;
    if (!score) return false;
    return score >= threshold && score <= maxScore && j.status === "pending_approval";
  });

  log(profileName, `Auto-apply mode: ${mode} — ${candidates.length} candidates (score ${threshold}-${maxScore})`);

  if (candidates.length === 0) {
    log(profileName, "No candidates for auto-apply in this range.", "info");
    return;
  }

  // Launch ONE browser for all jobs
  let context;
  try {
    context = await launchBrowser(mode, profileName);
  } catch (err) {
    log(profileName, `Failed to launch browser: ${err.message}`, "error");
    log(profileName, "Make sure Chrome is completely closed before running apply.", "error");
    return;
  }

  const results = [];

  try {
    for (const job of candidates) {
      log(profileName, `\nApplying to: ${job.title} @ ${job.company} (ATS: ${job.ats.ats_score})`);

      if (results.length > 0) await sleep(3000 + Math.random() * 3000);

      const result = await applyToJob(context, job, profileDir, mode, profileName);

      const logEntry = {
        jobId:     job.jobId,
        title:     job.title,
        company:   job.company,
        url:       job.url,
        atsScore:  job.ats.ats_score,
        resume:    job.selectedResumeName,
        mode,
        result,
        appliedAt: new Date().toISOString(),
      };

      applyLog.unshift(logEntry);
      results.push(logEntry);

      if (result.success) {
        const app = {
          id:             `app_${Date.now()}_${job.jobId}`,
          profileId:      profileName,
          jobId:          job.jobId,
          title:          job.title,
          company:        job.company,
          location:       job.location,
          remote:         job.remote,
          url:            job.url,
          dateDiscovered: job.postedDate || new Date().toISOString(),
          dateApplied:    new Date().toISOString(),
          resumeVersion:  job.selectedResumeName,
          resumeFile:     job.selectedResumeFile,
          atsScore:       job.ats.ats_score,
          status:         "Applied",
          autoApplied:    true,
          platform:       result.platform,
          notes:          "",
        };
        apps.unshift(app);
        const updatedQueue = readJSON(queuePath, []).filter(j => j.jobId !== job.jobId);
        writeJSON(queuePath, updatedQueue);
        log(profileName, `✓ Applied and logged: ${job.title}`, "success");
      } else if (result.reason?.startsWith("posting_expired")) {
        // Remove expired jobs from queue silently
        log(profileName, `⊘ Expired — removing from queue: ${job.title}`, "warn");
        const updatedQueue = readJSON(queuePath, []).filter(j => j.jobId !== job.jobId);
        writeJSON(queuePath, updatedQueue);
      } else {
        log(profileName, `✗ Failed: ${job.title} — ${result.reason}`, "warn");
        const updatedQueue = readJSON(queuePath, []).map(j =>
          j.jobId === job.jobId ? { ...j, status: "apply_failed", failReason: result.reason } : j
        );
        writeJSON(queuePath, updatedQueue);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  writeJSON(appsPath, apps);
  writeJSON(applyLogPath, applyLog.slice(0, 200));

  const succeeded = results.filter(r => r.result.success).length;
  const failed    = results.length - succeeded;
  log(profileName, `\nAuto-apply complete — ${succeeded} submitted, ${failed} failed/manual`, "success");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const profileName = process.argv[2] || "you";
  const modeArg     = process.argv.find(a => a.startsWith("--mode="));
  const mode        = modeArg ? modeArg.split("=")[1] : "manual";

  console.log(`\nJobPilot Auto-Apply — ${new Date().toLocaleString()}`);
  console.log(`Profile: ${profileName} | Mode: ${mode}\n`);

  // Check playwright is installed
  try {
    await import("playwright");
  } catch {
    console.error("Playwright not installed. Run: npm install playwright && npx playwright install chrome");
    process.exit(1);
  }

  await processQueue(profileName, mode);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
