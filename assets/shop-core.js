/**
 * 慢岛 · 点单核心数据层
 *
 * 这一层负责所有业务逻辑：菜单、购物车、订单、取餐号、会员。
 * 页面只调这里的方法，不直接碰 localStorage，也不直接算钱。
 *
 * 设计原则（沿用小程序那套）：
 *   1. 金额一律用「分」存，显示时才换元，避免浮点误差
 *   2. 商品价格来自菜单，购物车只记 goodsId + qty
 *   3. 订单状态只能按 STATE_FLOW 规定的路径走，不能随便跳
 *
 * 后端：
 *   backend = 'local'     数据在本机 localStorage，单台设备可用
 *   backend = 'cloudbase' 数据在腾讯云开发（见 MIAOMIAO-WEB.md）
 */
(function (global) {
  'use strict';

  var CFG = global.MANDAO_SHOP_CONFIG || {};
  var BACKEND = CFG.backend === 'cloudbase' ? 'cloudbase' : 'local';

  /* ============================================================
     存储
     ============================================================ */

  var K = {
    goods: 'mandao_goods_v1',
    cart: 'mandao_cart_v1',
    orders: 'mandao_orders_v1',
    counter: 'mandao_counter_v1',
    member: 'mandao_member_v1',
    session: 'mandao_session_v1',
    admin: 'mandao_admin_v1'
  };

  function read(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // 存储满了或被禁用时不影响页面运行
    }
    return value;
  }

  /* ============================================================
     工具
     ============================================================ */

  function pad(n, len) {
    var s = String(n);
    while (s.length < (len || 2)) s = '0' + s;
    return s;
  }

  /** 分 -> 元，去掉无意义的 .00：1200 -> '12'，1250 -> '12.50' */
  function fen2yuan(fen) {
    var n = Math.round(Number(fen) || 0);
    var y = n / 100;
    return y % 1 === 0 ? String(y) : y.toFixed(2);
  }

  /** 元 -> 分 */
  function yuan2fen(yuan) {
    return Math.round((Number(yuan) || 0) * 100);
  }

  function dayKey(d) {
    var t = d || new Date();
    return String(t.getFullYear()) + pad(t.getMonth() + 1) + pad(t.getDate());
  }

  /** 11-26 14:05 */
  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 14:05 */
  function formatClock(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 刚刚 / 3 分钟前 / 11-26 14:05 */
  function fromNow(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    return formatTime(ts);
  }

  /** 2026-11-26 */
  function formatDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) +
           Math.random().toString(36).slice(2, 6);
  }

  /* ============================================================
     菜单（种子数据，来自小程序 cloudfunctions/initShop/seed.js）
     ============================================================ */

  var SEED_CATEGORIES = [
    { _id: 'signature', name: '招牌甜品', sort: 1 },
    { _id: 'snack', name: '现烤小食', sort: 2 },
    { _id: 'drink', name: '咖啡茶饮', sort: 3 },
    { _id: 'combo', name: '超值套餐', sort: 4 }
  ];

  var SEED_GOODS = [
    { _id: 'g_durian', categoryId: 'signature', name: '榴莲千层', desc: '猫山王果肉 · 8 层薄饼 · 冷藏 2 小时', price: 2800, emoji: '🍰', tag: '招牌', stock: 30, sold: 328, onSale: true, sort: 1 },
    { _id: 'g_tiramisu', categoryId: 'signature', name: '提拉米苏', desc: '马斯卡彭芝士 · 咖啡酒香 · 撒可可粉', price: 2600, emoji: '🍮', tag: '', stock: 24, sold: 210, onSale: true, sort: 2 },
    { _id: 'g_cheese', categoryId: 'signature', name: '半熟芝士', desc: '北海道芝士 · 入口即化 · 建议冷藏即食', price: 2400, emoji: '🧁', tag: '', stock: 18, sold: 176, onSale: true, sort: 3 },
    { _id: 'g_mango', categoryId: 'signature', name: '芒果班戟', desc: '当季大芒果 · 淡奶油轻盈不腻', price: 1800, emoji: '🥭', tag: '当季', stock: 12, sold: 268, onSale: true, sort: 4 },
    { _id: 'g_tart', categoryId: 'snack', name: '葡式蛋挞（2 只）', desc: '现烤酥皮 · 焦糖脆面 · 出炉即食', price: 1200, emoji: '🥧', tag: '热销', stock: 40, sold: 512, onSale: true, sort: 5 },
    { _id: 'g_puff', categoryId: 'snack', name: '蝴蝶酥（6 片）', desc: '黄油千层 · 微微咸香 · 佐咖啡很搭', price: 1200, emoji: '🥐', tag: '', stock: 26, sold: 143, onSale: true, sort: 6 },
    { _id: 'g_cookie', categoryId: 'snack', name: '手作曲奇礼盒', desc: '混合四味 · 铁盒装 · 送人体面', price: 3800, emoji: '🍪', tag: '礼盒', stock: 9, sold: 66, onSale: true, sort: 7 },
    { _id: 'g_americano', categoryId: 'drink', name: '冰美式', desc: '中深烘豆 · 冰镇清爽 · 解腻首选', price: 1500, emoji: '☕', tag: '', stock: 50, sold: 231, onSale: true, sort: 8 },
    { _id: 'g_latte', categoryId: 'drink', name: '燕麦拿铁', desc: '燕麦奶 · 绵密奶泡 · 可选冰/热', price: 1800, emoji: '🥛', tag: '', stock: 50, sold: 189, onSale: true, sort: 9 },
    { _id: 'g_grape', categoryId: 'drink', name: '青提气泡', desc: '新鲜阳光玫瑰 · 苏打气泡水', price: 2000, emoji: '🍹', tag: '新品', stock: 30, sold: 97, onSale: true, sort: 10 },
    { _id: 'g_jasmine', categoryId: 'drink', name: '茉莉冷萃', desc: '冷萃 12 小时 · 茉莉花香回甘', price: 2200, emoji: '🍵', tag: '', stock: 25, sold: 58, onSale: true, sort: 11 },
    { _id: 'g_combo2', categoryId: 'combo', name: '双人下午茶套餐', desc: '任选甜品 2 份 + 饮品 2 杯，到店堂食更划算', price: 6800, emoji: '🎁', tag: '省 20 元', stock: 15, sold: 42, onSale: true, sort: 12 },
    { _id: 'g_combo1', categoryId: 'combo', name: '单人轻享套餐', desc: '甜品 1 份 + 饮品 1 杯，一个人也要甜甜的', price: 3600, emoji: '🎁', tag: '省 7 元', stock: 20, sold: 88, onSale: true, sort: 13 }
  ];

  function ensureSeed() {
    var list = read(K.goods, null);
    if (!list) write(K.goods, SEED_GOODS);
  }

  /* ============================================================
     店铺
     ============================================================ */

  function getShop() {
    var s = CFG.shop || {};
    return {
      name: s.name || '慢岛',
      slogan: s.slogan || '',
      openTime: s.openTime || '',
      address: s.address || '',
      tel: s.tel || '',
      notice: s.notice || ''
    };
  }

  function getCategories() {
    return SEED_CATEGORIES.slice();
  }

  /* ============================================================
     商品
     ============================================================ */

  function decorateGoods(g) {
    var stock = Number(g.stock) || 0;
    return {
      _id: g._id,
      categoryId: g.categoryId,
      name: g.name,
      desc: g.desc || '',
      price: g.price,
      priceText: fen2yuan(g.price),
      emoji: g.emoji || '🍽',
      tag: g.tag || '',
      stock: stock,
      sold: Number(g.sold) || 0,
      soldText: Number(g.sold) > 0 ? '已售 ' + g.sold : '',
      onSale: !!g.onSale,
      sort: Number(g.sort) || 0,
      soldOut: stock <= 0
    };
  }

  /**
   * 菜单列表
   * opts.includeOffSale：连下架的一起返回（店家管理用）
   */
  function getGoods(opts) {
    ensureSeed();
    var o = opts || {};
    var list = read(K.goods, []).slice();
    list.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    if (!o.includeOffSale) {
      list = list.filter(function (g) { return g.onSale; });
    }
    return list.map(decorateGoods);
  }

  function findGoods(id) {
    var list = read(K.goods, []);
    for (var i = 0; i < list.length; i++) {
      if (list[i]._id === id) return list[i];
    }
    return null;
  }

  /** 改库存（下单 / 取消退库存） */
  function bumpStock(id, stockDelta, soldDelta) {
    var list = read(K.goods, []);
    for (var i = 0; i < list.length; i++) {
      if (list[i]._id === id) {
        list[i].stock = Math.max(0, (Number(list[i].stock) || 0) + stockDelta);
        list[i].sold = Math.max(0, (Number(list[i].sold) || 0) + (soldDelta || 0));
        break;
      }
    }
    write(K.goods, list);
  }

  /* ============================================================
     购物车
     ============================================================ */

  function cartList() {
    return read(K.cart, []);
  }

  /** { goodsId: qty }，菜单页标数量用 */
  function cartMap() {
    var map = {};
    cartList().forEach(function (i) { map[i.goodsId] = i.qty; });
    return map;
  }

  /**
   * 加/减一份
   * 返回 { ok: true, qty } 或 { ok: false, msg }
   */
  function cartAdd(goodsId, delta) {
    var goods = findGoods(goodsId);
    if (!goods) return { ok: false, msg: '这道甜点已经没有了' };
    if (!goods.onSale) return { ok: false, msg: goods.name + ' 已下架' };

    var items = cartList();
    var index = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].goodsId === goodsId) { index = i; break; }
    }
    var current = index > -1 ? items[index].qty : 0;
    var next = current + (delta || 1);
    var stock = Number(goods.stock) || 0;

    if (next <= 0) {
      if (index > -1) items.splice(index, 1);
      write(K.cart, items);
      return { ok: true, qty: 0 };
    }
    if (next > stock) {
      return { ok: false, msg: goods.name + ' 只剩 ' + stock + ' 份' };
    }

    if (index > -1) {
      items[index].qty = next;
      // 顺手同步快照，避免店家改价后购物车显示旧价
      items[index].name = goods.name;
      items[index].price = goods.price;
      items[index].emoji = goods.emoji;
      items[index].stock = stock;
    } else {
      items.push({
        goodsId: goodsId,
        name: goods.name,
        price: goods.price,
        emoji: goods.emoji,
        stock: stock,
        qty: next
      });
    }
    write(K.cart, items);
    return { ok: true, qty: next };
  }

  function cartSetQty(goodsId, qty) {
    var items = cartList();
    var index = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].goodsId === goodsId) { index = i; break; }
    }
    if (index < 0) return;
    if (qty <= 0) {
      items.splice(index, 1);
    } else {
      var stock = Number(items[index].stock) || 0;
      items[index].qty = stock > 0 && qty > stock ? stock : qty;
    }
    write(K.cart, items);
  }

  function cartRemove(goodsId) {
    write(K.cart, cartList().filter(function (i) { return i.goodsId !== goodsId; }));
  }

  function cartClear() {
    write(K.cart, []);
  }

  /** 结算栏 / 确认页用 */
  function cartSummary() {
    var items = cartList().map(function (item) {
      var amount = item.price * item.qty;
      return {
        goodsId: item.goodsId,
        name: item.name,
        emoji: item.emoji,
        price: item.price,
        qty: item.qty,
        stock: item.stock,
        priceText: fen2yuan(item.price),
        amount: amount,
        amountText: fen2yuan(amount)
      };
    });
    var count = 0, total = 0;
    items.forEach(function (i) { count += i.qty; total += i.amount; });
    return { items: items, count: count, total: total, totalText: fen2yuan(total) };
  }

  /* ============================================================
     订单
     ============================================================ */

  var STATUS_TEXT = {
    unpaid: '待支付',
    claimed: '待确认',
    pending: '待接单',
    accepted: '制作中',
    ready: '待取餐',
    done: '已完成',
    cancelled: '已取消'
  };

  var STATUS_HINT = {
    unpaid: '订单已生成，付款并填写单号后，店家确认就会开始准备',
    claimed: '付款单号已提交，店家核对到账后开始制作',
    pending: '已收款，等待店家接单',
    accepted: '店家已接单，正在为你现做',
    ready: '甜点已备好，请凭取餐码到吧台取餐',
    done: '订单已完成，感谢光临',
    cancelled: '订单已取消'
  };

  /** 制作进度条上显示的四个状态 */
  var FLOW = ['pending', 'accepted', 'ready', 'done'];

  /** 允许的状态流转：from -> [可去的 to] */
  var TRANSITIONS = {
    unpaid: ['claimed', 'cancelled'],
    claimed: ['pending', 'cancelled'],
    pending: ['accepted', 'cancelled'],
    accepted: ['ready'],
    ready: ['done']
  };

  function canTransition(from, to) {
    var list = TRANSITIONS[from] || [];
    return list.indexOf(to) > -1;
  }

  /** 当日取餐号，按天重置 */
  function nextPickNo() {
    var today = dayKey(new Date());
    var c = read(K.counter, null);
    if (!c || c.day !== today) {
      c = { day: today, pick: 0, seq: 0 };
    }
    c.pick += 1;
    c.seq += 1;
    write(K.counter, c);
    return { pick: c.pick, seq: c.seq, day: today };
  }

  function buildOrderNo(day, seq) {
    return 'MD' + day.slice(2) + '-' + pad(seq, 4);
  }

  /**
   * 下单
   * payload: { mode: 'pickup'|'dinein', tableNo, remark }
   * 返回 { ok: true, order } 或 { ok: false, msg }
   *
   * 注意：金额在这里重新按菜单算，不信任购物车里存的价格。
   */
  function createOrder(payload) {
    var p = payload || {};
    var summary = cartSummary();
    if (!summary.count) return { ok: false, msg: '购物车是空的' };

    var mode = p.mode === 'dinein' ? 'dinein' : 'pickup';
    var tableNo = String(p.tableNo || '').trim().slice(0, 20);
    var remark = String(p.remark || '').trim().slice(0, 100);
    if (mode === 'dinein' && !tableNo) return { ok: false, msg: '请先填写桌号' };

    // 先整体校验库存，任何一项不够就整单不成立，避免扣了一半
    var items = [], total = 0;
    for (var i = 0; i < summary.items.length; i++) {
      var it = summary.items[i];
      var goods = findGoods(it.goodsId);
      if (!goods) return { ok: false, msg: it.name + ' 已经下架了，请返回菜单刷新' };
      if (!goods.onSale) return { ok: false, msg: goods.name + ' 已下架' };
      if ((Number(goods.stock) || 0) < it.qty) {
        return { ok: false, msg: goods.name + ' 库存不足，只剩 ' + goods.stock + ' 份' };
      }
      var amount = goods.price * it.qty;
      total += amount;
      items.push({
        goodsId: goods._id,
        name: goods.name,
        emoji: goods.emoji,
        price: goods.price,
        qty: it.qty,
        amount: amount
      });
    }

    var now = Date.now();
    var no = nextPickNo();
    var order = {
      _id: uid('o'),
      orderNo: buildOrderNo(no.day, no.seq),
      pickNo: no.pick,
      status: 'unpaid',
      payStatus: 'unpaid',
      payProof: '',
      mode: mode,
      tableNo: tableNo,
      remark: remark,
      items: items,
      total: total,
      createdAt: now,
      updatedAt: now,
      paidAt: 0,
      timeline: [{ status: 'unpaid', at: now }]
    };

    // 库存落账
    items.forEach(function (it) { bumpStock(it.goodsId, -it.qty, it.qty); });

    var orders = read(K.orders, []);
    orders.unshift(order);
    write(K.orders, orders);
    cartClear();

    return { ok: true, order: decorateOrder(order) };
  }

  function decorateOrder(order) {
    if (!order) return null;
    var currentIndex = FLOW.indexOf(order.status);
    var progress = FLOW.map(function (status, index) {
      var hit = null;
      (order.timeline || []).forEach(function (t) {
        if (t.status === status) hit = t;
      });
      return {
        status: status,
        text: STATUS_TEXT[status],
        done: currentIndex >= index && order.status !== 'cancelled',
        at: hit ? formatClock(hit.at) : ''
      };
    });

    var items = (order.items || []).map(function (i) {
      return {
        goodsId: i.goodsId,
        name: i.name,
        emoji: i.emoji,
        price: i.price,
        qty: i.qty,
        priceText: fen2yuan(i.price),
        amount: i.amount,
        amountText: fen2yuan(i.amount)
      };
    });

    var count = 0;
    items.forEach(function (i) { count += i.qty; });

    return {
      _id: order._id,
      orderNo: order.orderNo,
      pickNo: order.pickNo,
      status: order.status,
      payStatus: order.payStatus,
      payProof: order.payProof || '',
      mode: order.mode,
      tableNo: order.tableNo,
      remark: order.remark,
      items: items,
      total: order.total,
      totalText: fen2yuan(order.total),
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      timeline: order.timeline || [],
      statusText: STATUS_TEXT[order.status] || order.status,
      statusHint: STATUS_HINT[order.status] || '',
      timeText: formatTime(order.createdAt),
      fromNowText: fromNow(order.createdAt),
      itemCount: count,
      itemsSummary: items.map(function (i) { return i.name + ' ×' + i.qty; }).join('、'),
      modeText: order.mode === 'dinein'
        ? '堂食 · ' + (order.tableNo || '未填桌号')
        : '到店自取',
      progress: progress,
      canPay: order.status === 'unpaid',
      canCancel: order.status === 'unpaid' || order.status === 'claimed',
      isFinished: order.status === 'done' || order.status === 'cancelled',
      // 店家确认台用
      waitingConfirm: order.status === 'claimed',
      waitingAccept: order.status === 'pending'
    };
  }

  function allOrders() {
    return read(K.orders, []);
  }

  function getOrder(id) {
    var list = allOrders();
    for (var i = 0; i < list.length; i++) {
      if (list[i]._id === id) return decorateOrder(list[i]);
    }
    return null;
  }

  /**
   * 订单列表
   * filter: 'active' 进行中 / 'done' 已结束 / 'all'
   */
  function listOrders(filter) {
    var list = allOrders();
    var activeSet = ['unpaid', 'claimed', 'pending', 'accepted', 'ready'];

    if (filter === 'active') {
      list = list.filter(function (o) { return activeSet.indexOf(o.status) > -1; });
    } else if (filter === 'done') {
      list = list.filter(function (o) { return ['done', 'cancelled'].indexOf(o.status) > -1; });
    }

    list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return list.map(decorateOrder);
  }

  /** 顾客填付款单号 -> 订单进入「待确认」 */
  function claimPaid(orderId, proof) {
    var text = String(proof || '').trim();
    var max = (CFG.pay && CFG.pay.proofMax) || 40;
    if (text.length < 4) return { ok: false, msg: '请填写完整的付款单号' };
    if (text.length > max) return { ok: false, msg: '单号太长了，请只填交易单号' };

    var list = allOrders();
    for (var i = 0; i < list.length; i++) {
      if (list[i]._id !== orderId) continue;
      if (!canTransition(list[i].status, 'claimed')) {
        return { ok: false, msg: '这个订单现在不能提交付款信息了' };
      }
      var now = Date.now();
      list[i].status = 'claimed';
      list[i].payProof = text;
      list[i].payClaimedAt = now;
      list[i].updatedAt = now;
      list[i].timeline.push({ status: 'claimed', at: now });
      write(K.orders, list);
      return { ok: true, order: decorateOrder(list[i]) };
    }
    return { ok: false, msg: '没找到这个订单' };
  }

  /** 店家确认收款：claimed -> pending */
  function confirmPayment(orderId) {
    return setStatus(orderId, 'pending', 'admin');
  }

  /**
   * 状态流转
   * 取消时会退回库存；已收款的单退款这件事本地做不了，只是标记。
   */
  function setStatus(orderId, next, by) {
    var list = allOrders();
    for (var i = 0; i < list.length; i++) {
      var order = list[i];
      if (order._id !== orderId) continue;

      if (!canTransition(order.status, next)) {
        return { ok: false, msg: '「' + (STATUS_TEXT[order.status] || order.status) +
                                '」不能再变成「' + (STATUS_TEXT[next] || next) + '」' };
      }

      var now = Date.now();
      order.status = next;
      order.updatedAt = now;
      order.timeline.push({ status: next, at: now });

      if (next === 'pending') {
        order.payStatus = 'paid';
        order.paidAt = now;
      }
      if (next === 'cancelled') {
        (order.items || []).forEach(function (it) {
          bumpStock(it.goodsId, it.qty, -it.qty);
        });
        if (order.payStatus === 'paid') {
          // 本地模式没有支付通道，退款只能在线下处理，这里如实标记
          order.payStatus = 'refund_pending';
        }
      }

      write(K.orders, list);
      return { ok: true, order: decorateOrder(order) };
    }
    return { ok: false, msg: '没找到这个订单' };
  }

  /** 店家统计（今天卖了多少） */
  function todayStats() {
    var start = new Date();
    start.setHours(0, 0, 0, 0);
    var since = start.getTime();

    var count = 0, amount = 0, doneCount = 0, waiting = 0, pending = 0;
    allOrders().forEach(function (o) {
      if (o.status === 'claimed') waiting += 1;
      if (o.status === 'pending') pending += 1;
      // 营收只算已经确认收款的单：未付款、待确认的都不算
      if (o.payStatus !== 'paid') return;
      if ((o.createdAt || 0) < since) return;
      if (o.status === 'cancelled') return;
      amount += o.total || 0;
      count += 1;
      if (o.status === 'done') doneCount += 1;
    });

    return {
      count: count,
      amount: amount,
      amountText: fen2yuan(amount),
      doneCount: doneCount,
      waitingConfirm: waiting,
      waitingAccept: pending
    };
  }

  /* ============================================================
     会员
     ============================================================ */

  function memberCfg() {
    var m = CFG.member || {};
    return {
      price: Number(m.price) || 100,
      days: Number(m.days) || 365,
      qr: m.qr || (CFG.pay && CFG.pay.qr) || '',
      perks: Array.isArray(m.perks) ? m.perks : []
    };
  }

  function getSession() {
    return read(K.session, null);
  }

  /** 本地登录：手机号 + 称呼。云端模式后换成真实登录 */
  function signIn(phone, name) {
    var p = String(phone || '').trim();
    if (!/^1[3-9]\d{9}$/.test(p)) return { ok: false, msg: '请填写 11 位手机号' };
    var n = String(name || '').trim().slice(0, 12);
    var session = { phone: p, name: n || ('岛民' + p.slice(-4)), at: Date.now() };
    write(K.session, session);
    return { ok: true, session: session };
  }

  function signOut() {
    try { global.localStorage.removeItem(K.session); } catch (e) {}
  }

  /**
   * 会员状态
   * 返回 { status, active, daysLeft, expiresAtText, ... }
   * status: none 未开通 / pending 待确认 / active 生效中 / expired 已过期
   */
  function getMember() {
    var m = read(K.member, null);
    var cfg = memberCfg();
    if (!m) {
      return {
        status: 'none', active: false, price: cfg.price, days: cfg.days,
        expiresAtText: '', daysLeft: 0, proof: '', phone: ''
      };
    }
    var active = m.status === 'active' && m.expiresAt > Date.now();
    var status = m.status === 'active' ? (active ? 'active' : 'expired') : m.status;
    var daysLeft = active ? Math.ceil((m.expiresAt - Date.now()) / 86400000) : 0;

    return {
      status: status,
      active: active,
      price: cfg.price,
      days: cfg.days,
      phone: m.phone || '',
      name: m.name || '',
      proof: m.proof || '',
      appliedAt: m.appliedAt || 0,
      activatedAt: m.activatedAt || 0,
      expiresAt: m.expiresAt || 0,
      expiresAtText: m.expiresAt ? formatDate(m.expiresAt) : '',
      daysLeft: daysLeft
    };
  }

  /** 提交会员申请（填了付款单号） */
  function applyMember(proof) {
    var session = getSession();
    if (!session) return { ok: false, msg: '请先登录' };

    var text = String(proof || '').trim();
    var max = (CFG.pay && CFG.pay.proofMax) || 40;
    if (text.length < 4) return { ok: false, msg: '请填写完整的付款单号' };
    if (text.length > max) return { ok: false, msg: '单号太长了，请只填交易单号' };

    var m = read(K.member, null);
    if (m && m.status === 'pending') return { ok: false, msg: '申请已经提交了，等店家确认就好' };
    if (m && m.status === 'active' && m.expiresAt > Date.now()) {
      return { ok: false, msg: '会员还在有效期内' };
    }

    var now = Date.now();
    write(K.member, {
      phone: session.phone,
      name: session.name,
      status: 'pending',
      proof: text,
      appliedAt: now
    });
    return { ok: true };
  }

  /** 店家确认会员费到账 -> 生效 */
  function activateMember() {
    var m = read(K.member, null);
    if (!m) return { ok: false, msg: '没有待开通的申请' };
    if (m.status !== 'pending') return { ok: false, msg: '这条申请已经处理过了' };

    var cfg = memberCfg();
    var now = Date.now();
    m.status = 'active';
    m.activatedAt = now;
    m.expiresAt = now + cfg.days * 86400000;
    write(K.member, m);
    return { ok: true, member: getMember() };
  }

  function rejectMember() {
    var m = read(K.member, null);
    if (!m || m.status !== 'pending') return { ok: false, msg: '没有待处理的申请' };
    try { global.localStorage.removeItem(K.member); } catch (e) {}
    return { ok: true };
  }

  /* ============================================================
     店家口令
     ============================================================ */

  function isAdminUnlocked() {
    return read(K.admin, false) === true;
  }

  function unlockAdmin(pin) {
    var expect = String((CFG.admin && CFG.admin.pin) || '');
    if (String(pin || '').trim() !== expect) {
      return { ok: false, msg: '口令不对' };
    }
    write(K.admin, true);
    return { ok: true };
  }

  function lockAdmin() {
    try { global.localStorage.removeItem(K.admin); } catch (e) {}
  }

  /* ============================================================
     导出
     ============================================================ */

  global.MandaoShop = {
    backend: BACKEND,
    config: CFG,

    // 工具
    fen2yuan: fen2yuan,
    yuan2fen: yuan2fen,
    formatTime: formatTime,
    formatClock: formatClock,
    formatDate: formatDate,
    fromNow: fromNow,

    // 店铺 / 菜单
    getShop: getShop,
    getCategories: getCategories,
    getGoods: getGoods,
    findGoods: findGoods,

    // 购物车
    cartList: cartList,
    cartMap: cartMap,
    cartAdd: cartAdd,
    cartSetQty: cartSetQty,
    cartRemove: cartRemove,
    cartClear: cartClear,
    cartSummary: cartSummary,

    // 订单
    STATUS_TEXT: STATUS_TEXT,
    STATUS_HINT: STATUS_HINT,
    createOrder: createOrder,
    getOrder: getOrder,
    listOrders: listOrders,
    claimPaid: claimPaid,
    confirmPayment: confirmPayment,
    setStatus: setStatus,
    todayStats: todayStats,

    // 会员
    memberCfg: memberCfg,
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    getMember: getMember,
    applyMember: applyMember,
    activateMember: activateMember,
    rejectMember: rejectMember,

    // 店家
    isAdminUnlocked: isAdminUnlocked,
    unlockAdmin: unlockAdmin,
    lockAdmin: lockAdmin
  };

})(window);
