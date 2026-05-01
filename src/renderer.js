const skillEl = document.getElementById('skill');
const skillIconEl = document.getElementById('skill-icon');
const levelEl = document.getElementById('level');
const rateEl = document.getElementById('rate');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const etaEl = document.getElementById('eta');
const bestEl = document.getElementById('best');
const statusEl = document.getElementById('status');

function setSkillIcon(skill) {
  if (!skill) {
    skillIconEl.classList.add('empty');
    skillIconEl.style.webkitMaskImage = '';
    skillIconEl.style.maskImage = '';
    return;
  }
  skillIconEl.classList.remove('empty');
  const url = `url('../assets/skill-icons/${skill}Template.png')`;
  skillIconEl.style.webkitMaskImage = url;
  skillIconEl.style.maskImage = url;
}

function fmt(n) {
  return Number(Math.round(n)).toLocaleString();
}

function fmtDuration(s) {
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

function setRate(rate) {
  rateEl.className = '';
  rateEl.textContent = rate.toFixed(2) + ' xp/s';
}
function setIdle(msg) {
  rateEl.className = 'idle';
  rateEl.textContent = msg;
}
function setError(msg) {
  rateEl.className = 'error';
  rateEl.textContent = msg;
}

const STATE_CLASSES = ['state-active', 'state-viewing-other', 'state-background', 'state-paused'];

window.iktahmetrics.onUpdate((u) => {
  document.body.classList.remove(...STATE_CLASSES);
  if (u.state) document.body.classList.add(`state-${u.state}`);
  // Keep `extrapolated` class only for the genuine OCR-failure case so the
  // existing yellow styling doesn't bleed onto the calmer viewing-other state.
  document.body.classList.toggle('extrapolated', u.state === 'background');

  setSkillIcon(u.skill);
  skillEl.textContent = u.skill || '—';
  levelEl.textContent = (u.level != null) ? `L${u.level}` : '';

  switch (u.kind) {
    case 'rate':
      if (u.state === 'background') {
        rateEl.className = 'extrapolated';
        rateEl.textContent = '~' + u.rate.toFixed(2) + ' xp/s';
      } else {
        setRate(u.rate);
      }
      break;
    case 'no-match':
      setError('no match');
      break;
    case 'error':
      setError('error');
      break;
    case 'idle':
      setIdle(u.polling ? '…' : '—');
      break;
  }

  // Within-level progress when we know the previous level's threshold;
  // otherwise fall back to the raw "current / next" — without a percent,
  // since that ratio is misleading (the game shows accumulated total xp).
  if (u.curXp != null && u.totalXp) {
    // Display the same numbers the game shows (cur / next-level total).
    // Bar fill, when we know the previous level's threshold, reflects
    // *within-level* progress so it matches the in-game bar visually.
    let pct;
    if (u.prevLevelXp != null && u.totalXp > u.prevLevelXp) {
      const inLevel = Math.max(0, u.curXp - u.prevLevelXp);
      const levelSpan = u.totalXp - u.prevLevelXp;
      pct = Math.min(100, (inLevel / levelSpan) * 100);
    } else {
      pct = Math.min(100, (u.curXp / u.totalXp) * 100);
    }
    progressFill.style.width = pct.toFixed(1) + '%';
    progressText.textContent = `${fmt(u.curXp)} / ${fmt(u.totalXp)} xp · ${pct.toFixed(1)}%`;
  } else {
    progressFill.style.width = '0%';
    progressText.textContent = '—';
  }

  if (u.etaSec != null) {
    etaEl.textContent = `next level in ${fmtDuration(u.etaSec)}`;
  } else {
    etaEl.textContent = '—';
  }

  if (u.skillBest && u.skillBest > 0) {
    bestEl.textContent = `best: ${u.skillBest.toFixed(2)} xp/s`;
  } else {
    bestEl.textContent = 'best: —';
  }

  if (u.state === 'background') {
    statusEl.textContent = 'estimated · game in background';
  } else if (u.state === 'viewing-other') {
    statusEl.textContent = 'skill in background';
  } else if (u.state === 'paused') {
    statusEl.textContent = 'paused';
  } else {
    statusEl.textContent = u.statusMessage || '';
  }
});
