import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEYS = {
  CONFIG: "jobpilot-config",
  RESULTS: "jobpilot-results",
  API_KEY: "jobpilot-api-key",
};

// Fallback config used only if config.json AND localStorage are both unavailable
const FALLBACK_CONFIG = {
  companies: [],
  jobCategories: [],
  preferences: {
    location: "",
    remote: true,
    experienceLevel: "entry-mid",
    emailResults: false,
    emailAddress: "",
  },
};

const CONFIG_FILE_PATH = "/config.json";

const genId = () => Math.random().toString(36).slice(2, 9);

// ── Storage helpers (localStorage) ──
const store = {
  get(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};

// Fetch config.json from the public folder
async function loadFileConfig() {
  try {
    const res = await fetch(CONFIG_FILE_PATH + "?t=" + Date.now()); // cache-bust
    if (!res.ok) throw new Error("Not found");
    return await res.json();
  } catch {
    return null;
  }
}

// ── Icon Components ──
const Icons = {
  Search: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  ),
  Settings: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  ),
  List: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
  ),
  Plus: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  ),
  Trash: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
  ),
  Mail: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
  ),
  Bot: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><line x1="8" y1="16" x2="8" y2="16.01"/><line x1="16" y1="16" x2="16" y2="16.01"/></svg>
  ),
  External: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
  ),
  Clock: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  ),
  Download: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
  ),
  Zap: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
  ),
  Copy: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
  ),
  Briefcase: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
  ),
  Refresh: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
  ),
  Key: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
  ),
  Eye: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
  ),
  EyeOff: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  ),
};

// ── Chip Input Component ──
function ChipInput({ chips, onChange, placeholder }) {
  const [inputVal, setInputVal] = useState("");
  const ref = useRef(null);

  const addChip = (val) => {
    const v = val.trim();
    if (v && !chips.includes(v)) onChange([...chips, v]);
    setInputVal("");
  };

  const removeChip = (i) => onChange(chips.filter((_, idx) => idx !== i));

  const handleKey = (e) => {
    if ((e.key === "Enter" || e.key === ",") && inputVal.trim()) {
      e.preventDefault();
      addChip(inputVal);
    }
    if (e.key === "Backspace" && !inputVal && chips.length) {
      removeChip(chips.length - 1);
    }
  };

  return (
    <div className="chip-input-wrap" onClick={() => ref.current?.focus()}>
      {chips.map((c, i) => (
        <span className="chip" key={i}>
          {c}
          <span className="chip-remove" onClick={() => removeChip(i)}>&times;</span>
        </span>
      ))}
      <input
        ref={ref}
        className="chip-input-inner"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => inputVal.trim() && addChip(inputVal)}
        placeholder={chips.length === 0 ? placeholder : ""}
      />
    </div>
  );
}

// ── Toast Notification ──
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`toast toast-${type}`}>
      {type === "success" && <Icons.Check />}
      {type === "error" && "⚠"}
      {type === "info" && "ℹ"}
      <span>{message}</span>
    </div>
  );
}

// ═══════════════════════════
// ── MAIN APP ──
// ═══════════════════════════
const PROFILES_KEY = "jobpilot-profiles";
const APPLICATIONS_KEY = "jobpilot-applications";
const LAST_RUN_KEY = "jobpilot-lastrun";

