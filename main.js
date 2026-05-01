const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, clipboard, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const TMP_PNG = path.join(os.tmpdir(), 'iktahmetrics-capture.png');
const POLL_MS = 1000;
const FOCUS_POLL_MS = 750;

const RATE_REGEX = /([\d.]+)\s*xp\s*\/\s*([\d.]+)\s*seconds/i;
const LEVEL_REGEX = /level\s+(\d+)/i;
const PROGRESS_REGEX = /([\d,]+)\s*\/\s*([\d,]+)/;

// Idle Iktah's known skill names. We match the OCR'd header against this list
// so we don't pick up neighboring UI text by accident.
const KNOWN_SKILLS = [
  'Attack', 'Strength', 'Defence', 'Defense', 'Health',
  'Woodcutting', 'Mining', 'Fishing', 'Gathering', 'Tracking',
  'Crafting', 'Smithing', 'Cooking', 'Alchemy', 'Tailoring',
  'Carpentry', 'Community', 'Landkeeping',
];
const SKILL_LOOKUP = new Map(KNOWN_SKILLS.map(s => [s.toLowerCase(), s]));

// Vision sometimes returns Cyrillic homoglyphs for Latin letters in pixel-art
// fonts (most commonly `х` U+0445 in place of `x` U+0078, breaking our rate
// regex). Map each one back to its Latin twin before parsing.
const CYRILLIC_TO_LATIN = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
  'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'У': 'Y', 'Х': 'X',
};

function normalizeOcr(text) {
  if (!text) return '';
  return text
    .replace(/~/g, '')
    .replace(/[а-яА-ЯёЁ]/g, ch => CYRILLIC_TO_LATIN[ch] || ch);
}

// Per-skill menu-bar icons live as template PNGs in assets/skill-icons/.
// Generated from Font Awesome Free SVGs by scripts/build-skill-icons.js.
function trayIconForSkill(skill) {
  if (!skill) return null;
  const base = path.join(__dirname, 'assets', 'skill-icons', `${skill}Template.png`);
  if (!fs.existsSync(base)) return null;
  const img = nativeImage.createFromPath(base);
  img.setTemplateImage(true);
  return img;
}

const regionFile = () => path.join(app.getPath('userData'), 'region.json');
const overlayFile = () => path.join(app.getPath('userData'), 'overlay.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const bestsFile = () => path.join(app.getPath('userData'), 'bests.json');
const thresholdsFile = () => path.join(app.getPath('userData'), 'thresholds.json');

const ocrBinaryPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'ocr')
    : path.join(__dirname, 'build', 'ocr');

let tray = null;
let overlayWindow = null;
let pickerWindow = null;

let polling = false;
let inflight = false;

let lastInfo = {};
let lastStatus = '—';
let lastOcrText = ''; // most recent raw OCR output, kept for debugging

let bests = {}; // session-only, in-memory

let setupInProgress = false;

// ---------- persistence ----------

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}
const loadRegion = () => readJson(regionFile());
const saveRegion = (r) => writeJson(regionFile(), r);
const loadOverlayPrefs = () => readJson(overlayFile()) || { visible: false, bounds: null };
const saveOverlayPrefs = (p) => writeJson(overlayFile(), p);
const loadSettings = () => Object.assign({ autoHide: true }, readJson(settingsFile()) || {});
const saveSettings = (s) => writeJson(settingsFile(), s);

// thresholds[skill][level] = total XP needed to reach that level. Learned
// by observing that "Level N · X / T" means level N+1 requires T total. We
// look up thresholds[skill][N] to compute within-level progress as
// (curXp − prev) / (T − prev). The XP curve is shared across skills, so the
// remote/bundled tables store a single _default[level] map, with per-skill
// blocks reserved for skills that diverge from the default.
//
// Resolution order (most → least authoritative):
//   1. Local observations  — userData/thresholds.json    (this device's plays)
//   2. Remote (cached)     — userData/remote-thresholds.json (community map)
//   3. Bundled seed table  — data/thresholds.json (shipped with the app)
//
// On startup we kick off a fetch of the public raw URL; if it succeeds we
// update the cache. Lookups never block on the network — if the fetch fails
// or hasn't completed yet, the bundled+local data still works fine.

const REMOTE_THRESHOLDS_URL =
  'https://raw.githubusercontent.com/Linesmerrill/IktahMetrics/main/data/thresholds.json';
const remoteCacheFile = () => path.join(app.getPath('userData'), 'remote-thresholds.json');

const REPO_RELEASES_API =
  'https://api.github.com/repos/Linesmerrill/IktahMetrics/releases/latest';
const REPO_RELEASES_HTML =
  'https://github.com/Linesmerrill/IktahMetrics/releases/latest';

