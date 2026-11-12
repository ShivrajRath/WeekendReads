'use strict';

(function () {
  const root = document.documentElement;
  const themeToggle = document.querySelector('[data-theme-toggle]');
  const progress = document.querySelector('[data-reading-progress]');
  const filterButtons = [...document.querySelectorAll('[data-filter]')];
  const layoutButtons = [...document.querySelectorAll('[data-layout]')];
  const cards = [...document.querySelectorAll('.content-card[data-category]')];
  const stories = [...document.querySelectorAll('.story[data-category]')];
  const filterStatus = document.querySelector('[data-filter-status]');
  const emptyFilter = document.querySelector('[data-empty-filter]');
  const resetFilter = document.querySelector('[data-reset-filter]');

  function stored(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function store(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Storage can be unavailable in private modes. */
    }
  }

  function setTheme(theme) {
    root.dataset.theme = theme;
    if (!themeToggle) return;
    const isDark = theme === 'dark';
    const label = themeToggle.querySelector('.theme-label');
    if (label) label.textContent = isDark ? 'Day' : 'Night';
    themeToggle.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    themeToggle.setAttribute('aria-pressed', String(isDark));
  }

  setTheme(root.dataset.theme || 'light');

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      store('wr-theme', next);
    });
  }

  function updateProgress() {
    if (!progress) return;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const percent = scrollable > 0 ? Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100)) : 0;
    progress.style.width = `${percent}%`;
  }

  let progressFrame = null;
  function scheduleProgress() {
    if (progressFrame) return;
    progressFrame = window.requestAnimationFrame(() => {
      progressFrame = null;
      updateProgress();
    });
  }

  window.addEventListener('scroll', scheduleProgress, { passive: true });
  window.addEventListener('resize', scheduleProgress);
  updateProgress();

  function applyFilter(category) {
    if (!filterButtons.length) return;

    let visibleCards = 0;
    for (const card of cards) {
      const visible = category === 'all' || card.dataset.category === category;
      card.hidden = !visible;
      if (visible) visibleCards += 1;
    }
    for (const story of stories) {
      story.hidden = category !== 'all' && story.dataset.category !== category;
    }

    for (const button of filterButtons) {
      const active = button.dataset.filter === category;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    if (filterStatus) {
      const total = cards.length;
      filterStatus.textContent =
        category === 'all'
          ? `Showing all ${total} stories`
          : `Showing ${visibleCards} of ${total} stories`;
    }

    if (emptyFilter) emptyFilter.hidden = visibleCards > 0;
  }

  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      applyFilter(button.dataset.filter || 'all');
      const contents = document.getElementById('contents');
      if (contents && window.scrollY > contents.offsetTop) {
        contents.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  if (resetFilter) {
    resetFilter.addEventListener('click', () => applyFilter('all'));
  }

  function setLayout(layout) {
    const next = layout === 'list' ? 'list' : 'grid';
    document.body.classList.toggle('layout-list', next === 'list');
    document.body.classList.toggle('layout-grid', next === 'grid');
    for (const button of layoutButtons) {
      const active = button.dataset.layout === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    store('wr-layout', next);
  }

  for (const button of layoutButtons) {
    button.addEventListener('click', () => setLayout(button.dataset.layout));
  }

  if (layoutButtons.length) {
    setLayout(stored('wr-layout', 'grid'));
  }

  // Keep outbound source links safe even if a template ever omits the attributes.
  for (const link of document.querySelectorAll('a[href^="http"]')) {
    if (!link.target) link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
})();