export default function App() {
  const [tab, setTab] = useState("search");
  const [config, setConfig] = useState(() => store.get(STORAGE_KEYS.CONFIG) || FALLBACK_CONFIG);
  const [configSource, setConfigSource] = useState("loading");
  const [results, setResults] = useState(() => store.get(STORAGE_KEYS.RESULTS) || []);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEYS.API_KEY) || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [searchStatus, setSearchStatus] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [filterCompany, setFilterCompany] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [toasts, setToasts] = useState([]);

  // ── Profile state ──
  const [activeProfile, setActiveProfile] = useState(() => store.get(PROFILES_KEY)?.active || "you");
  const [profiles] = useState([
    { id: "you",    name: "You" },
    { id: "spouse", name: "Spouse" },
  ]);

  // ── Applications tracker ──
  const [applications, setApplications] = useState(() => store.get(APPLICATIONS_KEY) || []);
  const [approvalQueue, setApprovalQueue] = useState(() => store.get("jobpilot-approval") || []);
  const [lastRun, setLastRun] = useState(() => store.get(LAST_RUN_KEY) || null);
  const [notesDraft, setNotesDraft] = useState({});
  const [editingNotes, setEditingNotes] = useState(null);

  // Persist applications
  useEffect(() => { store.set(APPLICATIONS_KEY, applications); }, [applications]);
  useEffect(() => { store.set("jobpilot-approval", approvalQueue); }, [approvalQueue]);
  useEffect(() => { store.set(PROFILES_KEY, { active: activeProfile }); }, [activeProfile]);

  // Status options for tracker
  const STATUS_OPTIONS = ["Pending", "Applied", "Interview", "Offer", "Rejected"];
  const STATUS_COLORS  = { Pending: "#888", Applied: "#2980b9", Interview: "#1a9e75", Offer: "#27a845", Rejected: "#c0392b" };

  const updateAppStatus = (appId, status) => {
    setApplications(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
  };

  const updateAppNotes = (appId, notes) => {
    setApplications(prev => prev.map(a => a.id === appId ? { ...a, notes } : a));
    setEditingNotes(null);
  };

  const approveJob = (job, resumeOverride) => {
    const app = {
      id: genId(),
      profileId: activeProfile,
      jobId: job.jobId || genId(),
      title: job.title,
      company: job.company,
      location: job.location,
      remote: job.remote,
      url: job.url,
      dateDiscovered: job.postedDate || new Date().toISOString(),
      dateApplied: new Date().toISOString(),
      resumeVersion: resumeOverride || job.selectedResumeName || "Primary",
      resumeFile: job.selectedResumeFile || "",
      atsScore: job.ats?.ats_score || null,
      suggestionsAccepted: 0,
      status: "Applied",
      notes: "",
      autoApply: job.autoApply || false,
    };
    setApplications(prev => [app, ...prev]);
    setApprovalQueue(prev => prev.filter(j => j.jobId !== job.jobId));
    addToast(`Application logged: ${job.title} @ ${job.company}`, "success");
  };

  const dismissJob = (jobId) => {
    setApprovalQueue(prev => prev.filter(j => j.jobId !== jobId));
    addToast("Job dismissed from queue", "info");
  };

  // ── Load config: localStorage first, then config.json ──
  useEffect(() => {
    const stored = store.get(STORAGE_KEYS.CONFIG);
    if (stored && stored.companies?.length > 0) {
      setConfig(stored);
      setConfigSource("local");
    } else {
      loadFileConfig().then((fileConfig) => {
        if (fileConfig) {
          setConfig(fileConfig);
          store.set(STORAGE_KEYS.CONFIG, fileConfig);
          setConfigSource("file");
        } else {
          setConfigSource("file");
        }
      });
    }
  }, []);

  // Reset to config.json (discards localStorage overrides)
  const resetToFileConfig = async () => {
    const fileConfig = await loadFileConfig();
    if (fileConfig) {
      setConfig(fileConfig);
      store.set(STORAGE_KEYS.CONFIG, fileConfig);
      setConfigSource("file");
      addToast("Config reloaded from config.json!", "success");
    } else {
      addToast("Could not load config.json — file may be missing.", "error");
    }
  };

  // Persist config
  useEffect(() => { store.set(STORAGE_KEYS.CONFIG, config); }, [config]);
  useEffect(() => { if (results.length) store.set(STORAGE_KEYS.RESULTS, results); }, [results]);
  useEffect(() => { if (apiKey) localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey); }, [apiKey]);

  const addToast = (message, type = "info") => {
    const id = genId();
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const addLog = useCallback((msg, level = "info") => {
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    setLogs((prev) => [...prev, { ts, msg, level }]);
  }, []);

  // ── SEARCH HANDLER ──
  const runSearch = async () => {
    if (!apiKey.trim()) {
      addToast("Please enter your Anthropic API key in the Config tab first.", "error");
      setTab("config");
      return;
    }

    const enabledCompanies = config.companies.filter((c) => c.enabled);
    const enabledCategories = config.jobCategories.filter((c) => c.enabled);

    if (!enabledCompanies.length) { addLog("No companies enabled. Check config.", "warn"); return; }
    if (!enabledCategories.length) { addLog("No job categories enabled. Check config.", "warn"); return; }

    setSearchStatus("running");
    setResults([]);
    setLogs([]);
    setProgress(0);
    addLog("Initializing job search agent...", "info");
    addLog(`Searching ${enabledCompanies.length} companies for ${enabledCategories.length} categories`, "info");

    const allResults = [];
    const total = enabledCompanies.length;

    for (let i = 0; i < enabledCompanies.length; i++) {
      const company = enabledCompanies[i];
      addLog(`Scanning ${company.name} career page...`, "info");
      setProgress(Math.round(((i) / total) * 100));

      try {
        const keywords = enabledCategories.flatMap((c) => c.keywords);
        const categoryLabels = enabledCategories.map((c) => c.label);

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey.trim(),
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
            messages: [
              {
                role: "user",
                content: `You are a job search assistant. Search for recently posted job openings at ${company.name} (career page: ${company.careerUrl}).

Look for roles matching these categories: ${categoryLabels.join(", ")}
Keywords to match: ${keywords.join(", ")}
Preferred location: ${config.preferences.location}
Include remote: ${config.preferences.remote ? "Yes" : "No"}
Experience level: ${config.preferences.experienceLevel}

Return ONLY a JSON array (no markdown, no backticks, no explanation) of job objects found today or very recently. Each object must have these exact keys:
- "title": job title string
- "company": "${company.name}"
- "location": office location string
- "remote": "Remote" or "Hybrid" or "On-site"
- "category": best matching category from [${categoryLabels.join(", ")}]
- "url": direct link to the job posting
- "postedDate": ISO date string

If no matching jobs are found, return exactly: []
Return ONLY valid JSON, nothing else.`,
              },
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API ${response.status}: ${errText.slice(0, 120)}`);
        }

        const data = await response.json();

        const textContent = data.content
          ?.filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();

        if (textContent) {
          try {
            const cleaned = textContent.replace(/```json|```/g, "").trim();
            const jobs = JSON.parse(cleaned);
            if (Array.isArray(jobs)) {
              const withIds = jobs.map((j) => ({
                ...j,
                id: genId(),
                isNew: true,
                postedDate: j.postedDate || new Date().toISOString(),
              }));
              allResults.push(...withIds);
              addLog(`Found ${withIds.length} matching roles at ${company.name}`, "success");
            }
          } catch {
            addLog(`Could not parse structured results from ${company.name} — response may contain narrative text`, "warn");
          }
        } else {
          addLog(`${company.name}: AI is processing with web search (check logs)`, "info");
        }
      } catch (err) {
        addLog(`Error scanning ${company.name}: ${err.message}`, "error");
      }

      setProgress(Math.round(((i + 1) / total) * 100));
    }

    setResults(allResults);
    addLog(`Search complete. ${allResults.length} jobs found.`, allResults.length > 0 ? "success" : "warn");
    setSearchStatus("done");
    setProgress(100);

    if (allResults.length > 0) {
      addToast(`Found ${allResults.length} matching jobs!`, "success");
    } else {
      addToast("No matching jobs found. Try broadening your search.", "info");
    }
  };

  // ── CONFIG UPDATERS ──
  const updateCompany = (id, field, value) => {
    setConfig((prev) => ({
      ...prev,
      companies: prev.companies.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    }));
  };

  const addCompany = () => {
    setConfig((prev) => ({
      ...prev,
      companies: [...prev.companies, { id: genId(), name: "", careerUrl: "", enabled: true }],
    }));
  };

  const removeCompany = (id) => {
    setConfig((prev) => ({
      ...prev,
      companies: prev.companies.filter((c) => c.id !== id),
    }));
  };

  const updateCategory = (id, field, value) => {
    setConfig((prev) => ({
      ...prev,
      jobCategories: prev.jobCategories.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    }));
  };

  const addCategory = () => {
    setConfig((prev) => ({
      ...prev,
      jobCategories: [...prev.jobCategories, { id: genId(), label: "", keywords: [], enabled: true }],
    }));
  };

  const removeCategory = (id) => {
    setConfig((prev) => ({
      ...prev,
      jobCategories: prev.jobCategories.filter((c) => c.id !== id),
    }));
  };

  const updatePref = (field, value) => {
    setConfig((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, [field]: value },
    }));
  };

  // ── FILTERED RESULTS ──
  const filtered = results.filter((r) => {
    if (filterCompany !== "all" && r.company !== filterCompany) return false;
    if (filterCategory !== "all" && r.category !== filterCategory) return false;
    return true;
  });

  const uniqueCompanies = [...new Set(results.map((r) => r.company))];
  const uniqueCategories = [...new Set(results.map((r) => r.category))];

  // ── EXPORT ──
  const exportText = () => {
    const lines = filtered.map(
      (r) => `${r.title} — ${r.company} (${r.location}, ${r.remote})\n  ${r.url}`
    );
    return `Job Search Results — ${new Date().toLocaleDateString()}\n${"═".repeat(50)}\n\n${lines.join("\n\n")}`;
  };

  const copyResults = () => {
    navigator.clipboard.writeText(exportText());
    setCopiedId("all");
    addToast("Results copied to clipboard!", "success");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const emailResults = () => {
    const subject = encodeURIComponent(`Job Search Results — ${new Date().toLocaleDateString()}`);
    const body = encodeURIComponent(exportText());
    const to = config.preferences.emailAddress || "";
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, "_blank");
  };

  const downloadResults = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-results-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast("Results downloaded!", "success");
  };

  // ── JSON CONFIG EDITOR ──
  const openJsonEditor = () => {
    setJsonDraft(JSON.stringify(config, null, 2));
    setShowJsonEditor(true);
  };

  const saveJsonConfig = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      setConfig(parsed);
      setConfigSource("local");
      setShowJsonEditor(false);
      addToast("Config updated from JSON!", "success");
    } catch {
      addToast("Invalid JSON. Please fix and try again.", "error");
    }
  };

  const importConfig = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        setConfig(parsed);
        setConfigSource("local");
        addToast("Config imported successfully!", "success");
      } catch {
        addToast("Invalid config file.", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  return (
    <>
      <div className="app">
        {/* ── TOASTS ── */}
        <div className="toast-container">
          {toasts.map((t) => (
            <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
          ))}
        </div>

        {/* ── HEADER ── */}
        <header className="header">
          <div className="header-left">
            <div className="logo-mark"><Icons.Briefcase /></div>
            <div>
              <div className="logo-title">JobPilot</div>
              <div className="logo-sub">AI Career Search Agent</div>
            </div>
          </div>
          <div className="header-right">
            {/* Profile Switcher */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {profiles.map(p => (
                <button
                  key={p.id}
                  onClick={() => setActiveProfile(p.id)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 20,
                    border: "1px solid",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    background: activeProfile === p.id ? "var(--accent)" : "transparent",
                    color: activeProfile === p.id ? "#fff" : "var(--text-secondary)",
                    borderColor: activeProfile === p.id ? "var(--accent)" : "var(--border)",
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className={`api-status ${apiKey ? "connected" : "disconnected"}`}>
              <span className="api-dot" />
              {apiKey ? "API Connected" : "No API Key"}
            </div>
            <div className="today-badge">
              <Icons.Clock /> {dateStr}
            </div>
          </div>
        </header>

        {/* ── TABS ── */}
        <div className="tab-bar">
          <button className={`tab ${tab === "search" ? "active" : ""}`} onClick={() => setTab("search")}>
            <Icons.Search /> Search
            {results.length > 0 && <span className="tab-count">{results.length}</span>}
          </button>
          <button className={`tab ${tab === "approval" ? "active" : ""}`} onClick={() => setTab("approval")}>
            <Icons.Check /> Approval Queue
            {approvalQueue.filter(j => j.profileId === activeProfile).length > 0 && (
              <span className="tab-count" style={{ background: "var(--warning, #f39c12)" }}>
                {approvalQueue.filter(j => j.profileId === activeProfile).length}
              </span>
            )}
          </button>
          <button className={`tab ${tab === "tracker" ? "active" : ""}`} onClick={() => setTab("tracker")}>
            <Icons.List /> Applications
            {applications.filter(a => a.profileId === activeProfile).length > 0 && (
              <span className="tab-count">{applications.filter(a => a.profileId === activeProfile).length}</span>
            )}
          </button>
          <button className={`tab ${tab === "config" ? "active" : ""}`} onClick={() => setTab("config")}>
            <Icons.Settings /> Config
          </button>
          <button className={`tab ${tab === "results" ? "active" : ""}`} onClick={() => setTab("results")}>
            <Icons.List /> Results
            {filtered.length > 0 && <span className="tab-count">{filtered.length}</span>}
          </button>
          <button className={`tab ${tab === "autoapply" ? "active" : ""}`} onClick={() => setTab("autoapply")}>
            <Icons.Zap /> Auto-Apply
          </button>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className="main">

          {/* ═══ SEARCH TAB ═══ */}
          {tab === "search" && (
            <>
              {/* API Key Warning */}
              {!apiKey && (
                <div className="api-warning">
                  <Icons.Key />
                  <span>You need an Anthropic API key to run searches. Go to <strong onClick={() => setTab("config")} style={{ cursor: "pointer", textDecoration: "underline" }}>Config</strong> to set it up.</span>
                </div>
              )}

              {/* Status Bar */}
              <div className="status-bar">
                <div className="status-row">
                  <span className={`status-dot ${searchStatus}`} />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {searchStatus === "idle" && "Ready to search"}
                    {searchStatus === "running" && "Scanning career pages..."}
                    {searchStatus === "done" && `Search complete — ${results.length} jobs found`}
                    {searchStatus === "error" && "Search encountered an error"}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    {searchStatus === "done" && (
                      <button className="btn btn-sm" onClick={() => { setSearchStatus("idle"); setResults([]); setLogs([]); setProgress(0); }}>
                        <Icons.Refresh /> Reset
                      </button>
                    )}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={runSearch}
                      disabled={searchStatus === "running"}
                      style={{ opacity: searchStatus === "running" ? 0.6 : 1 }}
                    >
                      <Icons.Search />
                      {searchStatus === "running" ? "Searching..." : "Run Search"}
                    </button>
                  </div>
                </div>
                {searchStatus === "running" && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>

              {/* Quick Summary */}
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-value" style={{ color: "var(--accent)" }}>
                    {config.companies.filter((c) => c.enabled).length}
                  </div>
                  <div className="stat-label">Companies</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value" style={{ color: "var(--purple)" }}>
                    {config.jobCategories.filter((c) => c.enabled).length}
                  </div>
                  <div className="stat-label">Categories</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value" style={{ color: "var(--success)" }}>
                    {results.length}
                  </div>
                  <div className="stat-label">Jobs Found</div>
                </div>
              </div>

              {/* Logs */}
              {logs.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title"><Icons.Bot /> Agent Log</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setLogs([])}>Clear</button>
                  </div>
                  <div className="card-body">
                    <div className="log-area">
                      {logs.map((l, i) => (
                        <div className="log-line" key={i}>
                          <span className="log-time">{l.ts}</span>
                          <span className={`log-msg-${l.level}`}>{l.msg}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Quick results preview */}
              {results.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Latest Results</span>
                    <button className="btn btn-sm" onClick={() => setTab("results")}>View All →</button>
                  </div>
                  <div className="card-body">
                    {results.slice(0, 3).map((r) => (
                      <div className="result-card" key={r.id}>
                        <div className="result-top">
                          <div>
                            <div className="result-company">{r.company}</div>
                            <div className="result-title">{r.title}</div>
                          </div>
                          <span className="badge badge-new">NEW</span>
                        </div>
                        <div className="result-meta">
                          <span>{r.location}</span>
                          <span className={`badge ${r.remote === "Remote" ? "badge-remote" : "badge-hybrid"}`}>
                            {r.remote}
                          </span>
                          <span style={{ color: "var(--text-muted)" }}>{r.category}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ═══ APPROVAL QUEUE TAB ═══ */}
          {tab === "approval" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700 }}>Morning Approval Queue</h2>
                  <p className="section-desc" style={{ marginBottom: 0 }}>
                    Jobs that passed overnight screening for <strong>{profiles.find(p => p.id === activeProfile)?.name}</strong>. Review, then approve or dismiss.
                  </p>
                </div>
              </div>

              {approvalQueue.filter(j => j.profileId === activeProfile).length === 0 ? (
                <div className="card">
                  <div className="card-body" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Queue is empty</div>
                    <div style={{ fontSize: 13 }}>New jobs from the nightly scan will appear here for your review.</div>
                  </div>
                </div>
              ) : (
                approvalQueue.filter(j => j.profileId === activeProfile).map(job => (
                  <div className="card" key={job.jobId} style={{ marginBottom: 12 }}>
                    <div className="card-header">
                      <span className="card-title">{job.title}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <span style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 12,
                          background: job.resumeSelectionConfidence === "high" ? "var(--success-bg, #eafaf1)" : "var(--warning-bg, #fef9f0)",
                          color: job.resumeSelectionConfidence === "high" ? "var(--success, #1a9e75)" : "var(--warning, #e67e22)",
                          fontWeight: 500,
                        }}>
                          {job.resumeSelectionConfidence === "high" ? "✓" : "⚠"} {job.selectedResumeName || "Resume TBD"} resume
                        </span>
                        {job.ats && (
                          <span style={{
                            fontSize: 11, padding: "3px 8px", borderRadius: 12, fontWeight: 600,
                            background: job.ats.ats_score >= 75 ? "var(--success-bg, #eafaf1)" : "var(--bg-input)",
                            color: job.ats.ats_score >= 75 ? "var(--success, #1a9e75)" : "var(--text-secondary)",
                          }}>
                            ATS {job.ats.ats_score}/100
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="card-body">
                      <div className="result-meta" style={{ marginBottom: 10 }}>
                        <span style={{ fontWeight: 500 }}>{job.company}</span>
                        <span>{job.location}</span>
                        <span className={`badge ${job.remote === "Remote" ? "badge-remote" : "badge-hybrid"}`}>{job.remote}</span>
                        <a href={job.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">View Job <Icons.External /></a>
                      </div>

                      {job.ats?.suggestions?.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}>
                            Claude Suggestions ({job.ats.suggestions.length})
                          </div>
                          {job.ats.suggestions.slice(0, 3).map((s, i) => (
                            <div key={i} style={{
                              fontSize: 12, padding: "8px 10px", borderRadius: 6, marginBottom: 6,
                              background: "var(--bg-input)", borderLeft: `3px solid ${s.impact === "high" ? "var(--accent)" : "var(--border)"}`,
                            }}>
                              <div style={{ fontWeight: 600, marginBottom: 2 }}>{s.section} — {s.type}</div>
                              <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>{s.original || "Add new content"}</div>
                              <div style={{ color: "var(--success, #1a9e75)" }}>→ {s.suggested}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="btn btn-sm" onClick={() => dismissJob(job.jobId)}>Dismiss</button>
                        <button className="btn btn-sm btn-primary" onClick={() => approveJob(job, null)}>
                          <Icons.Check /> Log Application
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {/* ═══ APPLICATIONS TRACKER TAB ═══ */}
          {tab === "tracker" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700 }}>Applications Tracker</h2>
                  <p className="section-desc" style={{ marginBottom: 0 }}>
                    Every application logged for <strong>{profiles.find(p => p.id === activeProfile)?.name}</strong> — resume version, ATS score, and current status.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {STATUS_OPTIONS.map(s => (
                    <span key={s} style={{
                      fontSize: 11, padding: "2px 8px", borderRadius: 10,
                      background: STATUS_COLORS[s] + "20",
                      color: STATUS_COLORS[s],
                      fontWeight: 500,
                    }}>
                      {applications.filter(a => a.profileId === activeProfile && a.status === s).length} {s}
                    </span>
                  ))}
                </div>
              </div>

              {applications.filter(a => a.profileId === activeProfile).length === 0 ? (
                <div className="card">
                  <div className="card-body" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>No applications yet</div>
                    <div style={{ fontSize: 13 }}>Approve jobs from the queue and they'll appear here with full tracking.</div>
                  </div>
                </div>
              ) : (
                applications.filter(a => a.profileId === activeProfile).map(app => (
                  <div className="card" key={app.id} style={{ marginBottom: 10 }}>
                    <div className="card-header">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{app.title}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{app.company} · {app.location} · {app.remote}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {app.atsScore && (
                          <span style={{ fontSize: 12, fontWeight: 600, color: app.atsScore >= 75 ? "var(--success, #1a9e75)" : "var(--text-secondary)" }}>
                            ATS {app.atsScore}/100
                          </span>
                        )}
                        <span style={{
                          fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 500,
                          background: "var(--cyan-bg, #e8f8f5)", color: "var(--cyan, #16a085)",
                        }}>
                          {app.resumeVersion}
                        </span>
                        <select
                          value={app.status}
                          onChange={e => updateAppStatus(app.id, e.target.value)}
                          style={{
                            fontSize: 11, padding: "3px 8px", borderRadius: 10, border: "1px solid",
                            borderColor: STATUS_COLORS[app.status] + "60",
                            background: STATUS_COLORS[app.status] + "15",
                            color: STATUS_COLORS[app.status],
                            fontWeight: 500, cursor: "pointer",
                          }}
                        >
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="card-body" style={{ paddingTop: 8 }}>
                      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                        <span>Applied: {new Date(app.dateApplied).toLocaleDateString()}</span>
                        <span>Discovered: {new Date(app.dateDiscovered).toLocaleDateString()}</span>
                        {app.autoApply && <span style={{ color: "var(--success, #1a9e75)" }}>★ Auto-apply candidate</span>}
                      </div>

                      {editingNotes === app.id ? (
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <textarea
                            style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid var(--border)", fontSize: 12, minHeight: 60, background: "var(--bg-input)", color: "var(--text-primary)", resize: "vertical" }}
                            value={notesDraft[app.id] ?? app.notes}
                            onChange={e => setNotesDraft(prev => ({ ...prev, [app.id]: e.target.value }))}
                            placeholder="Interview prep notes, follow-up dates, contacts..."
                          />
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => updateAppNotes(app.id, notesDraft[app.id] ?? app.notes)}>Save</button>
                            <button className="btn btn-sm" onClick={() => setEditingNotes(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => setEditingNotes(app.id)}
                          style={{ fontSize: 12, color: app.notes ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", padding: "6px 8px", borderRadius: 6, background: "var(--bg-input)", minHeight: 32 }}
                        >
                          {app.notes || "Click to add prep notes..."}
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                        <a href={app.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                          View Posting <Icons.External />
                        </a>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
          {tab === "config" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700 }}>Search Configuration</h2>
                  <p className="section-desc" style={{ marginBottom: 0 }}>
                    Edit here (saves to localStorage) or edit <code style={{ background: "var(--bg-input)", padding: "2px 6px", borderRadius: 4, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>public/config.json</code> directly.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{
                    fontSize: 11,
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontFamily: "'JetBrains Mono', monospace",
                    background: configSource === "local" ? "var(--cyan-bg)" : "var(--success-bg)",
                    color: configSource === "local" ? "var(--cyan)" : "var(--success)",
                  }}>
                    {configSource === "local" ? "localStorage" : "config.json"}
                  </span>
                  <button className="btn btn-sm" onClick={resetToFileConfig} title="Reload from public/config.json">
                    <Icons.Refresh /> Reset to File
                  </button>
                  <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                    <Icons.Plus /> Import
                    <input type="file" accept=".json" onChange={importConfig} style={{ display: "none" }} />
                  </label>
                  <button className="btn btn-sm" onClick={openJsonEditor}>
                    {"{ }"} Edit JSON
                  </button>
                  <button className="btn btn-sm" onClick={() => {
                    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "job-search-config.json"; a.click();
                    URL.revokeObjectURL(url);
                  }}>
                    <Icons.Download /> Export
                  </button>
                </div>
              </div>

              {/* API Key */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title"><Icons.Key /> Anthropic API Key</span>
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="btn btn-sm">
                    Get a Key <Icons.External />
                  </a>
                </div>
                <div className="card-body">
                  <p className="section-desc" style={{ marginBottom: 12 }}>
                    Required to power the AI search agent. Your key is stored only in your browser's localStorage and is sent directly to the Anthropic API — never to any other server.
                  </p>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      className="input"
                      type={showApiKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-ant-api03-..."
                      style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, flex: 1 }}
                    />
                    <button className="btn btn-ghost" onClick={() => setShowApiKey(!showApiKey)}>
                      {showApiKey ? <Icons.EyeOff /> : <Icons.Eye />}
                    </button>
                  </div>
                </div>
              </div>

              {/* JSON Editor Modal */}
              {showJsonEditor && (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Raw JSON Config</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-sm" onClick={() => setShowJsonEditor(false)}>Cancel</button>
                      <button className="btn btn-primary btn-sm" onClick={saveJsonConfig}>Save</button>
                    </div>
                  </div>
                  <div className="card-body">
                    <textarea
                      className="json-area"
                      value={jsonDraft}
                      onChange={(e) => setJsonDraft(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                </div>
              )}

              {/* Companies */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Target Companies</span>
                  <button className="btn btn-sm" onClick={addCompany}><Icons.Plus /> Add</button>
                </div>
                <div className="card-body">
                  {config.companies.map((c) => (
                    <div className="company-row" key={c.id}>
                      <div
                        className={`toggle ${c.enabled ? "on" : ""}`}
                        onClick={() => updateCompany(c.id, "enabled", !c.enabled)}
                      />
                      <input
                        className="input"
                        value={c.name}
                        onChange={(e) => updateCompany(c.id, "name", e.target.value)}
                        placeholder="Company Name"
                      />
                      <input
                        className="input"
                        value={c.careerUrl}
                        onChange={(e) => updateCompany(c.id, "careerUrl", e.target.value)}
                        placeholder="https://careers.example.com"
                        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
                      />
                      <a href={c.careerUrl} target="_blank" rel="noreferrer" className="btn-ghost" style={{ display: "flex" }}>
                        <Icons.External />
                      </a>
                      <button className="btn-danger" onClick={() => removeCompany(c.id)}>
                        <Icons.Trash />
                      </button>
                    </div>
                  ))}
                  {config.companies.length === 0 && (
                    <div className="empty-state">
                      <p>No companies added yet. Click "Add" to get started.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Job Categories */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Job Categories & Keywords</span>
                  <button className="btn btn-sm" onClick={addCategory}><Icons.Plus /> Add</button>
                </div>
                <div className="card-body">
                  {config.jobCategories.map((cat) => (
                    <div className="cat-row" key={cat.id}>
                      <div
                        className={`toggle ${cat.enabled ? "on" : ""}`}
                        onClick={() => updateCategory(cat.id, "enabled", !cat.enabled)}
                      />
                      <input
                        className="input"
                        value={cat.label}
                        onChange={(e) => updateCategory(cat.id, "label", e.target.value)}
                        placeholder="Category Label"
                      />
                      <ChipInput
                        chips={cat.keywords}
                        onChange={(kw) => updateCategory(cat.id, "keywords", kw)}
                        placeholder="Type keyword + Enter"
                      />
                      <button className="btn-danger" onClick={() => removeCategory(cat.id)}>
                        <Icons.Trash />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preferences */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Preferences</span>
                </div>
                <div className="card-body">
                  <div className="form-row">
                    <span className="form-label">Location</span>
                    <input
                      className="input"
                      value={config.preferences.location}
                      onChange={(e) => updatePref("location", e.target.value)}
                      placeholder="e.g. Los Angeles, CA"
                    />
                  </div>
                  <div className="form-row">
                    <span className="form-label">Include Remote</span>
                    <div
                      className={`toggle ${config.preferences.remote ? "on" : ""}`}
                      onClick={() => updatePref("remote", !config.preferences.remote)}
                    />
                  </div>
                  <div className="form-row">
                    <span className="form-label">Experience</span>
                    <select
                      className="input"
                      value={config.preferences.experienceLevel}
                      onChange={(e) => updatePref("experienceLevel", e.target.value)}
                      style={{ appearance: "auto" }}
                    >
                      <option value="entry">Entry Level</option>
                      <option value="entry-mid">Entry to Mid Level</option>
                      <option value="mid">Mid Level</option>
                      <option value="mid-senior">Mid-Senior</option>
                      <option value="senior">Senior</option>
                      <option value="lead">Lead / Principal</option>
                      <option value="executive">Executive</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <span className="form-label">Email Address</span>
                    <input
                      className="input"
                      value={config.preferences.emailAddress}
                      onChange={(e) => updatePref("emailAddress", e.target.value)}
                      placeholder="your@email.com (for email export)"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ RESULTS TAB ═══ */}
          {tab === "results" && (
            <>
              {results.length === 0 ? (
                <div className="empty-state" style={{ paddingTop: 80 }}>
                  <div className="empty-state-icon"><Icons.Briefcase /></div>
                  <h3>No results yet</h3>
                  <p>Run a search from the Search tab to find job openings.</p>
                </div>
              ) : (
                <>
                  {/* Filters */}
                  <div className="filters-row">
                    <span className={`filter-chip ${filterCompany === "all" ? "active" : ""}`} onClick={() => setFilterCompany("all")}>All Companies</span>
                    {uniqueCompanies.map((c) => (
                      <span key={c} className={`filter-chip ${filterCompany === c ? "active" : ""}`} onClick={() => setFilterCompany(c)}>{c}</span>
                    ))}
                    <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
                    <span className={`filter-chip ${filterCategory === "all" ? "active" : ""}`} onClick={() => setFilterCategory("all")}>All Roles</span>
                    {uniqueCategories.map((c) => (
                      <span key={c} className={`filter-chip ${filterCategory === c ? "active" : ""}`} onClick={() => setFilterCategory(c)}>{c}</span>
                    ))}
                    <span className="results-count">{filtered.length} results</span>
                  </div>

                  {/* Action Bar */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    <button className="btn btn-sm" onClick={copyResults}>
                      {copiedId === "all" ? <><Icons.Check /> Copied!</> : <><Icons.Copy /> Copy All</>}
                    </button>
                    <button className="btn btn-sm" onClick={emailResults}>
                      <Icons.Mail /> Email Results
                    </button>
                    <button className="btn btn-sm" onClick={downloadResults}>
                      <Icons.Download /> Download JSON
                    </button>
                  </div>

                  {/* Cards */}
                  {filtered.map((r) => (
                    <div className="result-card" key={r.id}>
                      <div className="result-top">
                        <div>
                          <div className="result-company">{r.company}</div>
                          <div className="result-title">{r.title}</div>
                        </div>
                        <div className="inline-actions">
                          {r.isNew && <span className="badge badge-new">NEW</span>}
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ textDecoration: "none" }}>
                              Apply <Icons.External />
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="result-meta">
                        <span>{r.location}</span>
                        <span className={`badge ${r.remote === "Remote" ? "badge-remote" : "badge-hybrid"}`}>{r.remote}</span>
                        <span>{r.category}</span>
                        <span><Icons.Clock /> {new Date(r.postedDate).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* ═══ AUTO-APPLY TAB ═══ */}
          {tab === "autoapply" && (
            <>
              <div className="feasibility-card">
                <div className="feasibility-badge"><Icons.Zap /> Feasibility Analysis</div>
                <div className="feasibility-h">Auto-Apply Agent: What's Possible</div>
                <div className="feasibility-p">
                  Automatically applying to jobs involves navigating ATS platforms (Workday, Greenhouse, Lever, etc.),
                  filling forms, uploading resumes, and handling authentication. Here's what's achievable at each tier:
                </div>

                <div className="tier-grid">
                  <div className="tier-card">
                    <div className="tier-label" style={{ color: "var(--success)" }}>✅ Tier 1 — Available Now</div>
                    <div className="tier-items">
                      • Search & discover jobs via web search<br/>
                      • Parse and extract job details<br/>
                      • Filter by location, role, keywords<br/>
                      • Generate tailored cover letters<br/>
                      • Export results to email or file<br/>
                      • Track application status
                    </div>
                  </div>
                  <div className="tier-card">
                    <div className="tier-label" style={{ color: "var(--warning)" }}>🔧 Tier 2 — With Browser Agent</div>
                    <div className="tier-items">
                      • Navigate to job posting pages<br/>
                      • Pre-fill application forms<br/>
                      • Upload resume / documents<br/>
                      • Handle simple ATS flows<br/>
                      • Take screenshots of progress<br/>
                      • Pause for human review before submit
                    </div>
                  </div>
                  <div className="tier-card">
                    <div className="tier-label" style={{ color: "var(--purple)" }}>🚀 Tier 3 — Future Vision</div>
                    <div className="tier-items">
                      • Full end-to-end auto-apply<br/>
                      • Multi-ATS platform support<br/>
                      • OAuth login handling<br/>
                      • Answer screening questions<br/>
                      • A/B test application strategies<br/>
                      • Interview scheduling
                    </div>
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginTop: 16 }}>
                <div className="card-header">
                  <span className="card-title"><Icons.Bot /> Next Steps for Auto-Apply</span>
                </div>
                <div className="card-body">
                  <div className="section-desc">
                    To extend this into a full auto-apply agent, you can integrate with tools like <strong>Playwright</strong> or <strong>Puppeteer</strong>
                    for browser automation. The agent would navigate to each job URL, detect the ATS type, fill forms with your saved profile data,
                    and pause before final submission for your review. This can be built as a Node.js backend that pairs with this dashboard.
                  </div>
                  <div style={{ background: "var(--bg-input)", borderRadius: 8, padding: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-muted)" }}># Future architecture:</span><br/>
                    jobpilot/<br/>
                    ├── src/              <span style={{ color: "var(--text-muted)" }}># This React dashboard</span><br/>
                    ├── agent/<br/>
                    │   ├── browser.js    <span style={{ color: "var(--text-muted)" }}># Playwright automation</span><br/>
                    │   ├── ats-detect.js <span style={{ color: "var(--text-muted)" }}># ATS platform detection</span><br/>
                    │   ├── form-fill.js  <span style={{ color: "var(--text-muted)" }}># Smart form completion</span><br/>
                    │   └── apply.js      <span style={{ color: "var(--text-muted)" }}># Application orchestrator</span><br/>
                    ├── config.json       <span style={{ color: "var(--text-muted)" }}># Your search config</span><br/>
                    └── profile.json      <span style={{ color: "var(--text-muted)" }}># Your resume/profile data</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