function stripMeta(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const { _meta, ...rest } = obj;
  return rest;
}

const bundledThresholds = stripMeta(
  readJson(path.join(__dirname, 'data', 'thresholds.json'))
);
let remoteThresholds = stripMeta(readJson(remoteCacheFile())?.data);
let thresholds = readJson(thresholdsFile()) || {};

async function fetchRemoteThresholds() {
  try {
    const res = await fetch(REMOTE_THRESHOLDS_URL, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    remoteThresholds = stripMeta(data);
    writeJson(remoteCacheFile(), {
      fetchedAt: new Date().toISOString(),
      data: remoteThresholds,
    });
    rebuildMenu();
  } catch {
    // Network unreachable, repo private, etc. — silent fallback to bundled.
  }
}

function getPrevLevelThreshold(skill, level) {
  return thresholds?.[skill]?.[level]
      ?? remoteThresholds?.[skill]?.[level]
      ?? remoteThresholds?._default?.[level]
      ?? bundledThresholds?.[skill]?.[level]
      ?? bundledThresholds?._default?.[level]
      ?? null;
}
function recordThreshold(skill, nextLevel, total) {
  if (!skill || !nextLevel || !total) return;
  const existing = thresholds?.[skill]?.[nextLevel]
                ?? remoteThresholds?.[skill]?.[nextLevel]
                ?? remoteThresholds?._default?.[nextLevel]
                ?? bundledThresholds?.[skill]?.[nextLevel]
                ?? bundledThresholds?._default?.[nextLevel];
  if (existing === total) return;
  if (!thresholds[skill]) thresholds[skill] = {};
  thresholds[skill][nextLevel] = total;
  writeJson(thresholdsFile(), thresholds);
}
function localObservationsForSharing() {
  // Only what's on this device and not already in remote/bundled — the
  // exact diff a user would contribute back upstream.
  const out = {};
  for (const skill of Object.keys(thresholds)) {
    if (skill.startsWith('_')) continue;
    for (const lvl of Object.keys(thresholds[skill])) {
      const v = thresholds[skill][lvl];
      const known = remoteThresholds?.[skill]?.[lvl]
                 ?? remoteThresholds?._default?.[lvl]
                 ?? bundledThresholds?.[skill]?.[lvl]
                 ?? bundledThresholds?._default?.[lvl];
      if (known === v) continue;
      if (!out[skill]) out[skill] = {};
      out[skill][lvl] = v;
    }
  }
  return out;
}

// ---------- update checker ----------

let updateState = { checking: false, latest: null, error: null, checkedAt: 0 };

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function checkForUpdates() {
  if (updateState.checking) return;
  updateState.checking = true;
  rebuildMenu();
  try {
    const res = await fetch(REPO_RELEASES_API, {
      headers: { 'Accept': 'application/vnd.github+json' },
    });
    if (res.status === 404) {
      // No releases published yet — not an error, just nothing to compare.
      updateState.latest = null;
      updateState.error = null;
    } else if (!res.ok) {
      throw new Error(`GitHub returned ${res.status}`);
    } else {
      const data = await res.json();
      updateState.latest = data.tag_name || null;
      updateState.error = null;
    }
    updateState.checkedAt = Date.now();
  } catch (err) {
    updateState.error = (err?.message || String(err)).slice(0, 80);
  } finally {
    updateState.checking = false;
    rebuildMenu();
  }
}

// ---------- capture / OCR / parse ----------

function captureRegion(region) {
  // We spawn /usr/sbin/screencapture rather than using Electron's
  // desktopCapturer because Chromium's screen-capture pipeline silently
  // fails on macOS Sequoia for unsigned / ad-hoc-signed apps — even with
  // a valid TCC grant, getSources() returns "Failed to get sources." It
  // wants entitlements that only proper Developer ID signing can deliver.
  // Shelling out to screencapture works as long as the parent has a
  // stable identity (which our ad-hoc signing provides via afterPack).
  return new Promise((resolve, reject) => {
    const args = [
      '-x',
      `-R${region.x},${region.y},${region.w},${region.h}`,
      '-t', 'png',
      TMP_PNG,
    ];
    execFile('/usr/sbin/screencapture', args, (err) => {
      if (err) return reject(new Error(`screencapture failed: ${err.message}`));
      resolve(TMP_PNG);
    });
  });
}

function runOcr(imagePath) {
  return new Promise((resolve, reject) => {
    execFile(ocrBinaryPath(), [imagePath], { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr ? `${err.message} | ${stderr.trim()}` : err.message;
        return reject(new Error(`ocr failed: ${msg}`));
      }
      resolve(stdout);
    });
  });
}

