import test from 'node:test';
import assert from 'node:assert/strict';
import {isSupportedArticleUrl} from '../newscheck 4/shared/article.js';

test('Hover accepts HTTPS article links on Naver and Yonhap News TV', () => {
  for (const url of [
    'https://news.naver.com/article/001/0000000001',
    'https://n.news.naver.com/mnews/article/001/0000000001?sid=100',
    'https://www.yonhapnewstv.co.kr/news/MYH20261113165748OZp',
    'https://yonhapnewstv.co.kr/news/MYH20261113165748OZp/?source=list',
  ]) assert.equal(isSupportedArticleUrl(url), true, url);
});

test('Hover rejects list pages, other hosts, credentials and local network destinations', () => {
  for (const url of [
    'https://www.yonhapnewstv.co.kr/news',
    'https://www.yonhapnewstv.co.kr/news/category',
    'https://www.yonhapnewstv.co.kr/',
    'https://news.naver.com/',
    'https://www.yonhapnewstv.co.kr.example.com/news/MYH20261113165748OZp',
    'https://example.com/news/MYH20261113165748OZp',
    'http://www.yonhapnewstv.co.kr/news/MYH20261113165748OZp',
    'https://name:password@www.yonhapnewstv.co.kr/news/MYH20261113165748OZp',
    'https://www.yonhapnewstv.co.kr:8443/news/MYH20261113165748OZp',
    'http://127.0.0.1/news/MYH20261113165748OZp',
    'javascript:alert(1)', 'not a URL',
  ]) assert.equal(isSupportedArticleUrl(url), false, url);
});

test('Side panel skips search results, video, chat and other non-article pages', async () => {
  const {isNonArticlePage} = await import('../newscheck 4/shared/article.js');
  for (const url of ['https://search.naver.com/search.naver?query=wsj', 'https://www.google.com/search?q=a', 'https://claude.ai/chat/1', 'https://www.youtube.com/watch?v=abc', 'https://github.com/a/b'])
    assert.equal(isNonArticlePage(url), true, url);
  for (const url of ['https://n.news.naver.com/article/011/0004682182', 'https://magazine.hankyung.com/business/article/202611146356b', 'https://www.chosun.com/x', 'not a URL'])
    assert.equal(isNonArticlePage(url), false, url);
});
