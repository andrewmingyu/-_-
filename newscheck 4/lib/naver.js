// 기존 네이버 검색 모듈 보존용. 현재 분석 경로는 backend/app/clients.py의 Tavily를 사용합니다.
// 이 모듈을 다시 연결할 때는 엔드포인트와 키 발급 정책을 공식 문서에서 별도로 확인해야 합니다.
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
