/**
 * 慢岛生活 · 门户与分类配置
 *
 * 说明：这里生成的是「预填好查询词的搜索链接」，
 * 点击后在新标签页打开对应平台自己的搜索页。
 * 不抓取、不代理、不需要任何 API Key。
 */
window.PORTALS = [
  {
    id: 'weibo',
    name: '微博',
    desc: '实时热搜与讨论',
    color: '#E6162D',
    // 微博搜索
    url: (q) => 'https://s.weibo.com/weibo?q=' + encodeURIComponent(q),
  },
  {
    id: 'douyin',
    name: '抖音',
    desc: '短视频热点',
    color: '#161823',
    url: (q) => 'https://www.douyin.com/search/' + encodeURIComponent(q),
  },
  {
    id: 'toutiao',
    name: '今日头条',
    desc: '资讯聚合',
    color: '#F04142',
    url: (q) => 'https://so.toutiao.com/search?keyword=' + encodeURIComponent(q),
  },
  {
    id: 'baidu',
    name: '百度新闻',
    desc: '中文新闻检索',
    color: '#2932E1',
    url: (q) => 'https://www.baidu.com/s?tn=news&wd=' + encodeURIComponent(q),
  },
  {
    id: 'zhihu',
    name: '知乎',
    desc: '问答与深度讨论',
    color: '#0084FF',
    url: (q) => 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(q),
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    desc: '视频内容',
    color: '#00A1D6',
    url: (q) => 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(q),
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    desc: '生活分享',
    color: '#FF2442',
    url: (q) => 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(q),
  },
  {
    id: 'googlenews',
    name: 'Google News',
    desc: '全球新闻聚合',
    color: '#4285F4',
    url: (q) => 'https://news.google.com/search?q=' + encodeURIComponent(q) + '&hl=zh-CN',
  },
  {
    id: 'bingnews',
    name: 'Bing 新闻',
    desc: '微软新闻搜索',
    color: '#008373',
    url: (q) => 'https://www.bing.com/news/search?q=' + encodeURIComponent(q),
  },
];

/** 内容类型分类：会作为关键词前缀拼进查询 */
window.CATEGORIES = [
  { id: 'all', name: '全部', term: '' },
  { id: 'politics', name: '时政', term: '时政' },
  { id: 'business', name: '财经', term: '财经' },
  { id: 'tech', name: '科技', term: '科技' },
  { id: 'sports', name: '体育', term: '体育' },
  { id: 'entertainment', name: '娱乐', term: '娱乐' },
  { id: 'society', name: '社会', term: '社会' },
  { id: 'travel', name: '旅行', term: '旅行' },
  { id: 'culture', name: '文化', term: '文化' },
  { id: 'life', name: '生活', term: '生活' },
];
