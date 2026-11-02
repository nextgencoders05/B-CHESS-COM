/* Navigation only: builds a sidebar (desktop) / bottom bar (mobile) that CLICKS the existing
   mode buttons. It never changes game logic, voice/mic, rules or modes. */
(function () {
  'use strict';
  var items = [
    { id: 'modeAnalyzeBtn', ico: '🔍', label: 'Analyze' },
    { id: 'modeBotBtn',     ico: '🤖', label: 'Vs Bot' },
    { id: 'modeFriendBtn',  ico: '👥', label: 'Friend' },
    { id: 'modeBooksBtn',   ico: '📚', label: 'Books' }
  ];
  function init() {
    if (document.getElementById('uxNav')) return;
    var targets = items.map(function (i) { return document.getElementById(i.id); });
    if (targets.some(function (t) { return !t; })) return; // fail safe: keep original UI
    var nav = document.createElement('nav');
    nav.id = 'uxNav';
    nav.setAttribute('aria-label', 'Main navigation');
    var logo = document.createElement('div');
    logo.className = 'ux-nav-logo'; logo.textContent = '♟';
    nav.appendChild(logo);
    var btns = items.map(function (it, idx) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ux-nav-item';
      b.innerHTML = '<span class="ux-ico">' + it.ico + '</span><span>' + it.label + '</span>';
      b.addEventListener('click', function () { targets[idx].click(); setTimeout(sync, 0); });
      nav.appendChild(b);
      return b;
    });
    document.body.appendChild(nav);
    function sync() {
      targets.forEach(function (t, i) { btns[i].classList.toggle('active', t.classList.contains('active')); });
    }
    var mo = new MutationObserver(sync);
    targets.forEach(function (t) { mo.observe(t, { attributes: true, attributeFilter: ['class'] }); });
    sync();
    document.body.classList.add('ux-nav-ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