function getFrontmostApp() {
  return new Promise((resolve) => {
    execFile(ocrBinaryPath(), ['--frontmost'], { timeout: 1000 }, (err, stdout) => {
      if (err) return resolve(null);
      const line = (stdout || '').trim();
      if (!line) return resolve(null);
      const [name, bundleId] = line.split('\t');
      resolve({ name: name || '', bundleId: bundleId || '' });
    });
  });
}

function listWindows() {
  return new Promise((resolve) => {
    execFile(ocrBinaryPath(), ['--list-windows'], { timeout: 1500 }, (err, stdout) => {
      if (err) return resolve([]);
      const wins = (stdout || '').trim().split('\n').filter(Boolean).map(line => {
        const p = line.split('\t');
        return {
          pid: parseInt(p[0], 10),
          bundleId: p[1] || '',
          owner: p[2] || '',
          title: p[3] || '',
          x: parseInt(p[4], 10),
          y: parseInt(p[5], 10),
          w: parseInt(p[6], 10),
          h: parseInt(p[7], 10),
        };
      });
      resolve(wins);
    });
  });
}

async function getTargetWindowBounds(owner, bundleId) {
  const wins = await listWindows();
  // Match by bundleId if available (more stable across renames), fall back
  // to owner name. Pick the largest matching window — multi-window apps
  // tend to have one main game window plus tooltips/popovers.
  let matches = bundleId ? wins.filter(w => w.bundleId === bundleId) : [];
  if (matches.length === 0) matches = wins.filter(w => w.owner === owner);
  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const top = matches[0];
  return { x: top.x, y: top.y, w: top.w, h: top.h };
}

function parseInfo(text) {
  if (!text) return null;
  const cleaned = normalizeOcr(text);
  const lines = cleaned.split(/\r?\n/);
  const out = {};

  // --- rate ---
  // Sanity-bound the parsed rate. Idle Iktah skills realistically yield
  // somewhere between ~0.01 xp/s (slow gathering) and a few xp/s. If we
  // get something wildly out of range, OCR has misread digits — drop it
  // and let extrapolation hold the line until a sensible sample lands.
  const rate = cleaned.match(RATE_REGEX);
  if (rate) {
    const xp = parseFloat(rate[1]);
    const sec = parseFloat(rate[2]);
    if (sec > 0 && xp > 0) {
      const r = xp / sec;
      if (r >= 0.01 && r <= 50) {
        out.xp = xp;
        out.sec = sec;
        out.rate = r;
      }
    }
  }

  // --- level + xp progress ---
  // Prefer a "current / total" match near a "Level N" line. The activity
  // card lays them out adjacently, so this rules out unrelated X/Y pairs
  // like the inventory's "29 / 30".
  const levelLineIdx = lines.findIndex(l => LEVEL_REGEX.test(l));
  if (levelLineIdx >= 0) {
    const lev = lines[levelLineIdx].match(LEVEL_REGEX);
    if (lev) out.level = parseInt(lev[1], 10);

    const start = Math.max(0, levelLineIdx - 1);
    const end = Math.min(lines.length, levelLineIdx + 4);
    for (let i = start; i < end; i++) {
      if (RATE_REGEX.test(lines[i])) continue;
      const p = lines[i].match(PROGRESS_REGEX);
      if (!p) continue;
      const cur = parseInt(p[1].replace(/,/g, ''), 10);
      const total = parseInt(p[2].replace(/,/g, ''), 10);
      if (Number.isFinite(cur) && Number.isFinite(total) && total >= 50 && cur <= total) {
        out.curXp = cur;
        out.totalXp = total;
        break;
      }
    }
  }

  // --- active skill ---
  // Strongest signal: the sidebar lists every skill with its current level
  // (e.g. "Fishing  37"). The activity card shows "Level N" for the active
  // skill. Each skill has its own level so the active sidebar entry's level
  // matches the card's level — and inactive skills almost never share it.
  if (out.level != null) {
    const target = String(out.level);
    const matches = new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (LEVEL_REGEX.test(line)) continue; // skip the activity card line itself

      let skill = null;
      for (const word of line.split(/[^A-Za-z]+/)) {
        const hit = SKILL_LOOKUP.get(word.toLowerCase());
        if (hit) { skill = hit; break; }
      }
      if (!skill) continue;

      const sameLineNums = line.match(/\b\d+\b/g) || [];
      const nextLineNums = (i + 1 < lines.length ? lines[i + 1].match(/\b\d+\b/g) : null) || [];
      if (sameLineNums.includes(target) || nextLineNums.includes(target)) {
        matches.add(skill);
      }
    }
    if (matches.size === 1) out.skill = [...matches][0];
  }

  // Fallback: orphan/count heuristic when level-match didn't yield a single hit.
  if (!out.skill) {
    const counts = new Map();
    const linesWithSkill = [];
    lines.forEach((line, i) => {
      const seen = new Set();
      for (const word of line.split(/[^A-Za-z]+/)) {
        const hit = SKILL_LOOKUP.get(word.toLowerCase());
        if (hit && !seen.has(hit)) {
          counts.set(hit, (counts.get(hit) || 0) + 1);
          linesWithSkill.push({ line: i, skill: hit });
          seen.add(hit);
        }
      }
    });
    if (counts.size > 0) {
      let best = null;
      let bestScore = -Infinity;
      const allLineSet = new Set(linesWithSkill.map(x => x.line));
      for (const [skill, count] of counts) {
        const skillLines = linesWithSkill.filter(x => x.skill === skill).map(x => x.line);
        const orphans = skillLines.filter(ln =>
          !allLineSet.has(ln - 1) && !allLineSet.has(ln + 1)
        ).length;
        const score = count * 10 + orphans * 100;
        if (score > bestScore) { bestScore = score; best = skill; }
      }
      out.skill = best;
    }
  }

  return out;
}

