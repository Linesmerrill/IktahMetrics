const list = document.getElementById('list');
const cancelBtn = document.getElementById('cancel');

cancelBtn.addEventListener('click', () => window.iktahmetrics.appPickerCancel());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.iktahmetrics.appPickerCancel();
});

window.iktahmetrics.onAppList((wins) => {
  list.innerHTML = '';
  if (!wins || wins.length === 0) {
    list.innerHTML = '<div class="empty">No on-screen windows found.</div>';
    return;
  }
  // Largest windows first — the game is almost always the biggest one.
  wins.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  for (const w of wins) {
    const row = document.createElement('div');
    row.className = 'row';

    const col = document.createElement('div');
    col.className = 'col';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = w.owner || '(unknown)';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = w.title || '';

    col.appendChild(name);
    if (w.title) col.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${w.w}×${w.h}`;

    row.appendChild(col);
    row.appendChild(meta);
    row.addEventListener('click', () => {
      window.iktahmetrics.appPickerSelect({
        owner: w.owner,
        bundleId: w.bundleId,
        title: w.title,
      });
    });
    list.appendChild(row);
  }
});
