'use strict';

const Tour = (() => {
  function icon(name) {
    const map = {
      people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3 19c1-3 3.5-5 6-5s5 2 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 19c.4-1.6 1.6-3 3.4-3.6"/></svg>',
      chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 6h14v9H8l-3 3V6z"/></svg>',
      image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M7 17l4-4 3 3 3-3 3 4"/></svg>',
      mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/></svg>',
      spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 6.2L20 10l-6.4 1.8L12 18l-1.6-6.2L4 10l6.4-1.8z"/></svg>'
    };
    return map[name] || map.spark;
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }

  async function start(steps) {
    const root = document.getElementById('tour');
    let i = 0;

    function close() {
      root.hidden = true;
      root.innerHTML = '';
      fetch('/api/me/tour-complete', { method: 'POST' }).catch(() => {});
    }

    function draw() {
      const step = steps[i];
      const el = typeof step.target === 'function' ? step.target() : document.querySelector(step.target);
      root.hidden = false;
      root.innerHTML = '';
      const r = el ? rectOf(el) : { top: 80, left: 24, width: window.innerWidth - 48, height: 80 };
      const pad = 8;
      const spot = document.createElement('div');
      spot.className = 'tour-spot';
      spot.style.top = `${r.top - pad}px`;
      spot.style.left = `${r.left - pad}px`;
      spot.style.width = `${r.width + pad * 2}px`;
      spot.style.height = `${r.height + pad * 2}px`;
      const arrow = document.createElement('div');
      arrow.className = 'tour-arrow';
      arrow.textContent = step.arrow === 'up' ? '↑' : step.arrow === 'left' ? '←' : step.arrow === 'right' ? '→' : '↓';
      arrow.style.top = `${step.arrow === 'up' ? r.top - 36 : r.top + r.height + 6}px`;
      arrow.style.left = `${r.left + r.width / 2 - 12}px`;
      const card = document.createElement('div');
      card.className = 'tour-card glass-card';
      const below = r.top + r.height + 48;
      card.style.top = `${Math.min(below, window.innerHeight - 190)}px`;
      card.style.left = '16px';
      card.innerHTML = `
        <div class="small muted">${typeof I18n !== 'undefined' ? I18n.t('tourLabel', { n: i + 1, total: steps.length }) : `Saka’s tour · ${i + 1}/${steps.length}`}</div>
        <p style="margin:8px 0 12px">${step.text}</p>
        <div class="row-2">
          <button class="btn secondary" type="button" data-skip>${typeof I18n !== 'undefined' ? I18n.t('skip') : 'Skip'}</button>
          <button class="btn" type="button" data-next>${i === steps.length - 1 ? (typeof I18n !== 'undefined' ? I18n.t('done') : 'Done') : (typeof I18n !== 'undefined' ? I18n.t('next') : 'Next')}</button>
        </div>`;
      root.append(spot, arrow, card);
      card.querySelector('[data-skip]').onclick = close;
      card.querySelector('[data-next]').onclick = () => {
        if (i === steps.length - 1) close();
        else {
          i += 1;
          if (steps[i].before) steps[i].before();
          requestAnimationFrame(draw);
        }
      };
    }

    if (steps[0] && steps[0].before) steps[0].before();
    draw();
  }

  return { start, icon };
})();
