const rectEl = document.getElementById('rect');
const sizeEl = document.getElementById('size');

let start = null;

function rectFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function drawRect(r) {
  rectEl.style.display = 'block';
  rectEl.style.left = r.x + 'px';
  rectEl.style.top = r.y + 'px';
  rectEl.style.width = r.w + 'px';
  rectEl.style.height = r.h + 'px';

  sizeEl.style.display = 'block';
  sizeEl.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
  sizeEl.style.left = (r.x + r.w + 6) + 'px';
  sizeEl.style.top = (r.y + r.h + 6) + 'px';
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  drawRect({ x: start.x, y: start.y, w: 0, h: 0 });
});

window.addEventListener('mousemove', (e) => {
  if (!start) return;
  drawRect(rectFromPoints(start, { x: e.clientX, y: e.clientY }));
});

window.addEventListener('mouseup', (e) => {
  if (!start) return;
  const r = rectFromPoints(start, { x: e.clientX, y: e.clientY });
  start = null;
  if (r.w < 6 || r.h < 6) {
    window.gruntrate.pickerCancel();
    return;
  }
  window.gruntrate.pickerSubmit(r);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.gruntrate.pickerCancel();
});