function etaSeconds(info) {
  if (!info?.rate || info.curXp == null || !info.totalXp) return null;
  const remaining = info.totalXp - info.curXp;
  if (remaining <= 0) return 0;
  return remaining / info.rate;
}

// ---------- per-skill bests ----------

function recordRate(skill, rate) {
  const key = skill || '__nosession__';
  if (!bests[key] || rate > bests[key]) bests[key] = rate;
}
function getSkillBest(skill) {
  const key = skill || '__nosession__';
  return bests[key] || 0;
}
function resetBests() {
  bests = {};
}

// ---------- polling ----------
//
// One tick per second. Try real OCR; if it lands a rate, update truth. If
// it fails for any reason (no match, capture error, game in background,
// region occluded), don't lose the displayed values — project forward from
// the last successful sample (curXp climbs at rate, ETA counts down). When
// real OCR succeeds again, the displayed values snap to truth on that tick.
//
// `extrapolated` is implicit: now − lastRealAt > stale-threshold.

let pollTimer = null;
let lastRealAt = 0; // ms timestamp of last successful real OCR with a rate
let lastSample = null;  // most recent OCR sample, used for advance detection
let lastAdvance = null; // most recent sample where curXp grew, used to confirm "this skill is actively training"
const STALE_MS = 2000;

function isStale() {
  return lastRealAt === 0 || (Date.now() - lastRealAt) > STALE_MS;
}

// Idle Iktah pays out XP in chunks at the end of each craft cycle (e.g. a
// skill listed as "4 xp / 5.4 seconds" jumps curXp by 4 once every 5.4s
// rather than gaining xp continuously), so we cannot demand an advance every
// 1-second tick. The play/pause icon doesn't OCR cleanly, so we infer state
// behaviorally with a window of 1.5x the displayed craft cycle.
//
// Returns the display-state for this OCR sample:
//   'active'        — the visible skill is the one being trained
//   'viewing-other' — a different skill is on screen; tracked one is still
//                     assumed running unattended in the game
//   'paused'        — the tracked skill itself stopped advancing
function detectActiveState(info, nowMs) {
  if (!info?.skill) return 'viewing-other';
  if (!lastAdvance) return 'active'; // bootstrap: trust the first sample

  const cycleSec = info.sec || lastSample?.sec || 6;
  const window = Math.max(2000, cycleSec * 1500);

  if (lastAdvance.skill === info.skill && lastAdvance.level === info.level) {
    return ((nowMs - lastAdvance.at) <= window) ? 'active' : 'paused';
  }
  return 'viewing-other';
}

async function tryRealOcr() {
  let region = loadRegion();
  if (!region) return { ok: false, reason: 'no region' };

  // Window-tracking regions resolve to live bounds each tick — so capture
  // follows the game window when the user moves or resizes it.
  if (region.mode === 'window') {
    const bounds = await getTargetWindowBounds(region.owner, region.bundleId);
    if (!bounds) {
      return { ok: false, reason: `${region.owner} window not visible` };
    }
    region = { ...region, ...bounds };
  }

  try {
    await captureRegion(region);
    const text = await runOcr(TMP_PNG);
    lastOcrText = text || '';
    const info = parseInfo(text) || {};
    if (!info.skill && lastInfo?.skill) info.skill = lastInfo.skill;
    if (info.rate == null) return { ok: false, reason: 'no match' };

    // Learn level thresholds from observation: "Level N · X / T" tells us
    // level N+1 requires T total xp. With prev = thresholds[skill][N] we
    // can show within-level progress instead of total-xp progress.
    if (info.skill && info.level && info.totalXp) {
      recordThreshold(info.skill, info.level + 1, info.totalXp);
      const prev = getPrevLevelThreshold(info.skill, info.level);
      if (prev != null) info.prevLevelXp = prev;
    }
    return { ok: true, info };
  } catch (err) {
    return { ok: false, reason: (err?.message || String(err)).slice(0, 80) };
  }
}

