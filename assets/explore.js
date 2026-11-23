/**
 * 慢岛生活 · 探索页逻辑
 *
 * 交互流程：
 *   点地图选国家 → 可再点城市 → 选类型 → 输关键词
 *   → 组合成查询词 → 生成各门户的预填搜索链接
 */
(function () {
  'use strict';

  var map = window.WORLD_MAP;
  var cities = window.CITIES || [];
  var portals = window.PORTALS || [];
  var categories = window.CATEGORIES || [];

  if (!map) return;

  // ---------- 状态 ----------
  var state = {
    countryCode: null,
    countryName: null,
    cityName: null,
    categoryId: 'all',
    keyword: '',
  };

  // ---------- DOM ----------
  var svg = document.getElementById('map');
  var chipsEl = document.getElementById('chips');
  var catListEl = document.getElementById('catList');
  var searchInput = document.getElementById('searchInput');
  var searchClear = document.getElementById('searchClear');
  var portalGridEl = document.getElementById('portalGrid');
  var portalQueryEl = document.getElementById('portalQuery');
  var portalHintEl = document.getElementById('portalHint');

  // ---------- 绘制地图 ----------
  var NS = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', '0 0 ' + map.width + ' ' + map.height);

  var countryEls = {};

  // 用文档片段一次性插入，避免逐个国家触发重排
  var frag = document.createDocumentFragment();

  map.countries.forEach(function (c) {
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', c.d);
    path.setAttribute('class', 'country');
    path.setAttribute('data-code', c.c || '');
    path.setAttribute('data-name', c.n || '');
    var title = document.createElementNS(NS, 'title');
    title.textContent = c.n || c.e || '';
    path.appendChild(title);
    path.addEventListener('click', function () {
      selectCountry(c);
    });
    if (c.c) countryEls[c.c] = path;
    frag.appendChild(path);
  });

  // 城市点图层
  var cityLayer = document.createElementNS(NS, 'g');
  cityLayer.setAttribute('id', 'cityLayer');
  frag.appendChild(cityLayer);

  svg.appendChild(frag);

  // 投影：与生成脚本保持一致（等距圆柱）
  // projectH 是投影总高（含被裁掉的部分），height 是 viewBox 可见高度
  var projH = map.projectH || map.height;

  function project(lat, lon) {
    return [
      ((lon + 180) / 360) * map.width,
      ((90 - lat) / 180) * projH,
    ];
  }

  // ---------- 选中逻辑 ----------
  function selectCountry(c) {
    if (state.countryCode === c.c) {
      // 再次点击同一个国家 = 取消
      state.countryCode = null;
      state.countryName = null;
      state.cityName = null;
    } else {
      state.countryCode = c.c;
      state.countryName = c.n;
      state.cityName = null;
    }
    render();
  }

  function selectCity(city) {
    state.cityName = state.cityName === city.name ? null : city.name;
    render();
  }

  // ---------- 渲染 ----------
  function render() {
    renderMapSelection();
    renderCityDots();
    renderChips();
    renderCategories();
    renderPortals();
  }

  function renderMapSelection() {
    Object.keys(countryEls).forEach(function (code) {
      var el = countryEls[code];
      if (state.countryCode === code) el.classList.add('is-selected');
      else el.classList.remove('is-selected');
    });
  }

  /** 在当前选中（或全部）国家上画城市点 */
  function renderCityDots() {
    cityLayer.innerHTML = '';
    var pool = state.countryCode
      ? cities.filter(function (c) { return c.c === state.countryCode; })
      : [];

    pool.forEach(function (city) {
      var xy = project(city.lat, city.lon);
      var dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', xy[0]);
      dot.setAttribute('cy', xy[1]);
      dot.setAttribute('r', state.cityName === city.name ? 4.6 : 3.2);
      dot.setAttribute('class', 'city-dot');
      dot.style.cursor = 'pointer';
      dot.style.pointerEvents = 'auto';
      var title = document.createElementNS(NS, 'title');
      title.textContent = city.name;
      dot.appendChild(title);
      dot.addEventListener('click', function (e) {
        e.stopPropagation();
        selectCity(city);
      });
      cityLayer.appendChild(dot);
    });
  }

  function renderChips() {
    var parts = [];

    if (state.countryName) {
      parts.push(chip('地区', state.countryName, function () {
        state.countryCode = null;
        state.countryName = null;
        state.cityName = null;
        render();
      }));
    }

    if (state.cityName) {
      parts.push(chip('城市', state.cityName, function () {
        state.cityName = null;
        render();
      }));
    }

    var cat = categories.filter(function (c) { return c.id === state.categoryId; })[0];
    if (cat && cat.id !== 'all') {
      parts.push(chip('类型', cat.name, function () {
        state.categoryId = 'all';
        render();
      }));
    }

    if (state.keyword) {
      parts.push(chip('关键词', state.keyword, function () {
        state.keyword = '';
        searchInput.value = '';
        render();
      }));
    }

    if (!parts.length) {
      chipsEl.innerHTML = '<span class="chips-empty">还没有选择条件 —— 点一下地图上的国家开始</span>';
      return;
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

  /** 拼出最终查询词 */
  function buildQuery() {
    var cat = categories.filter(function (c) { return c.id === state.categoryId; })[0];
    var bits = [];

    // 关键词优先，其次地区
    if (state.keyword) bits.push(state.keyword.trim());
    if (state.cityName) bits.push(state.cityName);
    else if (state.countryName) bits.push(state.countryName);
    if (cat && cat.term) bits.push(cat.term);

    return bits.join(' ').trim();
  }

  function renderPortals() {
    var q = buildQuery();

    if (!q) {
      portalQueryEl.textContent = '';
      portalQueryEl.style.display = 'none';
      portalHintEl.textContent = '选择一个地区、类型，或直接输入关键词，这里会生成对应的搜索入口。';
      portalGridEl.innerHTML =
        '<div class="portal-empty">' +
        '先选一个条件：<br>点地图上的国家，或在上面输入关键词' +
        '</div>';
      return;
    }

    portalQueryEl.style.display = '';
    portalQueryEl.textContent = q;
    portalHintEl.textContent =
      '点击会在新标签页打开对应平台自己的搜索页（已填好查询词），不是本站代理。';

    portalGridEl.innerHTML = '';
    portals.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'portal-link';
      a.href = p.url(q);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      var dot = document.createElement('span');
      dot.className = 'portal-dot';
      dot.style.background = p.color;

      var text = document.createElement('span');
      text.className = 'portal-text';

      var name = document.createElement('span');
      name.className = 'portal-name';
      name.textContent = p.name;

      var desc = document.createElement('span');
      desc.className = 'portal-desc';
      desc.textContent = p.desc;

      text.appendChild(name);
      text.appendChild(desc);
      a.appendChild(dot);
      a.appendChild(text);
      portalGridEl.appendChild(a);
    });
  }

  // ---------- 事件 ----------
  var timer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.keyword = searchInput.value;
      renderChips();
      renderPortals();
    }, 220);
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      searchInput.value = '';
      state.keyword = '';
      renderChips();
      renderPortals();
    }
  });

  searchClear.addEventListener('click', function () {
    searchInput.value = '';
    state.keyword = '';
    state.countryCode = null;
    state.countryName = null;
    state.cityName = null;
    state.categoryId = 'all';
    searchInput.focus();
    render();
  });

  // 初始渲染
  render();
})();
