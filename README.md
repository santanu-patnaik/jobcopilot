# JobPilot — AI Career Search Agent

A standalone React dashboard that uses Claude AI to search company career pages for matching job openings.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev
```

The app opens at **http://localhost:3000**.

## Setup

### API Key
1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Create an API key
3. In the app, go to **Config** tab → paste your key in the "Anthropic API Key" field
4. Your key is stored in your browser's `localStorage` only — never sent to any server other than Anthropic's API

### Configure Your Search

You can manage your config **two ways** — both work together:

**Option 1: Edit `public/config.json` directly**
- Open `public/config.json` in any text editor
- Add companies, categories, and preferences
- On next app load (or click **Reset to File** in the UI), the file config is loaded
- Great for bulk edits, version control, or sharing configs

**Option 2: Use the Config tab in the UI**
- Add/remove companies, categories, keywords, and preferences interactively
- Changes auto-save to `localStorage` and take priority over the file
- Click **Reset to File** anytime to reload from `public/config.json`
- Use **Import/Export** to save or load `.json` config files

**How priority works:**
1. On first launch → loads from `public/config.json`
2. After any UI edit → saves to `localStorage` (overrides the file)
3. Click **Reset to File** → discards localStorage, reloads from `public/config.json`

A badge in the Config tab shows whether you're currently using `config.json` or `localStorage`.

### Config File Format

```json
{
  "companies": [
    {
      "id": "1",
      "name": "Google",
      "careerUrl": "https://careers.google.com",
      "enabled": true
    }
  ],
  "jobCategories": [
    {
      "id": "1",
      "label": "Software Engineer",
      "keywords": ["software engineer", "SWE", "developer"],
      "enabled": true
    }
  ],
  "preferences": {
    "location": "Los Angeles, CA",
    "remote": true,
    "experienceLevel": "mid-senior",
    "emailResults": true,
    "emailAddress": "you@example.com"
  }
}
```

## Features

| Feature | Status |
|---------|--------|
| AI-powered career page scanning | ✅ |
| Configurable companies & keywords | ✅ |
| Filter results by company/category | ✅ |
| Copy results to clipboard | ✅ |
| Email results (opens mail client) | ✅ |
| Download results as JSON | ✅ |
| Import/Export config files | ✅ |
| Inline JSON config editor | ✅ |
| Persistent storage (localStorage) | ✅ |
| Real-time agent logging | ✅ |
| Auto-apply via browser agent | 🔧 Planned |

## How It Works

1. The app sends a prompt to Claude (via the Anthropic API) for each enabled company
2. Claude uses its **web search** tool to find recent job postings on each company's career page
3. Results are parsed into structured JSON and displayed in the dashboard
4. You can filter, export, email, or click through to apply directly

## Building for Production

```bash
npm run build    # Outputs to dist/
npm run preview  # Preview the production build
```

## Tech Stack

- **React 18** — UI framework
- **Vite** — Build tool & dev server
- **Anthropic API** — AI search agent with web search
- **localStorage** — Config & results persistence

## Project Structure

```
jobpilot/
├── index.html          # Entry HTML
├── package.json        # Dependencies & scripts
├── vite.config.js      # Vite configuration
├── public/
│   └── config.json     # ← Edit this file for your search config
└── src/
    ├── main.jsx        # React mount point
    ├── index.css       # All styles
    └── App.jsx         # Main application
```