function projectFromLast() {
  if (!lastInfo || lastInfo.rate == null) return null;
  const elapsed = Math.max(0, (Date.now() - lastRealAt) / 1000);
  const proj = { ...lastInfo };
  if (lastInfo.curXp != null && lastInfo.totalXp) {
    const projectedCur = lastInfo.curXp + lastInfo.rate * elapsed;
    let level = lastInfo.level;
    let totalXp = lastInfo.totalXp;
    let prevLevelXp = lastInfo.prevLevelXp ?? null;

    // Walk forward through known thresholds as projection crosses level
    // boundaries, so the displayed level + ETA stay accurate during
    // long-running background tracking.
    while (level != null && projectedCur >= totalXp) {
      const nextTotal = getPrevLevelThreshold(lastInfo.skill, level + 2);
      if (nextTotal == null || nextTotal <= totalXp) break;
      prevLevelXp = totalXp;
      level += 1;
      totalXp = nextTotal;
    }

    if (projectedCur >= totalXp) {
      proj.curXp = totalXp;
      proj.etaSec = 0;
    } else {
      proj.curXp = projectedCur;
      proj.etaSec = (totalXp - projectedCur) / lastInfo.rate;
    }
    proj.level = level;
    proj.totalXp = totalXp;
    proj.prevLevelXp = prevLevelXp;
  } else {
    proj.etaSec = etaSeconds(lastInfo);
  }
  return proj;
}

async function tick() {
  if (inflight) return;
  inflight = true;
  try {
    const result = await tryRealOcr();
    if (result.ok) {
      const info = result.info;
      const now = Date.now();

      const sameAsPrev = lastSample
                      && lastSample.skill === info.skill
                      && lastSample.level === info.level;
      if (sameAsPrev && lastSample.curXp != null && info.curXp != null
          && info.curXp > lastSample.curXp) {
        lastAdvance = { skill: info.skill, level: info.level, curXp: info.curXp, at: now };
      }
      lastSample = {
        skill: info.skill,
        level: info.level,
        curXp: info.curXp,
        rate: info.rate,
        sec: info.sec,
        at: now,
      };

      const state = detectActiveState(info, now);

      if (state === 'active') {
        lastInfo = info;
        lastRealAt = now;
        recordRate(info.skill, info.rate);
        lastStatus = `${info.rate.toFixed(2)} xp/s`;
        pushUpdate({
          kind: 'rate',
          ...info,
          etaSec: etaSeconds(info),
          skillBest: getSkillBest(info.skill),
          state: 'active',
          extrapolated: false,
        });
        return;
      }

      if (state === 'paused' && lastInfo?.rate != null) {
        // Tracked skill itself stopped advancing — freeze the display at the
        // last running snapshot rather than projecting forward. ETA pauses.
        lastStatus = `${lastInfo.rate.toFixed(2)} xp/s · paused`;
        pushUpdate({
          kind: 'rate',
          ...lastInfo,
          etaSec: etaSeconds(lastInfo),
          skillBest: getSkillBest(lastInfo.skill),
          state: 'paused',
          extrapolated: false,
        });
        return;
      }

      // 'viewing-other' — user clicked to a different skill while the tracked
      // one keeps running unattended in the game. Project lastInfo forward
      // (curXp climbs at rate, ETA counts down, level rolls over via known
      // thresholds), and tell the UI to use the calmer "skill in background"
      // styling rather than the OCR-failed "game in background" warning.
      const proj = projectFromLast();
      if (proj) {
        lastStatus = `${proj.rate.toFixed(2)} xp/s · skill in background`;
        pushUpdate({
          kind: 'rate',
          ...proj,
          skillBest: getSkillBest(proj.skill),
          state: 'viewing-other',
          extrapolated: true,
        });
      } else {
        // No prior tracked skill — just show what's currently visible.
        pushUpdate({
          kind: 'rate',
          ...info,
          etaSec: etaSeconds(info),
          skillBest: getSkillBest(info.skill),
          state: 'active',
          extrapolated: false,
        });
      }
      return;
    }

    // OCR failed entirely (capture error, region occluded, game minimized).
    // Project from the last running observation and warn that we're flying
    // blind via the "game in background" styling.
    const proj = projectFromLast();
    if (proj) {
      lastStatus = `~${proj.rate.toFixed(2)} xp/s (estimated)`;
      pushUpdate({
        kind: 'rate',
        ...proj,
        skillBest: getSkillBest(proj.skill),
        state: 'background',
        extrapolated: true,
      });
    } else {
      lastStatus = result.reason || 'waiting';
      pushUpdate({
        kind: 'idle',
        message: lastStatus,
      });
    }
  } finally {
    inflight = false;
    updateTrayTitle();
    rebuildMenu();
  }
}

