/**
 * 慢岛 · 收款码组件
 *
 * 点单页和会员页共用。做三件事：
 *   1. 渲染「微信支付 / 支付宝」切换 + 对应收款码
 *   2. 记住顾客上次选的支付方式
 *   3. 把金额写大、提醒手动输入（个人静态码带不了金额）
 *
 * 用法：
 *   el.innerHTML = MandaoPay.blockHtml('100');
 *   MandaoPay.bind(el);
 */
(function (global) {
  'use strict';

  var CFG = global.MANDAO_SHOP_CONFIG || {};
  var KEY = 'mandao_pay_method_v1';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 可用的支付方式 */
  function methods() {
    var p = CFG.pay || {};
    var list = [];

    if (Array.isArray(p.methods)) {
      list = p.methods.filter(function (m) {
        return m && m.id && m.name && m.qr;
      });
    }

    // 兼容老配置：只有一张 qr
    if (!list.length && p.qr) {
      list = [{ id: 'default', name: '扫码支付', qr: p.qr, payee: '', hint: '扫一扫付款' }];
    }

    return list;
  }

  function findById(id) {
    var list = methods();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /** 当前选中的一种（优先上次选的，其次配置里的 default） */
  function current() {
    var list = methods();
    if (!list.length) return null;

    var saved = null;
    try { saved = global.localStorage.getItem(KEY); } catch (e) {}

    if (saved && findById(saved)) return findById(saved);

    var def = (CFG.pay && CFG.pay['default']) || list[0].id;
    return findById(def) || list[0];
  }

  function remember(id) {
    try { global.localStorage.setItem(KEY, id); } catch (e) {}
  }

  /**
   * 渲染收款区块
   * amountText：要显示的金额文字，比如 '100' 或 '56'
   */
  function blockHtml(amountText) {
    var list = methods();
    var cur = current();

    if (!cur) {
      return '<div class="pay-block">' +
        '<div class="pay-qr-empty">收款码还没设置<br>' +
        '把微信/支付宝收款码图片放到 assets/ 下，<br>' +
        '再在 shop-config.js 的 pay.methods 里填上文件名</div>' +
      '</div>';
    }

    var switcher = list.length > 1
      ? '<div class="pay-methods" role="radiogroup" aria-label="选择支付方式">' +
          list.map(function (m) {
            var on = m.id === cur.id;
            return '<button class="pay-method' + (on ? ' is-on' : '') +
              '" type="button" role="radio" aria-checked="' + on +
              '" data-method="' + esc(m.id) + '">' + esc(m.name) + '</button>';
          }).join('') +
        '</div>'
      : '<div class="pay-methods is-single"><span class="pay-method is-on">' +
          esc(cur.name) + '</span></div>';

    return '<div class="pay-block">' +
      switcher +
      '<img class="pay-qr" src="' + esc(cur.qr) + '" alt="' + esc(cur.name) + '收款码">' +
      '<div class="pay-amount">¥' + esc(amountText) + '</div>' +
      '<p class="pay-caption">扫码后请<strong>手动输入 ' + esc(amountText) + ' 元</strong>' +
        '，个人收款码不会自动带金额。</p>' +
      '<p class="pay-payee" data-payee="1">' +
        (cur.payee ? '转给' + esc(cur.payee) : '') +
      '</p>' +
      '<p class="pay-mobile-tip">手机上没法扫自己屏幕——' +
        '长按上面的二维码保存到相册，再打开微信或支付宝的' +
        '「扫一扫 → 相册」识别。店里平板上直接扫更方便。' +
      '</p>' +
    '</div>';
  }

  /** 绑定切换事件。root 是包含上面 html 的容器 */
  function bind(root) {
    var box = root || document;
    var buttons = box.querySelectorAll('[data-method]');

    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-method');
        var m = findById(id);
        if (!m) return;

        remember(id);

        Array.prototype.forEach.call(buttons, function (b) {
          var on = b === btn;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });

        var img = box.querySelector('.pay-qr');
        if (img) {
          img.src = m.qr;
          img.alt = m.name + '收款码';
        }

        var payee = box.querySelector('[data-payee]');
        if (payee) payee.textContent = m.payee ? '转给' + m.payee : '';
      });
    });
  }

  global.MandaoPay = {
    methods: methods,
    current: current,
    blockHtml: blockHtml,
    bind: bind
  };

})(window);
