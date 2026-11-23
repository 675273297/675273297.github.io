/**
 * 慢岛生活 · 探索页逻辑（v2）
 *
 * 交互：
 *   世界地图 → 点击国家 → 下钻到该国省/州 → 点击省 → 选中
 *   顶部搜索框 + 右侧类型 + 搜索栏旁的门户下拉框
 *
 * 下钻只对有省级数据的国家生效（SUBDIVISIONS 里有的），其余国家直接选中。
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
    level: 'world',      // 'world' | 'sub'
    countryCode: null,
    countryName: null,
    subName: null,       // 省/州名
    categoryId: 'all',
    keyword: '',
  };

  // ---------- DOM ----------
  var svg = document.getElementById('map');
  var chipsEl = document.getElementById('chips');
  var catListEl = document.getElementById('catList');
  var searchInput = document.getElementById('searchInput');
  var searchClear = document.getElementById('searchClear');
  var portalQueryEl = document.getElementById('portalQuery');
  var breadcrumbEl = document.getElementById('breadcrumb');
  var backBtn = document.getElementById('mapBack');
  var portalSelect = document.getElementById('portalSelect');
  var portalIconRow = document.getElementById('portalIconRow');
  var portalPanel = document.getElementById('portalPanel');
  var portalPanelList = document.getElementById('portalPanelList');
  var portalEmpty = document.getElementById('portalEmpty');

  // ---------- 投影 ----------
  // 世界视图：与 build-map 生成时一致（1000 宽，投影高 projectH）
  var W = map.width;
  var PROJ_H = map.projectH || map.height;

  function projectWorld(lat, lon) {
    return [((lon + 180) / 360) * W, ((90 - lat) / 180) * PROJ_H];
  }

  // ---------- 图层 ----------
  var worldLayer = document.createElementNS(NS, 'g');
  var subLayer = document.createElementNS(NS, 'g');
  var cityLayer = document.createElementNS(NS, 'g');
  svg.appendChild(worldLayer);
  svg.appendChild(subLayer);
  svg.appendChild(cityLayer);

  var countryEls = {};

  // 绘制世界国家
  // 关键：按路径长度（≈面积）降序，让大国先画、小国后画叠在上面。
  // 否则东南亚小国会盖住中国等大国，点击落到错误的国家。
  (function buildWorld() {
    var frag = document.createDocumentFragment();
    var sorted = map.countries.slice().sort(function (a, b) {
      return b.d.length - a.d.length;
    });
    sorted.forEach(function (c) {
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

  // ---------- 视图切换 ----------
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

    var bb = data.bbox; // [x, y, w, h] 屏幕坐标
    svg.setAttribute('viewBox', bb.join(' '));

    // 重建省级图层
    subLayer.innerHTML = '';
    data.units.forEach(function (u) {
      // 标注点类型（港澳这类面积极小的地区）：画可点击的圆点 + 引线
      if (u.marker) {
        buildMarker(u);
        return;
      }
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
      u._el = path;
      subLayer.appendChild(path);
    });

    renderCityDots();
    updateBreadcrumb();
    renderPortals();
    return true;
  }

  // ---------- 交互 ----------
  /**
   * 港澳这类面积极小的地区：画一个可点击的标注点。
   * 位置按经纬度投影到当前省级视图（10 倍坐标 + 等距圆柱）。
   * 标签方向可配置（labelDy / labelDx），避免相邻标注点文字重叠。
   */
  function buildMarker(u) {
    // 港澳两地在真实地理位置相距约 60km，在省级视图上不足 5px，
    // 必须人为错开，否则两个点与文字会叠在一起。
    var cfg = {
      'CN-HK': { lonOff: 0.55, dyOff: -22, dx: 15, anchor: 'start' },
      'CN-MO': { lonOff: -0.35, dyOff: 22, dx: 15, anchor: 'start' },
    }[u.c] || { lonOff: 0, dyOff: 0, dx: 15, anchor: 'start' };

    var x = Math.round((u.lon + cfg.lonOff + 180) * 10);
    var y = Math.round((90 - u.lat) * 10 + cfg.dyOff);

    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'sub-marker');

    // 引线：从真实位置指向标注点，说明这是偏移显示
    var ax = Math.round((u.lon + 180) * 10);
    var ay = Math.round((90 - u.lat) * 10);
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
    label.setAttribute('text-anchor', cfg.anchor);
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

    u._el = g;
    subLayer.appendChild(g);
  }

  function onCountryClick(c) {
    state.countryName = c.n;
    // 有省级数据就下钻，否则直接选中
    if (state.countryCode !== c.c) {
      state.subName = null;
    }
    if (!showCountry(c.c)) {
      // 无下钻数据：停在世界视图，标记选中
      state.level = 'world';
      state.countryCode = c.c;
      state.subName = null;
      highlightCountry(c.c);
      renderCityDots();
      updateBreadcrumb();
      renderPortals();
    } else {
      // 下钻后，把国家名记录下来供面包屑和查询使用
      state.countryName = c.n;
      updateBreadcrumb();
      renderPortals();
    }
  }

  function onSubClick(u, el) {
    // 再次点击同一个 = 取消
    if (state.subName === u.n) {
      state.subName = null;
      clearSubSelection();
      el.classList.remove('is-selected');
    } else {
      state.subName = u.n;
      clearSubSelection();
      el.classList.add('is-selected');
      // 标注点的选中态加在圆点上
      if (u.marker) {
        var dot = el.querySelector('.marker-dot');
        if (dot) dot.classList.add('is-selected');
      }
    }
    updateBreadcrumb();
    renderPortals();
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

  backBtn.addEventListener('click', function () {
    showWorld();
  });

  // ---------- 城市点 ----------
  function renderCityDots() {
    cityLayer.innerHTML = '';
    if (state.level !== 'world' || !state.countryCode) return;

    var pool = cities.filter(function (c) { return c.c === state.countryCode; });
    pool.forEach(function (city) {
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
      if (state.subName) {
        parts.push('<span class="bc-sep">›</span>');
        parts.push('<button type="button" class="bc-link" data-level="country">' + esc(state.countryName) + '</button>');
      } else {
        parts.push('<span class="bc-sep">›</span>');
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

  // ---------- 条件 chips ----------
  function renderChips() {
    var parts = [];
    if (state.countryName) {
      parts.push(chip('地区', state.countryName, function () { showWorld(); }));
    }
    if (state.subName) {
      parts.push(chip('省份', state.subName, function () {
        state.subName = null;
        if (state.countryCode) showCountry(state.countryCode);
      }));
    }
    var cat = categories.filter(function (c) { return c.id === state.categoryId; })[0];
    if (cat && cat.id !== 'all') {
      parts.push(chip('类型', cat.name, function () { state.categoryId = 'all'; render(); }));
    }
    if (state.keyword) {
      parts.push(chip('关键词', state.keyword, function () {
        state.keyword = '';
        searchInput.value = '';
        render();
      }));
    }
    chipsEl.innerHTML = '';
    if (!parts.length) {
      chipsEl.innerHTML = '<span class="chips-empty">点击地图上的国家开始探索</span>';
      return;
    }
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

  // ---------- 分类 ----------
  function renderCategories() {
    catListEl.innerHTML = '';
    categories.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-item' + (state.categoryId === cat.id ? ' is-active' : '');
      btn.textContent = cat.name;
      btn.addEventListener('click', function () {
        state.categoryId = cat.id;
        render();
      });
      catListEl.appendChild(btn);
    });
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

  // ---------- 门户下拉 ----------
  function renderPortals() {
    var q = buildQuery();

    if (!q) {
      portalQueryEl.textContent = '';
      portalQueryEl.hidden = true;
      portalSelect.classList.remove('is-active');
      portalIconRow.hidden = true;
      portalEmpty.hidden = false;
      closePanel();
      return;
    }

    portalQueryEl.hidden = false;
    portalQueryEl.textContent = q;
    portalSelect.classList.add('is-active');
    portalEmpty.hidden = true;
    portalIconRow.hidden = false;

    // 小图标行（当前选中的门户直接点开）
    portalIconRow.innerHTML = '';
    portals.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'portal-mini';
      a.href = p.url(q);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = p.name;
      a.innerHTML =
        '<span class="mini-dot" style="background:' + p.color + '"></span>' +
        '<span class="mini-name">' + esc(p.name) + '</span>';
      portalIconRow.appendChild(a);
    });

    // 下拉面板内容
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
      a.addEventListener('click', function () { closePanel(); });
      portalPanelList.appendChild(a);
    });
  }

  function openPanel() {
    var q = buildQuery();
    if (!q) return;
    renderPanelList(q);
    portalPanel.hidden = false;
    portalSelect.setAttribute('aria-expanded', 'true');
  }

  function closePanel() {
    portalPanel.hidden = true;
    portalSelect.setAttribute('aria-expanded', 'false');
  }

  portalSelect.addEventListener('click', function (e) {
    e.stopPropagation();
    if (portalPanel.hidden) openPanel();
    else closePanel();
  });

  document.addEventListener('click', function (e) {
    if (!portalPanel.hidden && !portalPanel.contains(e.target) && !portalSelect.contains(e.target)) {
      closePanel();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePanel();
  });

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
    showWorld();
    state.categoryId = 'all';
    render();
    searchInput.focus();
  });

  // ---------- 统一渲染 ----------
  function render() {
    renderChips();
    renderCategories();
    updateBreadcrumb();
    renderPortals();
  }

  // ---------- 初始化 ----------
  subLayer.style.display = 'none';
  worldLayer.style.display = '';
  backBtn.hidden = true;
  portalPanel.hidden = true;
  portalIconRow.hidden = true;

  // 关键：先设置世界视图的 viewBox，否则地图会被脚本默认尺寸裁切
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + map.height);

  renderCategories();
  renderChips();
  updateBreadcrumb();
  renderPortals();
})();