function startPolling() {
  if (polling) return;
  if (!loadRegion()) {
    lastStatus = 'set a region first';
    updateTrayTitle();
    rebuildMenu();
    return;
  }
  polling = true;
  tick();
  pollTimer = setInterval(tick, POLL_MS);
  updateTrayTitle();
  rebuildMenu();
}

function stopPolling() {
  polling = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  updateTrayTitle();
  rebuildMenu();
}

// ---------- tray ----------

function updateTrayTitle() {
  if (!tray) return;
  if (!polling) {
    tray.setImage(nativeImage.createEmpty());
    tray.setTitle('XPS');
    return;
  }

  // Skill icon as a template image alongside the title text. macOS auto-tints
  // template images to match the menu bar foreground color, giving us a
  // crisp white silhouette in dark mode and black in light mode.
  const icon = trayIconForSkill(lastInfo?.skill);
  tray.setImage(icon || nativeImage.createEmpty());

  const parts = [];
  if (lastInfo?.level != null) parts.push('L' + lastInfo.level);
  if (lastInfo?.rate != null) {
    const prefix = isStale() ? '~' : '';
    parts.push(prefix + lastInfo.rate.toFixed(2) + ' xp/s');
  }
  tray.setTitle(parts.length ? parts.join(' · ') : '… xp/s');
}

