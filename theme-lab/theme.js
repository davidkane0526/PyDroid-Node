const shell = document.querySelector('.app-shell');
const mode = document.querySelector('#mode');
const theme = document.querySelector('#canvas-theme');
const reset = document.querySelector('#reset');
const insights = document.querySelector('#toggle-insights');

function apply() {
  shell.dataset.theme = mode.value;
  shell.dataset.canvasTheme = theme.value;
  localStorage.setItem('pydroid-theme-lab', JSON.stringify({ mode: mode.value, theme: theme.value }));
}

try {
  const saved = JSON.parse(localStorage.getItem('pydroid-theme-lab') || 'null');
  if (saved?.mode) mode.value = saved.mode;
  if (saved?.theme) theme.value = saved.theme;
} catch {}
apply();
mode.addEventListener('change', apply);
theme.addEventListener('change', apply);
reset.addEventListener('click', () => { mode.value = 'light'; theme.value = 'soft'; apply(); });
insights.addEventListener('click', () => shell.classList.toggle('hide-insights'));
