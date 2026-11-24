/**
 * 慢岛生活 · 探索页逻辑（v3）
 *
 * 布局：
 *   第一行  搜索框 + 类型下拉 + 平台下拉
 *   第二行  面包屑 + 条件 chips
 *   地图    世界 → 国家 → 省份（27 省 + 港澳台）
 *   下方    平台快捷入口（一行）
 *   右侧    百度热搜 Top 10
 */
(function () {
  'use strict';

  var map = window.WORLD_MAP;
  var cities = window.CITIES || [];
  var portals = window.PORTALS || [];
  var categories = window.CATEGORIES || [];
  var subs = window.SUBDIVISIONS || {};

  if (!map) return;

  var NS = 'http://www.w3.org/2000/svg';

  // ---------- 状态 ----------
  var state = {
    level: 'world',
    countryCode: null,
    countryName: null,
    subName: null,
    categoryId: 'all',
    keyword: '',
  };

  // ---------- DOM ----------
  var svg = document.getElementById('map');
  var chipsEl = document.getElementById('chips');
  var breadcrumbEl = document.getElementById('breadcrumb');
  var backBtn = document.getElementById('mapBack');

  var searchInput = document.getElementById('searchInput');
  var searchClear = document.getElementById('searchClear');

  var catSelect = document.getElementById('catSelect');
  var catPanel = document.getElementById('catPanel');
  var catListEl = document.getElementById('catList');
  var catCurrent = document.getElementById('catCurrent');

  var portalSelect = document.getElementById('portalSelect');
  var portalPanel = document.getElementById('portalPanel');
  var portalPanelList = document.getElementById('portalPanelList');
  var portalCurIcon = document.getElementById('portalCurIcon');

  var hotListEl = document.getElementById('hotList');
  var hotUpdatedEl = document.getElementById('hotUpdated');

  // ---------- 投影 ----------
  var W = map.width;
  var PROJ_H = map.projectH || map.height;

  function projectWorld(lat, lon) {
    return [((lon + 180) / 360) * W, ((90 - lat) / 180) * PROJ_H];
  }

  // ---------- 图层 ----------
  var worldLayer = document.createElementNS(NS, 'g');
  var subLayer = document.createElementNS(NS, 'g');
  var cityLayer = document.createElementNS(NS, 'g');
  // 比例尺层：始终在最上层，不参与点击
  var scaleLayer = document.createElementNS(NS, 'g');
  scaleLayer.setAttribute('id', 'scaleBar');
  scaleLayer.setAttribute('pointer-events', 'none');
  var scaleTextEl = document.createElementNS(NS, 'text');
  scaleTextEl.setAttribute('class', 'scale-text');
  scaleTextEl.setAttribute('fill', '#6b635a');
  scaleTextEl.setAttribute('font-size', '11');
  scaleTextEl.setAttribute('font-family', '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif');

  svg.appendChild(worldLayer);
  svg.appendChild(subLayer);
  svg.appendChild(cityLayer);
  svg.appendChild(scaleLayer);

  var scaleBarEl = scaleLayer;
  scaleLayer.appendChild(scaleTextEl);

  var countryEls = {};

  // 按路径长度（≈面积）降序：大国先画，小国后画叠在上层，
  // 否则东南亚小国会盖住中国，点击落到错误的国家。
  (function buildWorld() {
    var frag = document.createDocumentFragment();
    var sorted = map.countries.slice().sort(function (a, b) { return b.d.length - a.d.length; });
    sorted.forEach(function (c, i) {
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', c.d);
      path.setAttribute('class', 'country');
      path.setAttribute('data-code', c.c || '');
      // 入场淡入的错峰延迟：大国先浮现，小国随后补上
      if (i < 60) path.style.animationDelay = (i * 12) + 'ms';
      var t = document.createElementNS(NS, 'title');
      t.textContent = c.n || c.e || '';
      path.appendChild(t);
      path.addEventListener('click', function (e) {
        e.stopPropagation();
        onCountryClick(c);
      });
      if (c.c) countryEls[c.c] = path;
      frag.appendChild(path);
    });
    worldLayer.appendChild(frag);
  })();

  // ---------- 比例尺 ----------
  // 说明：世界视图用的是等距圆柱投影，这种投影在每个纬度上「1 SVG 单位对应的公里数」
  // 都不同（高纬被横向拉伸），所以严格意义上不存在一把处处准确的尺子。
  // 通行做法是按赤道比例绘制，并在高纬视图里按纬度余弦修正。
  //   世界视图：viewBox 宽 1000 覆盖 360° → 1 单位 = 0.36°
  //   省级视图：坐标 10 倍放大 → 1 单位 = 0.1°
  function updateScaleBar() {
    if (!scaleLayer) return;

    var vb = svg.getAttribute('viewBox').split(' ').map(Number);
    var vbX = vb[0], vbY = vb[1], vbW = vb[2], vbH = vb[3];

    var unitsPerDeg;   // 每度经度对应多少 SVG 单位
    var refLat;        // 按哪个纬度计算（世界视图用赤道，省级视图用实际纬度）

    if (state.level === 'world') {
      unitsPerDeg = W / 360;
      refLat = 0; // 赤道基准
    } else {
      unitsPerDeg = 10;
      refLat = 90 - (vbY + vbH / 2) / 10;
    }

    var kmPerDeg = 111.32 * Math.cos((refLat * Math.PI) / 180);
    if (!isFinite(kmPerDeg) || kmPerDeg <= 0.5) kmPerDeg = 111.32;

    // 每 SVG 单位实际代表多少公里
    var kmPerUnit = kmPerDeg / unitsPerDeg;

    // 选一个让比例尺占视图宽度 12%~20% 的整数刻度
    var targetKm = vbW * kmPerUnit * 0.16;
    var candidates = [50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 8000];
    var best = candidates[0], bestDiff = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var diff = Math.abs(candidates[i] - targetKm);
      if (diff < bestDiff) { bestDiff = diff; best = candidates[i]; }
    }

    var barUnits = best / kmPerUnit;

    var x0 = vbX + vbW * 0.035;
    var y0 = vbY + vbH * 0.94;
    var tick = vbH * 0.03;

    // 清掉旧线条，保留文字节点
    Array.prototype.slice.call(scaleLayer.querySelectorAll('line')).forEach(function (l) {
      l.remove();
    });

    function line(x1, y1, x2, y2) {
      var l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', '#6b635a');
      l.setAttribute('stroke-width', '1.2');
      l.setAttribute('vector-effect', 'non-scaling-stroke');
      l.setAttribute('opacity', '0.7');
      return l;
    }

    scaleLayer.insertBefore(line(x0, y0 - tick, x0, y0), scaleTextEl);
    scaleLayer.insertBefore(line(x0, y0, x0 + barUnits, y0), scaleTextEl);
    scaleLayer.insertBefore(line(x0 + barUnits, y0 - tick, x0 + barUnits, y0), scaleTextEl);

    var label = best >= 1000 ? best / 1000 + ' 千公里' : best + ' 公里';
    scaleTextEl.textContent = label;
    scaleTextEl.setAttribute('x', x0 + barUnits + vbW * 0.012);
    scaleTextEl.setAttribute('y', y0 + vbH * 0.012);
    scaleTextEl.setAttribute('font-size', String(Math.max(8, vbH * 0.028)));
  }

  // ---------- 视图 ----------
  function showWorld() {
    hideHover();
    state.level = 'world';
    state.countryCode = null;
    state.countryName = null;
    state.subName = null;
    worldLayer.style.display = '';
    subLayer.style.display = 'none';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + map.height);
    backBtn.hidden = true;
    renderCityDots();
    updateBreadcrumb();
    renderPortals();
    renderChips();
    updateScaleBar();
    renderHot();
  }

  function showCountry(code) {
    var data = subs[code];
    if (!data || !data.units.length) return false;

    hideHover();
    state.level = 'sub';
    state.countryCode = code;
    state.subName = null;

    worldLayer.style.display = 'none';
    subLayer.style.display = '';
    backBtn.hidden = false;

    svg.setAttribute('viewBox', data.bbox.join(' '));

    subLayer.innerHTML = '';
    data.units.forEach(function (u, i) {
      if (u.marker) { buildMarker(u); return; }
      if (!u.d) return;
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', u.d);
      path.setAttribute('class', 'subunit');
      if (i < 60) path.style.animationDelay = (i * 10) + 'ms';
      var t = document.createElementNS(NS, 'title');
      t.textContent = u.n || u.e || '';
      path.appendChild(t);
      path.addEventListener('click', function (e) {
        e.stopPropagation();
        onSubClick(u, path);
      });
      subLayer.appendChild(path);
    });

    renderCityDots();
    updateBreadcrumb();
    renderPortals();
    renderChips();
    updateScaleBar();
    renderHot(); // 右侧面板随国家切换重绘，否则会残留上一个国家
    return true;
  }

  // ---------- 省/州 交互 ----------
  function onCountryClick(c) {
    hideHover(); // 切换视图时清掉跟随标签
    state.countryName = c.n;
    if (state.countryCode !== c.c) state.subName = null;

    if (!showCountry(c.c)) {
      state.level = 'world';
      state.countryCode = c.c;
      state.subName = null;
      highlightCountry(c.c);
      renderCityDots();
      updateBreadcrumb();
      renderPortals();
      renderChips();
      renderHot();
    } else {
      state.countryName = c.n;
      updateBreadcrumb();
      renderPortals();
      renderChips();
      renderHot();
    }
  }

  function onSubClick(u, el) {
    hideHover(); // 选中省份时也清掉，避免标签停在旧位置
    if (state.subName === u.n) {
      state.subName = null;
      clearSubSelection();
    } else {
      state.subName = u.n;
      clearSubSelection();
      el.classList.add('is-selected');
      if (u.marker) {
        var dot = el.querySelector('.marker-dot');
        if (dot) dot.classList.add('is-selected');
      }
    }
    updateBreadcrumb();
    renderPortals();
    renderChips();
    renderHot();
  }

  function clearSubSelection() {
    Array.prototype.forEach.call(subLayer.children, function (c) {
      c.classList.remove('is-selected');
      var d = c.querySelector && c.querySelector('.marker-dot');
      if (d) d.classList.remove('is-selected');
    });
  }

  function highlightCountry(code) {
    Object.keys(countryEls).forEach(function (k) {
      countryEls[k].classList.toggle('is-selected', k === code);
    });
  }

  backBtn.addEventListener('click', function () { showWorld(); });

  /** 港澳这类面积极小地区：偏移标注点 + 虚线引线 */
  function buildMarker(u) {
    var cfg = {
      'CN-HK': { lonOff: 0.55, dyOff: -22, dx: 15 },
      'CN-MO': { lonOff: -0.35, dyOff: 22, dx: 15 },
    }[u.c] || { lonOff: 0, dyOff: 0, dx: 15 };

    var ax = Math.round((u.lon + 180) * 10);
    var ay = Math.round((90 - u.lat) * 10);
    var x = Math.round((u.lon + cfg.lonOff + 180) * 10);
    var y = ay + cfg.dyOff;

    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'sub-marker');

    if (ax !== x || ay !== y) {
      var line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', ax);
      line.setAttribute('y1', ay);
      line.setAttribute('x2', x);
      line.setAttribute('y2', y);
      line.setAttribute('class', 'marker-leader');
      g.appendChild(line);
    }

    var dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 9);
    dot.setAttribute('class', 'marker-dot');
    g.appendChild(dot);

    var label = document.createElementNS(NS, 'text');
    label.setAttribute('x', x + cfg.dx);
    label.setAttribute('y', y + 5);
    label.setAttribute('class', 'marker-label');
    label.textContent = u.n.replace(/特别行政区|省|市|自治区/g, '');
    g.appendChild(label);

    var t = document.createElementNS(NS, 'title');
    t.textContent = u.n;
    g.appendChild(t);

    g.style.cursor = 'pointer';
    g.addEventListener('click', function (e) {
      e.stopPropagation();
      onSubClick(u, g);
    });
    subLayer.appendChild(g);
  }

  // ---------- 城市点 ----------
  function renderCityDots() {
    cityLayer.innerHTML = '';
    if (state.level !== 'world' || !state.countryCode) return;
    cities
      .filter(function (c) { return c.c === state.countryCode; })
      .forEach(function (city) {
        var xy = projectWorld(city.lat, city.lon);
        var dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', xy[0]);
        dot.setAttribute('cy', xy[1]);
        dot.setAttribute('r', 3.2);
        dot.setAttribute('class', 'city-dot');
        var t = document.createElementNS(NS, 'title');
        t.textContent = city.name;
        dot.appendChild(t);
        cityLayer.appendChild(dot);
      });
  }

  // ---------- 面包屑 ----------
  function updateBreadcrumb() {
    if (state.level === 'world' && !state.countryCode) {
      breadcrumbEl.innerHTML = '<span class="bc-muted">世界</span>';
      return;
    }
    var parts = ['<button type="button" class="bc-link" data-level="world">世界</button>'];
    if (state.countryName) {
      parts.push('<span class="bc-sep">›</span>');
      if (state.subName) {
        parts.push('<button type="button" class="bc-link" data-level="country">' + esc(state.countryName) + '</button>');
      } else {
        parts.push('<span class="bc-current">' + esc(state.countryName) + '</span>');
      }
    }
    if (state.subName) {
      parts.push('<span class="bc-sep">›</span>');
      parts.push('<span class="bc-current">' + esc(state.subName) + '</span>');
    }
    breadcrumbEl.innerHTML = parts.join(' ');

    Array.prototype.forEach.call(breadcrumbEl.querySelectorAll('.bc-link'), function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-level') === 'world') showWorld();
        else if (state.countryCode) showCountry(state.countryCode);
      });
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- chips ----------
  function renderChips() {
    var parts = [];
    if (state.countryName) {
      parts.push(chip('地区', state.countryName, function () { showWorld(); }));
    }
    if (state.subName) {
      parts.push(chip('省份', state.subName, function () {
        state.subName = null;
        if (state.countryCode) showCountry(state.countryCode);
        renderChips();
        renderPortals();
      }));
    }
    if (state.keyword) {
      parts.push(chip('关键词', state.keyword, function () {
        state.keyword = '';
        searchInput.value = '';
        renderChips();
        renderPortals();
      }));
    }
    chipsEl.innerHTML = '';
    parts.forEach(function (el) { chipsEl.appendChild(el); });
  }

  function chip(label, value, onRemove) {
    var el = document.createElement('span');
    el.className = 'chip';
    var text = document.createElement('span');
    text.innerHTML = label + ' · <b></b>';
    text.querySelector('b').textContent = value;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', '移除 ' + label);
    btn.textContent = '×';
    btn.addEventListener('click', onRemove);
    el.appendChild(text);
    el.appendChild(btn);
    return el;
  }

  // ---------- 查询词 ----------
  function buildQuery() {
    var cat = categories.filter(function (c) { return c.id === state.categoryId; })[0];
    var bits = [];
    if (state.keyword) bits.push(state.keyword.trim());
    if (state.subName) bits.push(state.subName);
    else if (state.countryName) bits.push(state.countryName);
    if (cat && cat.term) bits.push(cat.term);
    return bits.join(' ').trim();
  }

  // ---------- 通用下拉控制 ----------
  function makeDropdown(triggerEl, panelEl) {
    function open() {
      closeAllDropdowns();
      panelEl.hidden = false;
      triggerEl.setAttribute('aria-expanded', 'true');
    }
    function close() {
      panelEl.hidden = true;
      triggerEl.setAttribute('aria-expanded', 'false');
    }
    triggerEl.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panelEl.hidden) open(); else close();
    });
    return { open: open, close: close, panel: panelEl, trigger: triggerEl };
  }

  var dropdowns = [];

  function closeAllDropdowns() {
    dropdowns.forEach(function (d) {
      d.panel.hidden = true;
      d.trigger.setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', function () {
    closeAllDropdowns();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAllDropdowns();
  });

  // ---------- 类型下拉 ----------
  document.addEventListener('DOMContentLoaded', function () {});

  var catDrop = makeDropdown(catSelect, catPanel);
  dropdowns.push(catDrop);
  catPanel.addEventListener('click', function (e) { e.stopPropagation(); });

  function renderCategories() {
    catListEl.innerHTML = '';
    categories.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dd-item' + (state.categoryId === cat.id ? ' is-active' : '');
      btn.textContent = cat.name;
      btn.addEventListener('click', function () {
        state.categoryId = cat.id;
        catCurrent.textContent = cat.name;
        catDrop.close();
        renderCategories();
        renderPortals();
      });
      catListEl.appendChild(btn);
    });
  }

  // ---------- 平台下拉 ----------
  var portalDrop = makeDropdown(portalSelect, portalPanel);
  dropdowns.push(portalDrop);
  portalPanel.addEventListener('click', function (e) { e.stopPropagation(); });

  function renderPortals() {
    var q = buildQuery();

    // 顶部「搜索」下拉：有查询词时提示已带上，没有时提示会打开热搜榜
    portalSelect.classList.toggle('is-active', !!q);
    portalCurIcon.hidden = !q;
    if (q && portals.length) {
      portalCurIcon.innerHTML = '<span class="mini-dot" style="background:' + portals[0].color + '"></span>';
    }

    if (!portalPanel.hidden) renderPanelList(q);
  }

  function renderPanelList(q) {
    portalPanelList.innerHTML = '';
    var hint = document.querySelector('#portalPanel .panel-hint');
    if (hint) {
      hint.textContent = q
        ? '选一个平台，在新标签页打开已填好查询词的搜索页'
        : '选一个平台，打开它自己的热搜榜';
    }
    portals.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'panel-item';
      a.href = q ? p.url(q) : p.home;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML =
        '<span class="panel-dot" style="background:' + p.color + '"></span>' +
        '<span class="panel-text">' +
        '<span class="panel-name">' + esc(p.name) + '</span>' +
        '<span class="panel-desc">' + esc(q ? p.desc : '打开热搜榜') + '</span>' +
        '</span>';
      a.addEventListener('click', function () { portalDrop.close(); });
      portalPanelList.appendChild(a);
    });
  }

  // 打开平台面板时刷新内容（没有查询词也要列出全部平台）
  portalSelect.addEventListener('click', function () {
    renderPanelList(buildQuery());
  });

  // ---------- 多平台热搜（手动切换 + 分页） ----------
  var hotFootEl = document.getElementById('hotFoot');
  var boardTabsEl = document.getElementById('boardTabs');
  var hotPagerEl = document.getElementById('hotPager');
  var hotData = window.HOT_BOARDS || { boards: [] };
  var activeBoardId = null;
  var hotPage = 0;
  var PAGE_SIZE = 10;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** 当前平台对象 */
  function currentBoard() {
    var boards = hotData.boards || [];
    if (!boards.length) return null;
    if (!activeBoardId) activeBoardId = boards[0].id;
    return boards.filter(function (b) { return b.id === activeBoardId; })[0] || boards[0];
  }

  function renderBoardTabs() {
    boardTabsEl.innerHTML = '';
    (hotData.boards || []).forEach(function (b) {
      var isOn = b.id === activeBoardId;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'board-tab' + (isOn ? ' is-active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', isOn ? 'true' : 'false');
      // 选中时用该平台的品牌色，未选中保持低调
      if (isOn) btn.style.setProperty('--tab-accent', b.color);
      btn.textContent = b.name;
      btn.addEventListener('click', function () {
        if (activeBoardId === b.id) return;
        activeBoardId = b.id;
        hotPage = 0;
        renderBoardTabs();
        renderHotList();
      });
      boardTabsEl.appendChild(btn);
    });
  }

  function renderHotList() {
    var board = currentBoard();
    if (!board) {
      hotListEl.innerHTML = '<p class="hot-loading">暂无数据</p>';
      hotPagerEl.innerHTML = '';
      hotFootEl.textContent = '';
      return;
    }

    hotUpdatedEl.textContent = fmtTime(board.updated || hotData.updated);

    var items = board.items || [];
    var pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (hotPage >= pages) hotPage = pages - 1;
    if (hotPage < 0) hotPage = 0;

    var start = hotPage * PAGE_SIZE;
    var slice = items.slice(start, start + PAGE_SIZE);

    hotListEl.innerHTML = '';
    slice.forEach(function (it, i) {
      var rank = start + i + 1;
      var a = document.createElement('a');
      a.className = 'hot-item';
      a.href = it.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML =
        '<span class="hot-rank' + (rank <= 3 ? ' is-top' : '') + '">' + rank + '</span>' +
        '<span class="hot-word">' + esc(it.title) + '</span>' +
        (it.hot ? '<span class="hot-value">' + esc(it.hot) + '</span>' : '');
      hotListEl.appendChild(a);
    });

    if (!items.length) {
      hotListEl.innerHTML = '<p class="hot-loading">这个平台暂时没有数据</p>';
    }

    renderPager(pages);
    hotFootEl.textContent = board.name + '热搜 · 共 ' + items.length + ' 条';
  }

  function renderPager(pages) {
    hotPagerEl.innerHTML = '';
    if (pages <= 1) return;

    function btn(label, page, opts) {
      opts = opts || {};
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pager-btn' + (opts.active ? ' is-active' : '');
      b.textContent = label;
      if (opts.disabled) {
        b.disabled = true;
      } else {
        b.addEventListener('click', function () {
          hotPage = page;
          renderHotList();
        });
      }
      if (opts.title) b.title = opts.title;
      return b;
    }

    hotPagerEl.appendChild(btn('‹', hotPage - 1, { disabled: hotPage === 0, title: '上一页' }));
    for (var p = 0; p < pages; p++) {
      hotPagerEl.appendChild(btn(String(p + 1), p, { active: p === hotPage }));
    }
    hotPagerEl.appendChild(btn('›', hotPage + 1, { disabled: hotPage === pages - 1, title: '下一页' }));
  }

  // ---------- 世界时钟 ----------
  // 时间由浏览器按 IANA 时区真实换算，不依赖任何接口
  var CLOCK_CITIES = [
    { name: '北京', tz: 'Asia/Shanghai' },
    { name: '巴黎', tz: 'Europe/Paris' },
    { name: '纽约', tz: 'America/New_York' },
    { name: '悉尼', tz: 'Australia/Sydney' },
  ];

  var worldClockEl = document.getElementById('worldClock');

  function timeIn(tz) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date());
    } catch (e) {
      return '';
    }
  }

  /** 按当地时间判断是白天还是夜里，用作小图标 */
  function isDaytime(tz) {
    try {
      var h = Number(
        new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date())
      );
      return h >= 7 && h < 19;
    } catch (e) {
      return true;
    }
  }

  function renderWorldClock() {
    if (!worldClockEl) return;
    worldClockEl.innerHTML = '';
    CLOCK_CITIES.forEach(function (c) {
      var day = isDaytime(c.tz);
      var span = document.createElement('span');
      span.className = 'clock-item';
      span.innerHTML =
        '<span class="clock-sun ' + (day ? 'is-day' : 'is-night') + '" aria-hidden="true">' +
        (day ? '☀' : '☾') +
        '</span>' +
        '<span class="clock-city">' + esc(c.name) + '</span>' +
        '<span class="clock-time">' + timeIn(c.tz) + '</span>';
      worldClockEl.appendChild(span);
    });
  }

  /** 依据各城市昼夜状态拼一句真实描述 */
  function dayNightText() {
    var day = [];
    var night = [];
    CLOCK_CITIES.forEach(function (c) {
      (isDaytime(c.tz) ? day : night).push(c.name);
    });
    if (day.length && night.length) {
      return day.join('、') + '还是白天，' + night.join('、') + '已经入夜';
    }
    if (day.length === CLOCK_CITIES.length) return '这几个城市此刻都是白天';
    if (night.length === CLOCK_CITIES.length) return '这几个城市此刻都在夜里';
    return '世界正安静地转动';
  }

  // ---------- 随手一条 ----------
  // 点「随便逛逛」时换一条。历史条目均为可查证事件；
  // 名言歌词标注出处；童年游戏与童梦是回忆性文字，不作事实断言。
  var NOTES = [
    // 历史上的一瞬
    { k: '史上一瞬', t: '1969 年，阿波罗 11 号降落静海。阿姆斯特朗说：这是个人的一小步，却是人类的一大步。' },
    { k: '史上一瞬', t: '1905 年，26 岁的爱因斯坦一年内发表四篇论文，后来被称为他的「奇迹年」。' },
    { k: '史上一瞬', t: '1989 年，蒂姆·伯纳斯-李在 CERN 提出超文本系统构想，万维网从此发芽。' },
    { k: '史上一瞬', t: '1953 年，沃森与克里克在《自然》发表 DNA 双螺旋结构，生命的密码本被翻开。' },
    { k: '史上一瞬', t: '1687 年，牛顿出版《自然哲学的数学原理》，天上与地上的力第一次被同一套公式描述。' },
    { k: '史上一瞬', t: '公元前三世纪，欧几里得用反证法证明：素数有无限多个。' },

    // 诗与文
    { k: '一句', t: '人生如逆旅，我亦是行人。', f: '苏轼《临江仙》' },
    { k: '一句', t: '黑夜给了我黑色的眼睛，我却用它寻找光明。', f: '顾城《一代人》' },
    { k: '一句', t: '凡是过往，皆为序章。', f: '莎士比亚《暴风雨》' },
    { k: '一句', t: '在冬天的深处，我终于明白，我身上有一个不可战胜的夏天。', f: '加缪《夏天集》' },
    { k: '一句', t: '此心安处是吾乡。', f: '苏轼《定风波》' },

    // 歌
    { k: '一句歌', t: '我曾经跨过山和大海，也穿过人山人海。', f: '朴树《平凡之路》' },
    { k: '一句歌', t: '越过山丘，虽然已白了头。', f: '李宗盛《山丘》' },
    { k: '一句歌', t: '逆风的方向，更适合飞翔。', f: '五月天《倔强》' },
    { k: '一句歌', t: '我来到你的城市，走过你来时的路。', f: '陈奕迅《好久不见》' },

    // 数学
    { k: '一个式子', t: 'e^(iπ) + 1 = 0。五个最重要的常数挤在一行里，被称为最优美的等式。' },
    { k: '一个式子', t: '0.999… 和 1 是同一个数，不是「约等于」。' },
    { k: '一个事实', t: '生日悖论：只要 23 个人，就有超过一半的概率存在两人同一天生日。' },
    { k: '一个事实', t: '布丰投针：往画满平行线的地板上随手扔针，数一数就能算出圆周率。' },
    { k: '一个事实', t: '1 + 2 + 3 + … 在黎曼 ζ 函数的正则化下等于 −1/12。反直觉，但并非胡说。' },

    // 童年游戏
    { k: '小时候', t: '跳皮筋：两人扯着橡皮筋，从脚踝、膝盖、腰、胸，一路升到头顶，跳到最后几乎是仰着头在蹦。' },
    { k: '小时候', t: '丢沙包：两边的人扔，中间的人躲。被砸中就下场，接住一次能加一条命。' },
    { k: '小时候', t: '翻花绳：一根打了结的线，两人轮着翻，能翻出「面条」「牛眼」「降落伞」。' },
    { k: '小时候', t: '跳房子：地上用粉笔画格子，单脚双脚换着跳，踢着瓦片不许压线。' },
    { k: '小时候', t: '拍画片：把印着人物的硬纸片摆在地上，用手掌扇，翻过面就算赢。' },

    // 童梦
    { k: '小时候', t: '小时候想当科学家，现在只想早点睡。' },
    { k: '小时候', t: '小时候以为长大就能随便熬夜，长大以后才发现，能早睡才是本事。' },
    { k: '小时候', t: '曾梦想当宇航员，后来发现光是坐地铁就够晕了。' },
    { k: '小时候', t: '小时候觉得大人什么都知道，长大才发现，大家都是在边猜边走。' },
  ];

  var noteIndex = -1;

  function pickNote() {
    // 避免连续两次抽到同一条
    var next = noteIndex;
    if (NOTES.length > 1) {
      while (next === noteIndex) next = Math.floor(Math.random() * NOTES.length);
    } else {
      next = 0;
    }
    noteIndex = next;
    return NOTES[noteIndex];
  }

  function renderNote(note) {
    var moodEl = document.getElementById('worldMood');
    if (!moodEl) return;
    if (!note) {
      moodEl.textContent = dayNightText();
      return;
    }
    moodEl.innerHTML =
      '<span class="note-label">' + esc(note.k) + '</span>' +
      '<span class="note-text">' + esc(note.t) + '</span>' +
      (note.f ? '<span class="note-from">—— ' + esc(note.f) + '</span>' : '');
  }

  // ---------- 随便逛逛 ----------
  var randomBtn = document.getElementById('randomBtn');

  randomBtn.addEventListener('click', function () {
    // 每次点击先换一条闲话
    renderNote(pickNote());

    // 再随机去一个国家；有省份数据的国家顺带随机选一个省份
    var all = (map.countries || []).filter(function (c) { return c.c && c.d; });
    if (!all.length) return;
    var pick = all[Math.floor(Math.random() * all.length)];

    var subData = subs[pick.c];
    if (subData && subData.units && subData.units.length) {
      showCountry(pick.c);
      state.countryName = pick.n;
      var units = subData.units.filter(function (u) { return u.n; });
      if (units.length) {
        var u = units[Math.floor(Math.random() * units.length)];
        state.subName = u.n;
        clearSubSelection();
        Array.prototype.forEach.call(subLayer.children, function (el) {
          var t = el.querySelector && el.querySelector('title');
          if (t && t.textContent === u.n) el.classList.add('is-selected');
        });
      }
      updateBreadcrumb();
      renderPortals();
      renderChips();
      renderHot();
    } else {
      onCountryClick(pick);
    }

    // 让用户立刻看到结果：平滑滚回地图
    var panel = document.querySelector('.map-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  /** 热搜面板：平台切换 + 分页 */
  function renderHot() {
    renderBoardTabs();
    renderHotList();
  }

  // ---------- 鼠标跟随标签 ----------
  // 原生 <title> 要悬停一秒才出现，这里做一个跟手的小标签
  var mapHoverEl = document.getElementById('mapHover');
  var mapPanelEl = document.querySelector('.map-panel');
  var lastHoverKey = '';

  function hideHover() {
    if (mapHoverEl) mapHoverEl.hidden = true;
    lastHoverKey = '';
  }

  if (svg && mapHoverEl && mapPanelEl) {
    svg.addEventListener('mousemove', function (e) {
      var t = e.target;
      if (!t || !t.classList) return hideHover();
      var isCountry = t.classList.contains('country');
      var isSub = t.classList.contains('subunit');
      if (!isCountry && !isSub && !t.closest('.sub-marker')) return hideHover();

      // 从 <title> 拿地名
      var holder = t.closest ? t.closest('.sub-marker') || t : t;
      var titleEl = holder.querySelector && holder.querySelector('title');
      var name = titleEl ? titleEl.textContent : '';
      if (!name) return hideHover();

      var key = name + '|' + (isSub ? 's' : 'c');
      if (key !== lastHoverKey) {
        lastHoverKey = key;
        mapHoverEl.textContent = name + (isCountry ? ' · 点击进入' : '');
        mapHoverEl.hidden = false;
      }

      // 跟随光标，并夹在地图范围内
      var rect = mapPanelEl.getBoundingClientRect();
      var pad = 12;
      var x = e.clientX - rect.left + 14;
      var y = e.clientY - rect.top - 10;
      var maxX = rect.width - mapHoverEl.offsetWidth - pad;
      if (x > maxX) x = e.clientX - rect.left - mapHoverEl.offsetWidth - 14;
      if (x < pad) x = pad;
      if (y < pad) y = pad;
      mapHoverEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    });

    svg.addEventListener('mouseleave', hideHover);
  }

  // ---------- 搜索 ----------
  var timer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.keyword = searchInput.value;
      renderChips();
      renderPortals();
    }, 220);
  });

  searchClear.addEventListener('click', function () {
    searchInput.value = '';
    state.categoryId = 'all';
    catCurrent.textContent = '全部';
    showWorld();
    renderCategories();
    searchInput.focus();
  });

  // ---------- 初始化 ----------
  subLayer.style.display = 'none';
  worldLayer.style.display = '';
  backBtn.hidden = true;
  portalPanel.hidden = true;
  catPanel.hidden = true;

  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + map.height);

  renderCategories();
  renderChips();
  updateBreadcrumb();
  renderPortals();
  renderHot();
  updateScaleBar();
  renderWorldClock();
  renderNote(pickNote());
  // 每分钟对一次时，跨整点也能跟着走
  setInterval(renderWorldClock, 60 * 1000);
})();