function rebuildMenu() {
  if (!tray) return;
  const region = loadRegion();
  const overlayPrefs = loadOverlayPrefs();

  const statusBits = [];
  if (lastInfo?.rate != null) {
    const prefix = isStale() ? '~' : '';
    statusBits.push(`${prefix}${lastInfo.rate.toFixed(2)} xp/s`);
  }
  if (lastInfo?.level != null) statusBits.push(`L${lastInfo.level}`);
  if (lastInfo?.curXp != null && lastInfo?.totalXp) {
    const pct = ((lastInfo.curXp / lastInfo.totalXp) * 100).toFixed(1);
    statusBits.push(`${pct}%`);
  }
  const eta = etaSeconds(lastInfo);
  if (eta != null && eta > 0) statusBits.push(`next: ${formatDuration(eta)}`);
  if (isStale() && lastInfo?.rate != null) statusBits.push('estimated');
  const statusLine = statusBits.length ? statusBits.join(' · ') : lastStatus;

  const skillBest = getSkillBest(lastInfo?.skill);
  const bestLabel = skillBest > 0
    ? `best: ${skillBest.toFixed(2)} xp/s`
    : 'best: —';

  const template = [
    { label: statusLine, enabled: false },
    { label: bestLabel, enabled: false },
    { type: 'separator' },
    {
      label: polling ? 'Stop' : 'Start',
      accelerator: 'CommandOrControl+Shift+S',
      enabled: !!region,
      click: () => (polling ? stopPolling() : startPolling()),
    },
    {
      label: region?.mode === 'window'
        ? `Tracking: ${region.owner} (auto-bounds)`
        : region
          ? `Region: ${region.w}×${region.h} fixed`
          : 'No region set',
      enabled: false,
    },
    {
      label: 'Track App Window…',
      click: () => trackAppWindowFlow(),
    },
    {
      label: 'Set Fixed Region…',
      click: () => pickRegionFlow(),
    },
    {
      label: 'Reset Session Bests',
      enabled: Object.keys(bests).length > 0,
      click: () => {
        resetBests();
        rebuildMenu();
        pushUpdate({
          kind: lastInfo?.rate != null ? 'rate' : 'idle',
          ...lastInfo,
          etaSec: etaSeconds(lastInfo),
          skillBest: 0,
        });
      },
    },
    {
      label: 'Reset Tracking',
      enabled: !!(lastInfo?.rate || Object.keys(bests).length),
      click: () => {
        lastInfo = {};
        lastRealAt = 0;
        resetBests();
        lastStatus = 'reset';
        pushUpdate({ kind: 'idle', message: 'reset' });
        updateTrayTitle();
        rebuildMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Reveal Last Capture in Finder',
      enabled: fs.existsSync(TMP_PNG),
      click: () => shell.showItemInFolder(TMP_PNG),
    },
    {
      label: 'Save Last OCR Output…',
      enabled: !!lastOcrText,
      click: () => {
        const out = path.join(os.tmpdir(), 'iktahmetrics-last-ocr.txt');
        fs.writeFileSync(out, lastOcrText || '(empty)');
        shell.openPath(out);
      },
    },
    { type: 'separator' },
    {
      label: 'Share Observed Thresholds…',
      enabled: Object.keys(localObservationsForSharing()).length > 0,
      click: () => {
        const data = localObservationsForSharing();
        clipboard.writeText(JSON.stringify(data, null, 2));
        const body = encodeURIComponent(
          'Adding observed XP thresholds:\n\n```json\n' +
          JSON.stringify(data, null, 2) +
          '\n```\n'
        );
        shell.openExternal(
          `https://github.com/Linesmerrill/IktahMetrics/issues/new?title=${encodeURIComponent('thresholds: new observations')}&body=${body}`
        );
      },
    },
    { type: 'separator' },
    {
      label: 'Show Overlay',
      type: 'checkbox',
      checked: overlayPrefs.visible,
      click: (item) => setOverlayVisible(item.checked),
    },
    { type: 'separator' },
    ...buildUpdateMenuItems(),
    { label: 'Quit IktahMetrics', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function buildUpdateMenuItems() {
  const current = `v${app.getVersion()}`;
  const updateAvailable =
    updateState.latest && compareSemver(updateState.latest, current) > 0;

  let label;
  let click = checkForUpdates;
  let enabled = !updateState.checking;

  if (updateState.checking) {
    label = 'Checking for updates…';
  } else if (updateAvailable) {
    label = `Update available: ${updateState.latest} →`;
    click = () => shell.openExternal(REPO_RELEASES_HTML);
  } else if (updateState.error) {
    label = `Update check failed (${current})`;
  } else if (updateState.latest) {
    label = `Up to date (${current})`;
  } else {
    label = `Check for Updates (${current})`;
  }

  return [
    { label, click, enabled },
    { type: 'separator' },
  ];
}

function formatDuration(s) {
  if (!isFinite(s) || s <= 0) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s - m * 60);
    return sec ? `${m}m ${sec}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('XPS');
  tray.setToolTip('IktahMetrics · Idle Iktah XP/sec');
  rebuildMenu();
}

// ---------- overlay window ----------

function pushUpdate(payload) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:update', {
      polling,
      skill: lastInfo?.skill,
      skillBest: getSkillBest(lastInfo?.skill),
      ...payload,
    });
  }
}

function createOverlayWindow() {
  const prefs = loadOverlayPrefs();
  const opts = {
    width: prefs.bounds?.width ?? 240,
    height: prefs.bounds?.height ?? 170,
    x: prefs.bounds?.x,
    y: prefs.bounds?.y,
    minWidth: 160,
    minHeight: 130,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  overlayWindow = new BrowserWindow(opts);
  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Exclude the overlay from screen captures (sets NSWindow.sharingType = .none
  // on macOS). Our own readout would otherwise be OCR'd back into the parser
  // and confuse skill detection.
  overlayWindow.setContentProtection(true);
  overlayWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  const persistBounds = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const b = overlayWindow.getBounds();
    saveOverlayPrefs({ ...loadOverlayPrefs(), bounds: b });
  };
  overlayWindow.on('moved', persistBounds);
  overlayWindow.on('resized', persistBounds);
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    saveOverlayPrefs({ ...loadOverlayPrefs(), visible: false });
    rebuildMenu();
  });

  overlayWindow.webContents.once('did-finish-load', () => {
    const region = loadRegion();
    if (lastInfo?.rate != null) {
      pushUpdate({
        kind: 'rate',
        ...lastInfo,
        etaSec: etaSeconds(lastInfo),
      });
    } else {
      pushUpdate({
        kind: 'idle',
        message: lastStatus,
        skill: region?.skill,
      });
    }
  });
}

function setOverlayVisible(visible) {
  saveOverlayPrefs({ ...loadOverlayPrefs(), visible });
  if (visible) {
    if (!overlayWindow) createOverlayWindow();
    else overlayWindow.show();
  } else if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  rebuildMenu();
}

// ---------- region picker ----------

function virtualDesktopBounds() {
  const displays = screen.getAllDisplays();
  const minX = Math.min(...displays.map(d => d.bounds.x));
  const minY = Math.min(...displays.map(d => d.bounds.y));
  const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------- app picker (track an app's window dynamically) ----------

let appPickerWindow = null;

function pickAppFlow() {
  return new Promise((resolve) => {
    if (appPickerWindow) {
      appPickerWindow.focus();
      resolve(null);
      return;
    }
    appPickerWindow = new BrowserWindow({
      width: 380,
      height: 480,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      movable: true,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    appPickerWindow.setAlwaysOnTop(true, 'floating');
    appPickerWindow.loadFile(path.join(__dirname, 'src', 'app-picker.html'));
    appPickerWindow.webContents.once('did-finish-load', async () => {
      const wins = await listWindows();
      if (appPickerWindow && !appPickerWindow.isDestroyed()) {
        appPickerWindow.webContents.send('app-list', wins);
      }
    });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('app-picker:select', onSelect);
      ipcMain.removeListener('app-picker:cancel', onCancel);
      if (appPickerWindow && !appPickerWindow.isDestroyed()) appPickerWindow.close();
      appPickerWindow = null;
      resolve(result);
    };
    const onSelect = (_e, data) => finish(data);
    const onCancel = () => finish(null);
    ipcMain.on('app-picker:select', onSelect);
    ipcMain.on('app-picker:cancel', onCancel);
    appPickerWindow.on('closed', () => {
      appPickerWindow = null;
      if (!settled) finish(null);
    });
  });
}

async function trackAppWindowFlow() {
  const wasPolling = polling;
  if (wasPolling) stopPolling();
  const choice = await pickAppFlow();
  if (!choice) {
    if (wasPolling && loadRegion()) startPolling();
    else { updateTrayTitle(); rebuildMenu(); }
    return;
  }
  saveRegion({
    mode: 'window',
    owner: choice.owner,
    bundleId: choice.bundleId || '',
  });
  resetBests();
  lastInfo = {};
  if (wasPolling || !polling) startPolling();
  else { updateTrayTitle(); rebuildMenu(); }
}

function pickRegionFlow() {
  return new Promise(async (resolve) => {
    if (pickerWindow) { resolve(null); return; }
    setupInProgress = true;
    const wasPolling = polling;
    if (polling) stopPolling();
    const wasOverlayVisible = !!(overlayWindow && overlayWindow.isVisible());
    if (wasOverlayVisible) overlayWindow.hide();

    const bounds = virtualDesktopBounds();
    pickerWindow = new BrowserWindow({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      frame: false, transparent: true, alwaysOnTop: true, hasShadow: false,
      skipTaskbar: true, enableLargerThanScreen: true,
      resizable: false, movable: false, fullscreenable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    pickerWindow.setAlwaysOnTop(true, 'screen-saver');
    pickerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    pickerWindow.loadFile(path.join(__dirname, 'src', 'picker.html'));

    let settled = false;
    const finish = async (rect) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('picker:done', onDone);
      ipcMain.removeListener('picker:cancel', onCancel);
      if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
      pickerWindow = null;

      if (!rect) {
        setupInProgress = false;
        if (wasOverlayVisible && overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.show();
        if (wasPolling && loadRegion()) startPolling();
        else { updateTrayTitle(); rebuildMenu(); }
        resolve(null);
        return;
      }

      const region = {
        x: Math.round(bounds.x + rect.x),
        y: Math.round(bounds.y + rect.y),
        w: Math.round(rect.w),
        h: Math.round(rect.h),
      };
      saveRegion(region);

      // Capture target app: brief delay so focus can return to the game.
      await new Promise(r => setTimeout(r, 350));
      const front = await getFrontmostApp();
      const myBundleId = 'com.merrill.iktahmetrics';
      if (front && front.bundleId && front.bundleId !== myBundleId
          && !front.bundleId.startsWith('com.github.Electron')) {
        region.targetApp = front.name;
        region.targetBundleId = front.bundleId;
      }
      saveRegion(region);

      // Skill is auto-detected from OCR each tick — no manual entry needed.
      // Clear bests since the region changed.
      resetBests();
      lastInfo = {};

      setupInProgress = false;
      if (wasOverlayVisible) {
        const prefs = loadOverlayPrefs();
        saveOverlayPrefs({ ...prefs, visible: true });
        if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.show();
      }
      if (wasPolling) startPolling();
      else { updateTrayTitle(); rebuildMenu(); }
      resolve(region);
    };
    const onDone = (_e, rect) => finish(rect);
    const onCancel = () => finish(null);

    ipcMain.on('picker:done', onDone);
    ipcMain.on('picker:cancel', onCancel);
    pickerWindow.on('closed', () => {
      pickerWindow = null;
      finish(null);
    });
  });
}

// ---------- app lifecycle ----------

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  createTray();
  fetchRemoteThresholds();
  checkForUpdates();
  const prefs = loadOverlayPrefs();
  if (prefs.visible) createOverlayWindow();
});

app.on('window-all-closed', (e) => {
  e.preventDefault?.();
});
