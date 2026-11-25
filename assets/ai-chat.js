/* ============================================================
   慢岛生活 · 岛语（AI 闲聊角）
   ------------------------------------------------------------
   纯前端实现，没有任何后端。
   - API Key 只保存在本机浏览器的 localStorage，不会上传到任何服务器
   - 直接调用各厂商的 OpenAI 兼容接口（需要厂商允许跨域）
   - 对话内容同样只存在本地
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 服务商预设 ---------- */
  var PROVIDERS = [
    {
      id: 'qwen',
      name: '通义千问',
      base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      note: '阿里云百炼 · 每模型 100 万 token 免费（90 天）',
      keyUrl: 'https://bailian.console.aliyun.com/'
    },
    {
      id: 'doubao',
      name: '豆包',
      base: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-1.5-lite-32k',
      note: '火山方舟 · 个人开发者 50 万 token 免费',
      keyUrl: 'https://console.volcengine.com/ark'
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      base: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      note: '按量计费，API 不免费',
      keyUrl: 'https://platform.deepseek.com/api_keys'
    },
    {
      id: 'custom',
      name: '自定义',
      base: '',
      model: '',
      note: '任意 OpenAI 兼容接口，需支持浏览器跨域',
      keyUrl: ''
    }
  ];

  var STORE = 'mandao.ai.v1';
  var SYSTEM = '你是慢岛生活的一位朋友。回答简洁，语气温和，不说客套话。';
  var MAX_HISTORY = 60;
  var TIMEOUT = 90000;

  /* ---------- DOM ---------- */
  var elLog = document.getElementById('aiLog');
  var elForm = document.getElementById('aiForm');
  var elInput = document.getElementById('aiInput');
  var elSend = document.getElementById('aiSend');
  if (!elLog || !elForm || !elInput || !elSend) return; // 不在探索页

  var elPanel = document.getElementById('aiPanel');
  var elSettings = document.getElementById('aiSettings');
  var elSettingsBtn = document.getElementById('aiSettingsBtn');
  var elClearBtn = document.getElementById('aiClearBtn');
  var elEmpty = document.getElementById('aiEmpty');
  var elProviderTabs = document.getElementById('aiProviderTabs');
  var elKey = document.getElementById('aiKey');
  var elModel = document.getElementById('aiModel');
  var elBase = document.getElementById('aiBase');
  var elKeyUrl = document.getElementById('aiKeyUrl');
  var elNote = document.getElementById('aiNote');
  var elSave = document.getElementById('aiSave');
  var elCancel = document.getElementById('aiCancel');
  var elStatus = document.getElementById('aiStatus');

  /* ---------- 状态 ---------- */
  var state = load();
  var streaming = false;
  var abortCtl = null;

  function load() {
    var base = { provider: 'qwen', conf: {}, history: [] };
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return base;
      var d = JSON.parse(raw);
      if (d && typeof d === 'object') {
        base.provider = d.provider || base.provider;
        base.conf = d.conf && typeof d.conf === 'object' ? d.conf : {};
        base.history = Array.isArray(d.history) ? d.history.slice(-MAX_HISTORY) : [];
      }
    } catch (e) {
      /* 隐私模式或数据损坏，忽略 */
    }
    return base;
  }

  function save() {
    try {
      state.history = state.history.slice(-MAX_HISTORY);
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch (e) {
      /* 存不下就算了，不影响本次会话 */
    }
  }

  function provider(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === id) return PROVIDERS[i];
    }
    return PROVIDERS[0];
  }

  function conf(id) {
    if (!state.conf[id]) state.conf[id] = {};
    return state.conf[id];
  }

  /* 合并预设与用户覆盖 */
  function resolved(id) {
    var p = provider(id);
    var c = conf(id);
    return {
      id: p.id,
      name: p.name,
      base: (c.base || p.base || '').trim(),
      model: (c.model || p.model || '').trim(),
      key: (c.key || '').trim()
    };
  }

  function hasKey(id) {
    return !!resolved(id).key;
  }

  /* ---------- 视图 ---------- */
  function esc(s) {
    return String(s);
  }

  function nearBottom() {
    return elLog.scrollHeight - elLog.scrollTop - elLog.clientHeight < 60;
  }

  function scrollDown(force) {
    if (force || nearBottom()) {
      elLog.scrollTop = elLog.scrollHeight;
    }
  }

  function bubble(role, text) {
    var row = document.createElement('div');
    row.className = 'ai-msg ai-' + role;

    var who = document.createElement('span');
    who.className = 'ai-who';
    who.textContent = role === 'user' ? '我' : '岛语';

    var body = document.createElement('div');
    body.className = 'ai-bubble';
    body.textContent = text == null ? '' : esc(text);

    row.appendChild(who);
    row.appendChild(body);
    return { row: row, body: body };
  }

  function renderHistory() {
    elLog.textContent = '';
    for (var i = 0; i < state.history.length; i++) {
      var m = state.history[i];
      var b = bubble(m.role, m.content);
      elLog.appendChild(b.row);
    }
    updateEmpty();
    elLog.scrollTop = elLog.scrollHeight;
  }

  function updateEmpty() {
    if (!elEmpty) return;
    var blank = state.history.length === 0;
    elEmpty.hidden = !blank;
    if (elLog) elLog.hidden = blank;
    if (!blank) return;
    var cur = resolved(state.provider);
    elEmpty.innerHTML = '';
    var p1 = document.createElement('p');
    p1.className = 'ai-empty-title';
    p1.textContent = hasKey(state.provider) ? '说点什么吧' : '先把 ' + cur.name + ' 的密钥填上';
    var p2 = document.createElement('p');
    p2.className = 'ai-empty-sub';
    p2.textContent = hasKey(state.provider)
      ? '这里的对话只存在你这台浏览器里。'
      : '密钥只保存在本地，不会上传到任何服务器。';
    elEmpty.appendChild(p1);
    elEmpty.appendChild(p2);
    if (!hasKey(state.provider)) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-empty-btn';
      btn.textContent = '去设置';
      btn.addEventListener('click', openSettings);
      elEmpty.appendChild(btn);
    }
  }

  function setStatus(msg, kind) {
    if (!elStatus) return;
    elStatus.textContent = msg || '';
    elStatus.className = 'ai-status' + (kind ? ' is-' + kind : '');
    elStatus.hidden = !msg;
  }

  /* ---------- 设置面板 ---------- */
  function buildTabs() {
    elProviderTabs.textContent = '';
    PROVIDERS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-provider' + (p.id === state.provider ? ' is-active' : '');
      b.dataset.pid = p.id;
      b.textContent = p.name;
      if (hasKey(p.id)) {
        var dot = document.createElement('span');
        dot.className = 'ai-provider-dot';
        dot.title = '已配置';
        b.appendChild(dot);
      }
      b.addEventListener('click', function () {
        state.provider = p.id;
        save();
        buildTabs();
        fillForm();
        updateEmpty();
      });
      elProviderTabs.appendChild(b);
    });
  }

  function fillForm() {
    var p = provider(state.provider);
    var r = resolved(state.provider);
    elKey.value = r.key;
    elModel.value = r.model;
    elModel.placeholder = p.model || '模型名称';
    elBase.value = r.base;
    elBase.placeholder = p.base || 'https://…/v1';
    elNote.textContent = p.note;
    if (p.keyUrl) {
      elKeyUrl.href = p.keyUrl;
      elKeyUrl.hidden = false;
    } else {
      elKeyUrl.hidden = true;
    }
    setStatus('', '');
  }

  function openSettings() {
    elSettings.hidden = false;
    buildTabs();
    fillForm();
    elKey.focus();
  }

  function closeSettings() {
    elSettings.hidden = true;
  }

  elSettingsBtn.addEventListener('click', function () {
    if (elSettings.hidden) openSettings();
    else closeSettings();
  });

  elCancel.addEventListener('click', closeSettings);

  elSave.addEventListener('click', function () {
    var c = conf(state.provider);
    c.key = elKey.value.trim();
    c.model = elModel.value.trim();
    c.base = elBase.value.trim();
    save();
    buildTabs();
    updateEmpty();
    setStatus('已保存在这台浏览器上', 'ok');
    setTimeout(function () {
      closeSettings();
    }, 700);
  });

  /* ---------- 消息渲染 ---------- */
  function pushHistory(role, content) {
    state.history.push({ role: role, content: content, t: Date.now() });
  }

  /* ---------- 发送 ---------- */
  function apiUrl(base) {
    var b = base.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(b)) return b;
    return b + '/chat/completions';
  }

  function readableError(res) {
    return res
      .text()
      .then(function (t) {
        var msg = '';
        try {
          var j = JSON.parse(t);
          msg =
            (j.error && (j.error.message || j.error.code)) ||
            j.message ||
            (j.code ? j.code + (j.message ? '：' + j.message : '') : '');
        } catch (e) {
          msg = t;
        }
        return String(msg || '').trim().slice(0, 300);
      })
      .catch(function () {
        return '';
      });
  }

  function explain(err) {
    if (err && err.name === 'AbortError') return null;
    var m = String((err && err.message) || err || '');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
      return '连不上接口。可能是：密钥里多了空格、接口地址写错，或这个服务商不允许浏览器直连（跨域）。';
    }
    return m || '出了点问题';
  }

  function setBusy(on) {
    streaming = on;
    elSend.textContent = on ? '停止' : '发送';
    elSend.classList.toggle('is-stop', on);
    elInput.disabled = false;
  }

  function send() {
    if (streaming) {
      if (abortCtl) abortCtl.abort();
      return;
    }

    var text = elInput.value.trim();
    if (!text) return;

    var r = resolved(state.provider);
    if (!r.key) {
      openSettings();
      setStatus('先填 ' + r.name + ' 的 API Key', 'err');
      return;
    }
    if (!r.base) {
      openSettings();
      setStatus('还需要填接口地址', 'err');
      return;
    }
    if (!r.model) {
      openSettings();
      setStatus('还需要填模型名称', 'err');
      return;
    }

    elInput.value = '';
    autosize();

    var userBubble = bubble('user', text);
    elLog.appendChild(userBubble.row);
    pushHistory('user', text);
    save();
    updateEmpty();
    scrollDown(true);

    var replyBubble = bubble('assistant', '');
    replyBubble.body.classList.add('is-typing');
    elLog.appendChild(replyBubble.row);
    scrollDown(true);

    var acc = '';
    var ctl = new AbortController();
    abortCtl = ctl;
    setBusy(true);

    var timer = setTimeout(function () {
      ctl.abort();
    }, TIMEOUT);

    var msgs = [{ role: 'system', content: SYSTEM }].concat(
      state.history.slice(-20).map(function (m) {
        return { role: m.role, content: m.content };
      })
    );

    fetch(apiUrl(r.base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + r.key
      },
      body: JSON.stringify({
        model: r.model,
        messages: msgs,
        stream: true,
        temperature: 0.7
      }),
      signal: ctl.signal
    })
      .then(function (res) {
        if (!res.ok) {
          return readableError(res).then(function (msg) {
            throw new Error('HTTP ' + res.status + (msg ? '：' + msg : ''));
          });
        }
        if (!res.body || !res.body.getReader) {
          return res.json().then(function (j) {
            acc = pick(j);
            return acc;
          });
        }
        return readStream(res.body, function (delta) {
          acc += delta;
          replyBubble.body.textContent = acc;
          scrollDown();
        });
      })
      .then(function () {
        clearTimeout(timer);
        replyBubble.body.classList.remove('is-typing');
        if (acc.trim()) {
          pushHistory('assistant', acc);
          save();
        } else {
          replyBubble.body.textContent = '（没有返回内容）';
        }
        setBusy(false);
        abortCtl = null;
      })
      .catch(function (e) {
        clearTimeout(timer);
        replyBubble.body.classList.remove('is-typing');
        setBusy(false);
        abortCtl = null;
        var msg = explain(e);
        if (msg === null) {
          // 用户主动停止
          if (acc.trim()) {
            pushHistory('assistant', acc);
            save();
          } else {
            replyBubble.row.remove();
          }
          return;
        }
        replyBubble.body.textContent = '出错了：' + msg;
        replyBubble.body.classList.add('is-error');
      });
  }

  function pick(j) {
    try {
      return j.choices[0].message.content || '';
    } catch (e) {
      return '';
    }
  }

  /* 逐块读取 SSE */
  function readStream(body, onDelta) {
    var reader = body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buf = '';

    function pump() {
      return reader.read().then(function (res) {
        if (res.done) {
          flush();
          return;
        }
        buf += decoder.decode(res.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          handleLine(lines[i]);
        }
        return pump();
      });
    }

    function handleLine(line) {
      var t = line.replace(/\r$/, '').trim();
      if (!t || t.charAt(0) === ':') return;
      if (t.indexOf('data:') !== 0) return;
      var payload = t.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        var j = JSON.parse(payload);
        var d = j.choices && j.choices[0];
        if (!d) return;
        var piece =
          (d.delta && d.delta.content) ||
          (d.message && d.message.content) ||
          '';
        if (piece) onDelta(piece);
      } catch (e) {
        /* 半截 JSON，忽略 */
      }
    }

    function flush() {
      if (buf) handleLine(buf);
      buf = '';
    }

    return pump();
  }

  /* ---------- 输入框 ---------- */
  function autosize() {
    if (!elInput.value) {
      elInput.style.height = '42px';
      return;
    }
    elInput.style.height = 'auto';
    elInput.style.height = Math.min(elInput.scrollHeight, 132) + 'px';
  }

  elInput.addEventListener('input', autosize);

  elInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return; // 中文输入法选词中
    if (e.shiftKey) return;
    e.preventDefault();
    send();
  });

  elForm.addEventListener('submit', function (e) {
    e.preventDefault();
    send();
  });

  elSend.addEventListener('click', function (e) {
    if (elSend.type === 'button' || streaming) {
      e.preventDefault();
      send();
    }
  });

  elClearBtn.addEventListener('click', function () {
    state.history = [];
    save();
    renderHistory();
    setStatus('已清空', 'ok');
    setTimeout(function () {
      setStatus('', '');
    }, 1200);
  });

  /* ---------- 启动 ---------- */
  renderHistory();
  autosize();
  if (!hasKey(state.provider)) {
    setStatus('');
  }
})();
