/**
 * 抓取多平台热搜，生成 assets/hot-boards.js
 * 用法：node tools/fetch-boards.mjs
 *
 * 只抓公开接口，结果存成静态文件供浏览器读取（浏览器直接请求会被 CORS 挡住）。
 * 任一平台失败不影响其它平台，失败的会沿用上一次的数据。
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const OUT = 'assets/hot-boards.js';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getJson(url, referer, timeout = 20000) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: referer,
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ---------- 各平台抓取器：统一返回 [{title, url, hot}] ----------

async function fetchBaidu() {
  const j = await getJson('https://top.baidu.com/api/board?platform=wise&tab=realtime', 'https://top.baidu.com/');
  const list = j?.data?.cards?.[0]?.content?.[0]?.content || [];
  return list
    .filter((x) => x.word && x.url)
    .map((x) => ({ title: x.word, url: x.url, hot: x.hotScore ? String(x.hotScore) : '' }));
}

async function fetchWeibo() {
  const j = await getJson('https://weibo.com/ajax/statuses/hot_band', 'https://weibo.com/');
  const list = j?.data?.band_list || [];
  return list
    .filter((x) => x.word)
    .map((x) => {
      const word = x.word;
      // 话题类用 word_scheme（带 #），普通词用搜索链接
      const q = x.word_scheme || word;
      return {
        title: word,
        url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(q),
        hot: x.num ? formatNum(x.num) : '',
      };
    });
}

async function fetchZhihu() {
  const j = await getJson('https://api.zhihu.com/topstory/hot-list?limit=50', 'https://www.zhihu.com/');
  const list = j?.data || [];
  return list
    .filter((x) => x.target?.title)
    .map((x) => {
      const t = x.target;
      const id = t.id;
      const url =
        t.type === 'question'
          ? 'https://www.zhihu.com/question/' + id
          : t.url || 'https://www.zhihu.com/hot';
      return { title: t.title, url, hot: t.detail_text || '' };
    });
}

async function fetchBilibili() {
  const j = await getJson(
    'https://app.bilibili.com/x/v2/search/trending/ranking?limit=50',
    'https://www.bilibili.com/'
  );
  const list = j?.data?.list || [];
  return list
    .filter((x) => x.keyword)
    .map((x) => ({
      title: x.show_name || x.keyword,
      url: 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(x.keyword),
      hot: '',
    }));
}

async function fetchToutiao() {
  const j = await getJson(
    'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
    'https://www.toutiao.com/'
  );
  const list = j?.data || [];
  return list
    .filter((x) => x.Title)
    .map((x) => ({
      title: x.Title,
      url: x.Url || 'https://www.toutiao.com/',
      hot: x.HotValue ? formatNum(x.HotValue) : '',
    }));
}

function formatNum(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '';
  if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿';
  if (v >= 10000) return (v / 10000).toFixed(1) + '万';
  return String(v);
}

// ---------- 平台定义 ----------
const BOARDS = [
  { id: 'baidu', name: '百度', color: '#2932E1', fn: fetchBaidu, max: 30 },
  { id: 'weibo', name: '微博', color: '#E6162D', fn: fetchWeibo, max: 30 },
  { id: 'zhihu', name: '知乎', color: '#0084FF', fn: fetchZhihu, max: 30 },
  { id: 'bilibili', name: 'B站', color: '#00A1D6', fn: fetchBilibili, max: 30 },
  { id: 'toutiao', name: '头条', color: '#F04142', fn: fetchToutiao, max: 30 },
];

// ---------- 读取旧数据（用于失败时回退） ----------
let old = {};
if (existsSync(OUT)) {
  try {
    const txt = readFileSync(OUT, 'utf8');
    const m = txt.match(/window\.HOT_BOARDS\s*=\s*([\s\S]+?);?\s*$/);
    if (m) old = JSON.parse(m[1]);
  } catch {
    /* 旧文件坏了就重来 */
  }
}
const oldBoards = new Map((old.boards || []).map((b) => [b.id, b]));

// ---------- 抓取 ----------
const results = [];
for (const b of BOARDS) {
  try {
    const items = (await b.fn()).slice(0, b.max);
    if (!items.length) throw new Error('抓到 0 条');
    results.push({
      id: b.id,
      name: b.name,
      color: b.color,
      items,
      updated: new Date().toISOString(),
    });
    console.log(`  ✓ ${b.name}  ${items.length} 条`);
  } catch (e) {
    console.log(`  ✗ ${b.name}  失败: ${e.message}`);
    const prev = oldBoards.get(b.id);
    if (prev && prev.items?.length) {
      results.push(prev);
      console.log(`     沿用上次数据（${prev.items.length} 条，${prev.updated}）`);
    }
  }
}

if (!results.length) {
  console.error('所有平台都抓取失败，保留原文件不动');
  process.exit(1);
}

const payload = { updated: new Date().toISOString(), boards: results };
const body = 'window.HOT_BOARDS=' + JSON.stringify(payload) + ';\n';
writeFileSync(OUT, body, 'utf8');
console.log(`\n已写入 ${OUT}（${(body.length / 1024).toFixed(1)} KB，${results.length} 个平台）`);
