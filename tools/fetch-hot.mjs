/**
 * 抓取百度热搜，生成 assets/hot-news.js
 *
 * 由 GitHub Actions 定时运行（见 .github/workflows/fetch-hot.yml）。
 * 浏览器不能直接请求百度接口（跨域），所以在这里抓取后写成静态文件。
 *
 * 用法：node tools/fetch-hot.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const API = 'https://top.baidu.com/api/board?platform=wise&tab=realtime';
const OUT = 'assets/hot-news.js';
const MAX = 20; // 多存一些，前端取前 10

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Referer: 'https://top.baidu.com/board?tab=realtime',
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      console.warn('  第 ' + i + ' 次失败：' + e.message);
      if (i === tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}

console.log('抓取百度热搜…');
const json = await get(API);

// 数据结构：data.cards[0].content[0].content[]
const card = json?.data?.cards?.[0];
const list = card?.content?.[0]?.content;
if (!Array.isArray(list) || !list.length) {
  throw new Error('返回结构不符合预期');
}

const items = [];
for (const it of list) {
  if (!it || !it.word) continue;
  items.push({
    word: String(it.word).trim(),
    url: it.url || 'https://www.baidu.com/s?wd=' + encodeURIComponent(it.word),
  });
  if (items.length >= MAX) break;
}

if (!items.length) throw new Error('没有解析出任何条目');

const payload = {
  updated: new Date().toISOString(),
  source: 'baidu',
  items,
};

const js = 'window.HOT_NEWS=' + JSON.stringify(payload) + ';\n';
mkdirSync('assets', { recursive: true });
writeFileSync(OUT, js, 'utf8');

console.log('已写入 ' + OUT);
console.log('共 ' + items.length + ' 条，更新时间 ' + payload.updated);
items.slice(0, 5).forEach(function (it, i) {
  console.log('  ' + (i + 1) + '. ' + it.word);
});
