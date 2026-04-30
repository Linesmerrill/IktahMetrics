const skillEl = document.getElementById('skill');
const levelEl = document.getElementById('level');
const rateEl = document.getElementById('rate');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const etaEl = document.getElementById('eta');
const bestEl = document.getElementById('best');
const statusEl = document.getElementById('status');

const SKILL_ICONS = {
  Attack: '⚔️', Strength: '💪', Defence: '🛡️', Defense: '🛡️', Health: '❤️',
  Woodcutting: '🪓', Mining: '⛏️', Fishing: '🎣', Gathering: '🌿', Tracking: '👣',
  Crafting: '🧵', Smithing: '🔨', Cooking: '🍳', Alchemy: '⚗️', Tailoring: '🪡',
  Carpentry: '🪚', Community: '👥', Landkeeping: '🌾',
};

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

window.iktahmetrics.onUpdate((u) => {
  document.body.classList.toggle('extrapolated', !!u.extrapolated);

  const icon = u.skill && SKILL_ICONS[u.skill] ? SKILL_ICONS[u.skill] + ' ' : '';
  skillEl.textContent = u.skill ? icon + u.skill : '—';
  levelEl.textContent = (u.level != null) ? `L${u.level}` : '';

  switch (u.kind) {
    case 'rate':
      if (u.extrapolated) {
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
    if (u.prevLevelXp != null && u.totalXp > u.prevLevelXp) {
      const inLevel = Math.max(0, u.curXp - u.prevLevelXp);
      const levelSpan = u.totalXp - u.prevLevelXp;
      const pct = Math.min(100, (inLevel / levelSpan) * 100);
      progressFill.style.width = pct.toFixed(1) + '%';
      progressText.textContent = `${fmt(inLevel)} / ${fmt(levelSpan)} xp · ${pct.toFixed(1)}%`;
    } else {
      // Don't yet know the previous level's threshold — show total-xp
      // progress as a fallback. Once a level-up is observed we'll switch
      // to within-level math automatically.
      const pct = Math.min(100, (u.curXp / u.totalXp) * 100);
      progressFill.style.width = pct.toFixed(1) + '%';
      progressText.textContent = `${fmt(u.curXp)} / ${fmt(u.totalXp)} xp · ${pct.toFixed(1)}%`;
    }
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

  statusEl.textContent = u.extrapolated ? 'estimated · game in background' : (u.statusMessage || '');
});
