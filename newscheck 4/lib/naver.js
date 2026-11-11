// 네이버 뉴스 검색 API
// 2026년 7월 31일부터 신규 발급은 네이버 클라우드 플랫폼의 NAVER API HUB에서만 가능합니다.
// HUB 키를 먼저 시도하고, 실패하면 예전 개발자센터 방식(2027년 6월 30일까지 유지)으로 다시 시도합니다.
import { stripHtml, hostOf, parseDate } from "./analysis.js";

const ENDPOINTS = [
  {
    name: "hub",
    url: (q, display, sort) =>
      `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(q)}&display=${display}&sort=${sort}&format=json`,
    headers: (s) => ({ "X-NCP-APIGW-API-KEY-ID": s.naverId, "X-NCP-APIGW-API-KEY": s.naverSecret }),
  },
  {
    name: "legacy",
    url: (q, display, sort) =>
      `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(q)}&display=${display}&sort=${sort}`,
    headers: (s) => ({ "X-Naver-Client-Id": s.naverId, "X-Naver-Client-Secret": s.naverSecret }),
  },
];

let preferred = null; // 한 번 성공한 방식을 기억

export async function searchNews(settings, query, { display = 20, sort = "sim" } = {}) {
  if (!settings.naverId || !settings.naverSecret) throw new Error("NO_NAVER");
  const order = preferred ? [preferred, ...ENDPOINTS.filter((e) => e !== preferred)] : ENDPOINTS;
  let lastError = "";
  for (const ep of order) {
    try {
      const res = await fetch(ep.url(query, display, sort), { headers: ep.headers(settings) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = data?.errorMessage || data?.error?.message || data?.error?.errorMessage || `네이버 검색 오류 (${res.status})`;
        continue;
      }
      preferred = ep;
      return (data.items || []).map((it) => ({
        title: stripHtml(it.title),
        description: stripHtml(it.description),
        link: it.originallink || it.link,
        naverLink: it.link,
        host: hostOf(it.originallink || it.link),
        date: parseDate(it.pubDate),
      }));
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(`${lastError} — 키가 맞는지, API HUB에서 '검색 - 뉴스'를 선택했는지 확인해 주세요.`);
}
