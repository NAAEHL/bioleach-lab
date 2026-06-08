# BioLeach Lab · ICP-OES Dashboard

Personal research tool — University of Sydney · Bioleaching (PCB / NdFeB)

**Live app:** `https://[your-username].github.io/bioleach-lab/`

---

## Features

- **① Dilution Planner** — enter estimated concentrations → get the exact dilution factor and volume to pipette into 2% HNO₃ to land in the 1–50 mg/L ICP range
- **② ICP Analysis** — paste your PerkinElmer "Conc. in Sample Units" sheet → auto-detects samples, flags out-of-range elements, links results to experiments
- **③ Recovery Yield** — select a base and final sample → automatic % recovery per element with colour-coded bars
- **④ Experiments** — create and track all experiments (type, matrix, organism, conditions, notes, status)

All data is saved in your browser's localStorage — no account, no server, no internet needed after first load.

---

## Deploy to GitHub Pages (one-time setup, ~10 minutes)

### Step 1 — Create a GitHub account
Go to https://github.com and sign up (free). Skip if you already have one.

### Step 2 — Create a new repository
1. Click the **+** button (top right) → **New repository**
2. Name it exactly: `bioleach-lab`
3. Set it to **Public**
4. Leave everything else as default
5. Click **Create repository**

### Step 3 — Upload the files
1. On your new repository page, click **uploading an existing file**
2. Drag and drop both files: `index.html` and `app.js`
3. Scroll down, click **Commit changes**

### Step 4 — Enable GitHub Pages
1. Go to your repository → **Settings** tab
2. Left sidebar → **Pages**
3. Under "Branch", select **main** → folder **/ (root)**
4. Click **Save**

### Step 5 — Access your app
Wait ~2 minutes, then go to:
`https://[your-github-username].github.io/bioleach-lab/`

That's it. Bookmark this URL — it's your permanent lab dashboard.

---

## Updating the app later

When we improve the app together, you only need to re-upload `app.js` (or both files) to GitHub — the live site updates automatically within ~1 minute.

To update:
1. Go to your repository on GitHub
2. Click on `app.js`
3. Click the **pencil icon** (Edit) or drag-drop the new file
4. Commit changes → done

---

## Data persistence

Data is stored in your **browser's localStorage** under the key prefix `bioleach_`.

- ✅ Survives page refresh and browser restarts
- ✅ Works offline after first load
- ⚠️ Data is tied to the browser/device — if you clear browser data, it resets
- ⚠️ Not shared between devices (Chrome on lab computer ≠ Chrome on laptop)

**To back up your data:** open the browser console (F12 → Console) and run:
```javascript
JSON.stringify(Object.fromEntries(
  Object.entries(localStorage).filter(([k]) => k.startsWith('bioleach_'))
))
```
Copy the output and save it somewhere safe.

---

## Future improvements (roadmap)

- [ ] Export results to CSV
- [ ] Import backup data
- [ ] Charts — recovery yield over time
- [ ] Cloud sync (e.g. via GitHub Gist) so data works across devices
