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
  var hot = window.HOT_NEWS || null;

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

  var portalIconRow = document.getElementById('portalIconRow');
  var portalEmpty = document.getElementById('portalEmpty');

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
    map.countries
      .slice()
      .sort(function (a, b) { return b.d.length - a.d.length; })
      .forEach(function (c) {
        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', c.d);
        path.setAttribute('class', 'country');
        path.setAttribute('data-code', c.c || '');
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

    state.level = 'sub';
    state.countryCode = code;
    state.subName = null;

    worldLayer.style.display = 'none';
    subLayer.style.display = '';
    backBtn.hidden = false;

    svg.setAttribute('viewBox', data.bbox.join(' '));

    subLayer.innerHTML = '';
    data.units.forEach(function (u) {
      if (u.marker) { buildMarker(u); return; }
      if (!u.d) return;
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', u.d);
      path.setAttribute('class', 'subunit');
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

    if (!q) {
      portalSelect.classList.remove('is-active');
      portalCurIcon.hidden = true;
      portalIconRow.hidden = true;
      portalIconRow.innerHTML = ''; // 同时清掉旧链接，避免条件清空后残留上一次的地区
      portalEmpty.hidden = false;
      closeAllDropdowns();
      return;
    }

    portalSelect.classList.add('is-active');

    // 工具条上的小图标：默认展示第一个平台的色点
    portalCurIcon.hidden = false;
    portalCurIcon.innerHTML = '<span class="mini-dot" style="background:' + portals[0].color + '"></span>';

    portalEmpty.hidden = true;
    portalIconRow.hidden = false;

    // 快捷入口：一行展示全部
    portalIconRow.innerHTML = '';
    portals.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'portal-mini';
      a.href = p.url(q);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = p.name + ' 搜索「' + q + '」';
      a.innerHTML =
        '<span class="mini-dot" style="background:' + p.color + '"></span>' +
        '<span class="mini-name">' + esc(p.name) + '</span>';
      portalIconRow.appendChild(a);
    });

    if (!portalPanel.hidden) renderPanelList(q);
  }

  function renderPanelList(q) {
    portalPanelList.innerHTML = '';
    portals.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'panel-item';
      a.href = p.url(q);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML =
        '<span class="panel-dot" style="background:' + p.color + '"></span>' +
        '<span class="panel-text">' +
        '<span class="panel-name">' + esc(p.name) + '</span>' +
        '<span class="panel-desc">' + esc(p.desc) + '</span>' +
        '</span>';
      a.addEventListener('click', function () { portalDrop.close(); });
      portalPanelList.appendChild(a);
    });
  }

  // 打开平台面板时刷新内容
  portalSelect.addEventListener('click', function () {
    var q = buildQuery();
    if (q) renderPanelList(q);
  });

  // ---------- 热搜榜（随地图选择联动） ----------
  var regionKws = window.REGION_KEYWORDS || {};
  var hotTitleEl = document.getElementById('hotTitle');
  var hotFootEl = document.getElementById('hotFoot');
  var regionBlock = document.getElementById('regionBlock');
  var regionTitleEl = document.getElementById('regionTitle');
  var regionLinksEl = document.getElementById('regionLinks');

  /**
   * 选中地区时，从全国热搜里筛出提及该地区的条目。
   * 各平台都没有省级热搜接口（实测百度/微博/知乎/头条均无地域维度，
   * 头条的 city_id 参数实际被忽略），所以筛不到时就如实退回全国热搜并说明。
   */
  function pickHotItems() {
    var all = (hot && hot.items) || [];
    var region = state.subName || state.countryName;

    // 没选地区 → 全国热搜
    if (!region) {
      return { items: all.slice(0, 10), mode: 'national', region: null };
    }

    // 找关键词表：先按省名，再按去掉后缀的国家名
    var keys = regionKws[region];
    if (!keys) {
      var short = region.replace(/特别行政区|维吾尔自治区|自治区|省|市/g, '');
      keys = regionKws[short] || [short, region];
    }

    var hits = all.filter(function (it) {
      var w = it.word || '';
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] && w.indexOf(keys[i]) !== -1) return true;
      }
      return false;
    });

    return { items: hits.slice(0, 10), mode: 'region', region: region };
  }

  // ---------- 地区搜索入口（方案 A） ----------
  // 各平台都没有分省热搜，所以右侧改为给出「去该地区的实时新闻页」的直达入口：
  // 链接由对方平台实时生成，我们只负责把地区词拼进查询，不抓取、不缓存。

  /** 地区搜索专用站：按「地区 + 新闻」拼词 */
  var REGION_SOURCES = [
    { name: '百度新闻', color: '#2932E1', url: function (q) { return 'https://www.baidu.com/s?tn=news&wd=' + encodeURIComponent(q); } },
    { name: '今日头条', color: '#F04142', url: function (q) { return 'https://so.toutiao.com/search?keyword=' + encodeURIComponent(q); } },
    { name: '微博', color: '#E6162D', url: function (q) { return 'https://s.weibo.com/weibo?q=' + encodeURIComponent(q); } },
    { name: '知乎', color: '#0084FF', url: function (q) { return 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(q); } },
    { name: '抖音', color: '#161823', url: function (q) { return 'https://www.douyin.com/search/' + encodeURIComponent(q); } },
  ];

  /** 去掉「省 / 市 / 自治区 / 特别行政区」等后缀，只用于显示 */
  function shortName(name) {
    return String(name).replace(/维吾尔自治区|回族自治区|壮族自治区|特别行政区|自治区|省|市$/g, '') || name;
  }

  function renderRegionBlock() {
    var region = state.subName || state.countryName;
    if (!region) {
      regionBlock.hidden = true;
      regionLinksEl.innerHTML = '';
      return;
    }

    regionBlock.hidden = false;
    regionTitleEl.textContent = shortName(region) + ' · 去逛逛';

    var q = region + ' 新闻';
    regionLinksEl.innerHTML = '';
    REGION_SOURCES.forEach(function (src) {
      var a = document.createElement('a');
      a.className = 'region-link';
      a.href = src.url(q);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = '在' + src.name + '搜索「' + q + '」';
      a.innerHTML =
        '<span class="panel-dot" style="background:' + src.color + '"></span>' +
        '<span class="region-link-name">' + esc(src.name) + '</span>' +
        '<span class="region-link-go" aria-hidden="true">↗</span>';
      regionLinksEl.appendChild(a);
    });
  }

  function renderHot() {
    renderRegionBlock();

    var picked = pickHotItems();
    var items = picked.items;

    // 标题随地区切换
    if (hotTitleEl) {
      if (picked.mode === 'region') {
        hotTitleEl.textContent = shortName(picked.region) + ' 相关热搜';
      } else {
        hotTitleEl.textContent = '热搜榜';
      }
      hotTitleEl.classList.toggle('is-region', picked.mode === 'region');
    }

    // 筛不到地区热搜时如实说明，不留空白也不假装有
    var noteHtml = '';
    if (picked.mode === 'region') {
      noteHtml = '';
    } else if (picked.mode === 'national' && !(hot && hot.items && hot.items.length)) {
      noteHtml = '';
    }
    if (picked.mode === 'region' && !items.length) {
      noteHtml = '<p class="hot-note">「' + esc(shortName(picked.region)) + '」暂时没有上榜的全国热搜</p>';
    }

    hotListEl.innerHTML = noteHtml;
    items.forEach(function (it, i) {
      var a = document.createElement('a');
      a.className = 'hot-item';
      a.href = it.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML =
        '<span class="hot-rank' + (i < 3 ? ' is-top' : '') + '">' + (i + 1) + '</span>' +
        '<span class="hot-word">' + esc(it.word) + '</span>';
      hotListEl.appendChild(a);
    });

    if (!items.length && !noteHtml) {
      hotListEl.innerHTML = '<p class="hot-loading">暂无数据</p>';
    }

    // 页脚说明随模式变化
    if (hotFootEl) {
      if (picked.mode === 'region') {
        hotFootEl.textContent = '全国热搜中提及「' + shortName(picked.region) + '」的条目 · 数据来自百度';
      } else if (picked.region) {
        hotFootEl.textContent = '各平台均无省级热搜，这里显示全国热搜 · 数据来自百度';
      } else {
        hotFootEl.textContent = '数据来自百度热搜，点击跳转';
      }
    }

    if (hot && hot.updated) {
      var d = new Date(hot.updated);
      if (!isNaN(d.getTime())) {
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        hotUpdatedEl.textContent =
          pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      }
    }
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
  portalIconRow.hidden = true;

  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + map.height);

  renderCategories();
  renderChips();
  updateBreadcrumb();
  renderPortals();
  renderHot();
  updateScaleBar();
})();
