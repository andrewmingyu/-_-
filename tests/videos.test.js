import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sectionData } from '../newscheck 4/shared/view.js';
import { validateAnalysis } from '../newscheck 4/shared/api.js';
const fixture = JSON.parse(fs.readFileSync(new URL('../newscheck 4/data/demo.json', import.meta.url), 'utf8'));
const video = (extra = {}) => ({ id: 'video_abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: '정부 발표 논란 보도', channel: 'SBS 뉴스',
  channel_label: 'SBS 뉴스', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', published_at: '2018-03-12T09:00:00+09:00', ...extra });
const related = a => sectionData(a).find(s => s.id === 'related');

test('related videos show thumbnail, official channel label and a safe link in both summary and details', () => {
  const a = structuredClone(fixture); a.is_demo = false; a.related_videos = [video()];
  validateAnalysis(a);
  for (const html of [related(a).summary, related(a).details]) {
    assert.match(html, /관련 영상 · 공식 채널/);
    assert.match(html, /<img class="video-thumb" src="https:\/\/i\.ytimg\.com\/vi\/abcdefghijk\/hqdefault\.jpg"/);
    assert.match(html, /<a href="https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk" target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /SBS 뉴스/);
    assert.match(html, /사실 여부는 판단하지 않습니다/);
    assert.doesNotMatch(html, /신뢰도|확인된 사실|거짓|%/);
  }
});

test('related videos are not clickable in demo mode and titles are escaped', () => {
  const a = structuredClone(fixture); a.is_demo = true; a.related_videos = [video({ title: '<script>alert(1)</script>' })];
  const html = related(a).summary;
  assert.doesNotMatch(html, /<a href=/);
  assert.match(html, /시연용 링크/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('without related videos nothing extra is rendered', () => {
  const a = structuredClone(fixture); delete a.related_videos;
  validateAnalysis(a);
  assert.doesNotMatch(related(a).summary + related(a).details, /관련 영상/);
  a.related_videos = [];
  assert.doesNotMatch(related(a).summary, /관련 영상/);
});

test('contract rejects non-YouTube video links, foreign thumbnails and oversized lists', () => {
  const make = v => { const a = structuredClone(fixture); a.related_videos = v; return a; };
  validateAnalysis(make([video()]));
  validateAnalysis(make([video({ thumbnail_url: null })]));
  assert.throws(() => validateAnalysis(make([video({ url: 'https://evil.example/watch?v=abcdefghijk' })])), /관련 영상/);
  assert.throws(() => validateAnalysis(make([video({ url: 'https://www.youtube.com.evil.example/x' })])), /관련 영상/);
  assert.throws(() => validateAnalysis(make([video({ thumbnail_url: 'https://evil.example/a.jpg' })])), /썸네일/);
  assert.throws(() => validateAnalysis(make(Array.from({ length: 6 }, () => video()))), /관련 영상/);
  assert.throws(() => validateAnalysis(make('x')), /관련 영상/);
});
