// 뉴스체크 AI 사이드 패널 (한 페이지 버전)
import { extractArticle, highlightKeywords, findQuote } from "../lib/extract.js";
import {
  scoreTitle, levelOf, bodySensationalness, writingStyle, reporterTrend, similarity,
  checkImages, parseDate, hostOf, timeAgo, fallbackQuery, computeCredibility,
} from "../lib/analysis.js";
import * as llm from "../lib/llm.js";
import { searchNews } from "../lib/naver.js";

const DEMO = new URLSearchParams(location.search).has("demo");
const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;

let S = null;      // 현재 기사 분석 상태
let runId = 0;     // 탭이 바뀌면 이전 분석 결과를 버리기 위한 번호
let pressDB = {};
let highlighted = false;
let lastUrl = "";

// ---------------- 설정·데이터 ----------------
async function getSettings() {
  return chrome.storage.local.get(["provider", "apiKey", "model", "naverId", "naverSecret"]);
}

async function loadPressDB() {
  pressDB = (await (await fetch("../data/press.json")).json()).outlets || {};
}

function pressInfo(host, fallbackName) {
  let h = (host || "").replace(/^www\.|^m\./, "");
  while (h && h.includes(".")) {
    if (pressDB[h]) return { domain: h, ...pressDB[h] };
    h = h.slice(h.indexOf(".") + 1);
  }
  return { domain: host, name: fallbackName || host };
}

// ---------------- 진입 ----------------
async function init() {
  await loadPressDB();
  bindUI();
  if (DEMO) return runDemo();
  analyzeActiveTab();
  chrome.tabs.onActivated.addListener(() => analyzeActiveTab());
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === "complete" && tab.active) analyzeActiveTab();
  });
  chrome.storage.onChanged.addListener(() => analyzeActiveTab(true));
}

function bindUI() {
  $("#btn-refresh").onclick = () => (DEMO ? runDemo() : analyzeActiveTab(true));
  $("#btn-settings").onclick = openOptions;
  $("#btn-highlight").onclick = toggleHighlight;
  $("#content").addEventListener("click", (e) => {
    if (e.target.closest("[data-open-options]")) openOptions();
    if (e.target.closest("[data-highlight]")) toggleHighlight();
    const q = e.target.closest("[data-quote]");
    if (q && S && !DEMO) {
      chrome.scripting.executeScript({ target: { tabId: S.article.tabId }, func: findQuote, args: [q.dataset.quote] }).catch(() => {});
    }
  });
}

function openOptions() {
  if (DEMO) return;
  chrome.runtime.openOptionsPage();
}

async function analyzeActiveTab(force = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (!force && tab.url === lastUrl && S) return;
  lastUrl = tab.url;
  highlighted = false;
  $("#btn-highlight").setAttribute("aria-pressed", "false");

  const my = ++runId;
  showState("loading", "기사를 읽는 중이에요");
  if (!/^https?:/.test(tab.url || "")) return showState("empty");

  let article;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractArticle });
    article = res.result;
  } catch (e) {
    return showState("error", "이 페이지는 읽을 수 없어요. 새로고침 후 다시 시도해 주세요.");
  }
  if (my !== runId) return;
  if (!article || !article.isArticle) return showState("empty");
  article.tabId = tab.id;
  startAnalysis(article, await getSettings(), my);
}

// ---------------- 분석 ----------------
function startAnalysis(article, settings, my) {
  const date = parseDate(article.published);
  const press = pressInfo(hostOf(article.originalUrl) || article.host, article.press);
  const hasAI = !!settings.apiKey;
  const hasNaver = !!(settings.naverId && settings.naverSecret);
  const selfHost = hostOf(article.originalUrl) || article.host;

  S = {
    article, date, press, hasAI, hasNaver,
    rule: {
      title: scoreTitle(article.title, article.body),
      body: bodySensationalness(article.body),
      style: writingStyle(article.body),
      images: checkImages(article.images, date),
    },
    aiTitle: { status: hasAI ? "loading" : "off" },
    reporter: { status: hasNaver && article.reporters.length ? "loading" : "off" },
    related: { status: hasNaver ? "loading" : "off" },
    cross: { status: hasAI && hasNaver ? "loading" : "off" },
    claims: { status: hasAI ? "loading" : "off", items: [] },
  };
  renderHead();
  render();
  const alive = () => my === runId;
  const set = (key, val) => { if (alive()) { S[key] = val; render(); } };
  const tagPress = (i) => ({ ...i, press: pressInfo(i.host).name || i.host });

  // ① AI 제목 생성 → 제목 자극도를 AI 제목 기준으로 다시 계산
  const titleP = hasAI
    ? llm.analyzeTitle(settings, article)
        .then((d) => {
          if (alive()) S.rule.title = scoreTitle(article.title, article.body, { aiTitle: d.neutral_title || "" });
          set("aiTitle", { status: "done", data: d });
          return d;
        })
        .catch((e) => { set("aiTitle", { status: "error", error: e.message }); return null; })
    : Promise.resolve(null);

  // ② 기자 최근 기사 → 자극적 보도 비율 (출처 점수에 반영)
  if (hasNaver && article.reporters.length) {
    const name = article.reporters[0];
    searchNews(settings, `${press.name || ""} ${name} 기자`.trim(), { display: 40, sort: "date" })
      .then((items) => {
        let mine = items.filter((i) => (press.domain && i.host.endsWith(press.domain)) || i.description.includes(name));
        if (mine.length < 3) mine = items.filter((i) => i.description.includes(name) || i.title.includes(name));
        mine = mine.filter((i) => similarity(i.title, article.title) < 0.8).map(tagPress);
        set("reporter", { status: "done", name, items: mine, trend: reporterTrend(mine) });
      })
      .catch((e) => set("reporter", { status: "error", error: e.message }));
  }

  // ③ 주장 단위 검증: 주장 추출 → 주장별 검색 → 다른 보도와 대조
  if (hasAI) {
    llm.extractClaims(settings, article)
      .then(async (d) => {
        const claims = (d.claims || []).slice(0, 5).map((c, i) => ({
          ...c, id: i, evidence: [],
          status: c.type === "의견" ? "opinion" : c.type === "전망" ? "forecast" : hasNaver ? "checking" : "unchecked",
        }));
        set("claims", { status: "done", items: claims });
        const facts = claims.filter((c) => c.status === "checking");
        if (!facts.length) return;
        await Promise.all(facts.map(async (c) => {
          try {
            const items = await searchNews(settings, c.search_query || c.text.slice(0, 40), { display: 10, sort: "sim" });
            c.evidence = items
              .filter((i) => !(i.host === selfHost && similarity(i.title, article.title) > 0.6))
              .map((i) => ({ ...tagPress(i), dateText: i.date ? fmtDate(i.date) : "" }));
          } catch (_) { c.evidence = []; }
        }));
        if (!alive()) return;
        try {
          const v = await llm.verifyClaims(settings, facts);
          const map = { "일치": "match", "충돌": "conflict", "근거 없음": "nofound" };
          (v.results || []).forEach((r) => {
            const c = facts[r.index];
            if (!c) return;
            c.status = map[r.status] || "nofound";
            c.note = r.note;
            c.evidenceIdx = Array.isArray(r.evidence) ? r.evidence : [];
          });
          facts.forEach((c) => { if (c.status === "checking") c.status = "nofound"; });
        } catch (e) {
          facts.forEach((c) => { c.status = "error"; c.note = e.message; });
        }
        set("claims", { status: "done", items: claims });
      })
      .catch((e) => set("claims", { status: "error", error: e.message }));
  }

  // ④ 같은 사건을 다룬 다른 보도 → 보도 규모, 내용 재사용, AI 교차검증
  if (hasNaver) {
    titleP.then(async (ai) => {
      const query = (ai && ai.search_query) || fallbackQuery(article.title);
      try {
        const items = await searchNews(settings, query, { display: 30, sort: "sim" });
        const lead = article.paragraphs.slice(0, 2).join(" ") || article.body.slice(0, 400);
        const rel = items
          .filter((i) => !(i.host === selfHost && similarity(i.title, article.title) > 0.6))
          .map((i) => {
            const sim = similarity(i.description, lead);
            const olderDays = date && i.date ? Math.round((date - i.date) / 86400000) : 0;
            return { ...tagPress(i), titleScore: scoreTitle(i.title).score, sim, olderDays, reused: olderDays > 7 && sim > 0.25 };
          });
        const others = rel.filter((r) => r.olderDays <= 7);
        set("related", { status: "done", query, items: rel, pressCount: new Set(others.map((r) => r.press)).size });
        if (hasAI && others.length) {
          llm.crossCheck(settings, article, others)
            .then((d) => set("cross", { status: "done", data: d }))
            .catch((e) => set("cross", { status: "error", error: e.message }));
        } else set("cross", { status: "off" });
      } catch (e) {
        set("related", { status: "error", error: e.message });
        set("cross", { status: "off" });
      }
    });
  }
}

// ---------------- 하이라이트 ----------------
function keywordWords() {
  return [...new Set([...S.rule.title.keywords, ...S.rule.body.keywords].map((k) => k.word))];
}

async function toggleHighlight() {
  if (!S) return;
  highlighted = !highlighted;
  $("#btn-highlight").setAttribute("aria-pressed", String(highlighted));
  if (!DEMO) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: S.article.tabId }, func: highlightKeywords, args: [keywordWords(), highlighted] });
    } catch (_) {}
  }
  render();
}

// ---------------- 공통 렌더링 ----------------
function showState(kind, text) {
  $("#article-head").hidden = true;
  const box = $("#content");
  if (kind === "loading") {
    box.innerHTML = `<div class="state"><div class="spinner"></div><p>${esc(text)}</p></div>`;
    return;
  }
  S = null;
  box.innerHTML = kind === "empty"
    ? `<div class="state"><h3>뉴스 기사를 열면 분석을 시작해요</h3>
        <p>지금 페이지에서는 기사 본문을 찾지 못했어요. 언론사나 포털의 기사 페이지에서 다시 열어 주세요.</p></div>`
    : `<div class="state"><h3>분석하지 못했어요</h3><p>${esc(text)}</p></div>`;
}

// 기사 작성일을 오늘 날짜와 비교
function relativeDate(d, now = new Date()) {
  const hours = (now - d) / 3600000;
  const days = Math.floor(hours / 24);
  if (hours < 1) return { text: "방금 전", old: false };
  if (hours < 24) return { text: `${Math.floor(hours)}시간 전`, old: false };
  if (days < 30) return { text: `${days}일 전`, old: false };
  if (days < 365) return { text: `${Math.floor(days / 30)}개월 전`, old: days > 90 };
  return { text: `${Math.floor(days / 365)}년 전`, old: true };
}

function renderHead() {
  const a = S.article;
  $("#article-head").hidden = false;
  $("#article-meta").innerHTML = [
    `<b>${esc(S.press.name || a.press || a.host)}</b>`,
    a.reporters.length ? esc(a.reporters.join(", ")) + " 기자" : "기자 정보 없음",
  ].join("<span>·</span>");
  $("#article-title").textContent = a.title;

  const box = $("#article-date");
  if (!S.date) { box.className = "date-line"; box.innerHTML = `<span class="muted">작성일을 찾지 못했어요</span>`; return; }
  const now = new Date();
  const rel = relativeDate(S.date, now);
  const mod = parseDate(a.modified);
  box.className = "date-line" + (rel.old ? " old" : "");
  box.innerHTML = `<span>${fmtDate(S.date)} 작성</span>
    <span class="date-rel">오늘(${fmtDate(now)}) 기준 ${rel.text}</span>
    ${mod && mod - S.date > 3600000 ? `<span>${fmtDate(mod)} 수정됨</span>` : ""}
    ${rel.old ? `<span class="date-warn">오래된 기사예요. 현재 상황과 다를 수 있어요</span>` : ""}`;
}

// 비동기 결과가 들어올 때마다 다시 그려도 펼쳐 둔 항목은 유지
function render() {
  if (!S) return;
  const open = [...document.querySelectorAll("#content details[open]")].map((d) => d.id);
  $("#content").innerHTML = viewMain();
  open.forEach((id) => { const d = document.getElementById(id); if (d) d.open = true; });
}

const skeleton = (n = 3) => Array.from({ length: n }, (_, i) => `<div class="skeleton" style="width:${90 - i * 15}%"></div>`).join("");
const toneCls = (t) => `pill ${["good", "warn", "bad"].includes(t) ? t : "neutral"}`;
const dotTone = (v) => (v == null ? "neutral" : v >= 70 ? "good" : v >= 45 ? "warn" : "bad");
const scoreLv = (v) => (v == null ? "none" : v >= 80 ? "calm" : v >= 60 ? "low" : v >= 40 ? "mid" : "high");

function titleScore() {
  const ai = S.aiTitle.status === "done" ? S.aiTitle.data : null;
  const score = ai && Number.isFinite(+ai.sensational_score) ? Math.round(+ai.sensational_score) : S.rule.title.score;
  return { score, level: levelOf(score), byAI: !!ai };
}

const CLAIM_STATUS = {
  match: { label: "다른 보도와 일치", tone: "good" },
  conflict: { label: "다른 보도와 충돌", tone: "bad" },
  nofound: { label: "근거를 못 찾음", tone: "warn" },
  checking: { label: "확인 중", tone: "neutral" },
  unchecked: { label: "검색 키 필요", tone: "neutral" },
  opinion: { label: "의견", tone: "neutral" },
  forecast: { label: "전망", tone: "neutral" },
  error: { label: "확인 실패", tone: "neutral" },
};

function claimCounts() {
  const c = { match: 0, conflict: 0, nofound: 0, checking: 0, facts: 0 };
  (S.claims.items || []).forEach((x) => {
    if (x.status in c) c[x.status]++;
    if (["match", "conflict", "nofound", "checking", "unchecked"].includes(x.status)) c.facts++;
  });
  return c;
}

// ---------------- 신뢰도 계산 ----------------
function credibility() {
  const rel = S.related.status === "done" ? S.related : null;
  return computeCredibility({
    claims: S.claims.status === "done" ? S.claims.items : [],
    relatedPressCount: rel ? rel.pressCount : null,
    crossConsistency: S.cross.status === "done" ? S.cross.data.consistency : null,
    style: S.rule.style,
    reporterName: S.article.reporters[0] || "",
    reporterSensationalRatio: S.reporter.status === "done" && S.reporter.trend.count >= 3 ? S.reporter.trend.sensationalRatio : null,
    titleScore: titleScore().score,
    bodyPer1k: S.rule.body.per1k,
    published: S.date,
    modified: parseDate(S.article.modified),
    now: new Date(),
    imageOld: S.rule.images.some((i) => i.flags.some((f) => /촬영 시점/.test(f.text))),
    reusedCount: rel ? rel.items.filter((i) => i.reused).length : 0,
  });
}

// 기준마다 한 줄 요약
function factorHeadline(key, f) {
  if (f.score == null) return f.missing || "확인할 수 없어요";
  if (key === "cross") {
    if (S.claims.status === "done" && S.claims.items.length) {
      const c = claimCounts();
      if (c.checking) return `주장 ${c.facts}개 확인 중`;
      const parts = [];
      if (S.related.status === "done") parts.push(`${S.related.pressCount}개 언론사 보도`);
      parts.push(c.conflict ? `충돌 ${c.conflict}건` : c.nofound ? `근거 없는 주장 ${c.nofound}건` : `주장 ${c.match}개 일치`);
      return parts.join(" · ");
    }
    return S.related.status === "done" ? `${S.related.pressCount}개 언론사가 같은 사건 보도` : f.reasons[0];
  }
  if (key === "author") {
    const types = (S.claims.items || []).filter((c) => c.source_type && c.type !== "의견" && c.type !== "전망").map((c) => c.source_type);
    if (types.length) {
      const weak = types.filter((t) => ["익명", "SNS·온라인", "없음"].includes(t)).length;
      return weak === 0 ? "공식·실명 출처로 뒷받침" : weak >= types.length / 2 ? "익명·출처 불명 주장 위주" : `불분명한 출처 ${weak}건`;
    }
    const st = S.rule.style;
    return st.anonymousSources + st.hearsay > st.officialSources + 2 ? "익명·전언 표현이 많아요" : "공식·실명 출처 위주";
  }
  if (key === "wording") {
    const words = S.rule.title.keywords.map((k) => k.word);
    return words.length ? `${titleScore().level.label} · ${words.slice(0, 3).join(", ")}` : titleScore().level.label;
  }
  if (key === "date") return S.date ? `${relativeDate(S.date).text} 작성` : "작성일 확인 불가";
  return "";
}

function oneLiner(c) {
  const parts = [];
  const cc = S.claims.status === "done" ? claimCounts() : null;
  const ts = titleScore();
  if (cc && cc.conflict) parts.push("다른 보도와 어긋나는 주장이 있어요.");
  else if (cc && cc.nofound) parts.push("다른 곳에서 확인되지 않는 주장이 있어요.");
  else if (cc && cc.match && !cc.checking) parts.push("핵심 주장들이 다른 보도와 일치해요.");
  if (ts.level.key === "mid" || ts.level.key === "high") parts.push("제목이 본문보다 과장됐어요.");
  const dateF = c.factors.find((f) => f.key === "date");
  if (dateF.score != null && dateF.score < 60) parts.push("오래된 기사이거나 예전 자료를 다시 쓴 흔적이 있어요.");
  if (!parts.length) parts.push(ts.level.key === "calm" ? "제목이 본문을 담백하게 전하고 있어요." : "제목에 약간의 강조 표현이 있어요.");
  return parts.join(" ");
}

// ---------------- 메인 화면 ----------------
function viewMain() {
  return [cardScore(), cardTitle(), cardClaimsToCheck(), keyNotice(), cardMore()].join("");
}

// 1) 신뢰도 + 기준 4줄
function cardScore() {
  const c = credibility();
  const pending = S.claims.status === "loading" || S.related.status === "loading" || S.aiTitle.status === "loading" ||
    (S.claims.items || []).some((x) => x.status === "checking");
  const deg = c.score == null ? 0 : c.score * 3.6;
  const ring = { calm: "var(--good)", low: "var(--accent)", mid: "var(--warn)", high: "var(--bad)", none: "var(--muted)" }[c.band.key];

  const rows = c.factors.map((f) => `
    <details class="crit" id="crit-${f.key}">
      <summary>
        <span class="crit-label">${f.label}</span>
        <span class="crit-head"><span class="dot-${dotTone(f.score)}"></span><span>${esc(factorHeadline(f.key, f))}</span></span>
        <span class="crit-score lv-${scoreLv(f.score)}">${f.score == null ? "–" : f.score + "%"}</span>
      </summary>
      <div class="crit-body">
        <div class="factor-bar"><span class="bar-${dotTone(f.score)}" style="width:${f.score ?? 0}%"></span></div>
        ${f.score == null ? `<p class="muted">${esc(f.missing || "")}</p>` : `<ul class="list">${f.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`}
        <p class="muted">최종 신뢰도에 ${f.weight}% 반영</p>
      </div>
    </details>`).join("");

  return `<div class="card">
    <div class="cred">
      <div class="ring" style="background:conic-gradient(${ring} ${deg}deg, var(--neutral-soft) 0)">
        <div class="ring-in"><b>${c.score == null ? "–" : c.score}<small>${c.score == null ? "" : "%"}</small></b><span>신뢰도</span></div>
      </div>
      <div style="flex:1;min-width:0">
        <span class="pill bg-${c.band.key === "none" ? "low" : c.band.key}">${c.band.label}</span>
        ${c.tentative ? `<span class="pill neutral">잠정</span>` : ""}
        ${pending ? `<span class="pill neutral">분석 중</span>` : ""}
        <p style="margin-top:6px">${esc(oneLiner(c))}</p>
      </div>
    </div>
    <div class="crits">${rows}</div>
    <p class="muted cred-note">진짜일 확률이 아니라, 신뢰할 근거가 얼마나 확인됐는지예요.${c.capped ? " 충돌하는 주장이 있어 60% 이하로 제한했어요." : ""}${c.coverage < 100 ? ` 확인된 기준은 전체의 ${c.coverage}%예요.` : ""} 항목을 누르면 근거가 보여요.</p>
  </div>`;
}

// 2) 원제목 vs AI 제목
function markWords(text, words) {
  let out = esc(text);
  words.forEach((w) => { if (w) out = out.split(esc(w)).join(`<mark>${esc(w)}</mark>`); });
  return out;
}

function cardTitle() {
  const a = S.article;
  const ai = S.aiTitle;
  const words = S.rule.title.keywords.map((k) => k.word).concat(
    ai.status === "done" ? (ai.data.exaggerated_phrases || []).map((p) => p.phrase).filter((p) => p && a.title.includes(p) && p.length <= 12) : []);
  const exempt = S.rule.title.exempt || [];

  let aiBox = "";
  if (ai.status === "done") aiBox = `<div class="title-box ai"><div class="tag">AI가 본문만 보고 쓴 제목</div><div class="t">${esc(ai.data.neutral_title)}</div></div>`;
  else if (ai.status === "loading") aiBox = `<div class="title-box ai"><div class="tag">AI가 본문만 보고 쓴 제목</div>${skeleton(2)}</div>`;
  else if (ai.status === "error") aiBox = `<p class="muted">AI 제목을 만들지 못했어요: ${esc(ai.error)}</p>`;

  const diffs = ai.status === "done" ? (ai.data.differences || []).slice(0, 2) : [];
  return `<div class="card">
    <h2>제목 비교 <span class="right">자극도 ${titleScore().score}점</span></h2>
    <div class="titles">
      <div class="title-box orig"><div class="tag sub">원제목</div><div class="t">${markWords(a.title, [...new Set(words)])}</div></div>
      ${aiBox}
    </div>
    ${diffs.length ? `<ul class="list" style="margin-top:8px">${diffs.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
    ${exempt.length ? `<p class="muted" style="margin-top:6px">${exempt.map((k) => `'${esc(k.word)}'`).join(", ")}은(는) ${esc(exempt[0].why)}이라 감점하지 않았어요.</p>` : ""}
  </div>`;
}

// 3) 확인이 필요한 주장 (충돌·근거 없음만)
function cardClaimsToCheck() {
  const cl = S.claims;
  if (cl.status === "off" || cl.status === "error") return "";
  if (cl.status === "loading") return `<div class="card"><h2>확인이 필요한 주장</h2>${skeleton(2)}</div>`;
  const c = claimCounts();
  const flagged = cl.items.filter((x) => x.status === "conflict" || x.status === "nofound")
    .sort((x, y) => (x.status === "conflict" ? 0 : 1) - (y.status === "conflict" ? 0 : 1)).slice(0, 2);
  if (!flagged.length) {
    const msg = c.checking ? `주장 ${c.facts}개를 다른 보도와 대조하는 중이에요.`
      : c.match ? `핵심 주장 ${c.match}개가 모두 다른 보도와 일치해요.` : "검증할 사실 주장이 없어요.";
    return `<div class="card"><h2>확인이 필요한 주장</h2><p class="sub">${msg}</p>${c.checking ? skeleton(1) : ""}</div>`;
  }
  return `<div class="card"><h2>확인이 필요한 주장 <span class="right">${flagged.length}건</span></h2>
    ${flagged.map((x) => claimRow(x, true)).join("")}</div>`;
}

function claimRow(x, withEvidence) {
  const st = CLAIM_STATUS[x.status] || CLAIM_STATUS.error;
  const ev = withEvidence
    ? (x.evidenceIdx && x.evidenceIdx.length ? x.evidenceIdx.map((i) => x.evidence[i]).filter(Boolean) : x.evidence || []).slice(0, 2)
    : [];
  return `<div class="claim-row claim-${st.tone}">
    <div class="claim-top"><span class="${toneCls(st.tone)}">${st.label}</span>
      ${x.quote ? `<button class="link-btn" data-quote="${esc(x.quote)}">본문에서 보기</button>` : ""}</div>
    <p class="claim-text">${esc(x.text)}</p>
    ${x.note ? `<p class="claim-note">${esc(x.note)}</p>` : ""}
    <p class="muted">기사가 든 출처: ${esc(x.source || "출처 없음")}</p>
    ${ev.length ? `<div class="claim-ev">${ev.map((e) => `<a href="${esc(e.link)}" target="_blank" rel="noopener"><b>${esc(e.press)}</b> ${esc(e.title)}</a>`).join("")}</div>` : ""}
  </div>`;
}

function keyNotice() {
  if (S.hasAI && S.hasNaver) return "";
  const msg = !S.hasAI && !S.hasNaver
    ? "지금은 키워드 규칙으로만 분석 중이에요. AI·네이버 API 키를 넣으면 주장 검증과 교차검증까지 볼 수 있어요."
    : !S.hasAI ? "AI API 키를 넣으면 AI 제목 생성과 주장 검증을 볼 수 있어요."
    : "네이버 검색 API 키를 넣으면 다른 보도와 교차검증할 수 있어요.";
  return `<div class="notice"><span>${msg}</span><button data-open-options>설정</button></div>`;
}

// 4) 근거 자세히 보기 (접힌 상태)
function cardMore() {
  const sections = [];

  if (S.aiTitle.status === "done" && Array.isArray(S.aiTitle.data.summary)) {
    sections.push(`<h3>핵심 요약</h3><ul class="list">${S.aiTitle.data.summary.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`);
  }

  if (S.claims.status === "done" && S.claims.items.length) {
    sections.push(`<h3>기사 속 주장 전체</h3>${S.claims.items.map((x) => claimRow(x, ["match", "conflict", "nofound"].includes(x.status))).join("")}`);
  }

  if (S.related.status === "done") {
    const recent = S.related.items.filter((i) => !i.reused && i.olderDays <= 7).slice(0, 6);
    const reused = S.related.items.filter((i) => i.reused).slice(0, 3);
    sections.push(`<h3>같은 사건을 다룬 다른 보도</h3>
      ${recent.length ? recent.map(relRow).join("") : `<p class="sub">최근 일주일 안에 같은 사건을 다룬 기사를 찾지 못했어요.</p>`}
      ${reused.length ? `<p class="muted" style="margin-top:6px">일주일 이상 지난 비슷한 기사</p>${reused.map(relRow).join("")}` : ""}`);
  }

  const st = S.rule.style;
  const rep = S.reporter.status === "done" && S.reporter.trend.count ? S.reporter.trend : null;
  sections.push(`<h3>출처·글쓴이 지표</h3>
    <div class="rows">
      <div><span class="k">공식 출처 표현</span><span class="v">${st.officialSources}회 <span class="muted">(밝혔다·발표·브리핑)</span></span></div>
      <div><span class="k">익명 출처 표현</span><span class="v">${st.anonymousSources}회 <span class="muted">(관계자·소식통)</span></span></div>
      <div><span class="k">전언·추정 표현</span><span class="v">${st.hearsay}회 <span class="muted">(알려졌다·전망이다)</span></span></div>
      ${rep ? `<div><span class="k">기자 최근 기사</span><span class="v">${rep.count}건 중 감정 자극 제목 ${rep.sensationalRatio}%</span></div>` : ""}
    </div>`);

  const kws = S.rule.title.keywords.concat(S.rule.body.keywords);
  if (kws.length) {
    sections.push(`<h3>자극 표현</h3>
      <div class="chips">${[...new Set(kws.map((k) => k.word))].map((w) => `<span class="pill warn">${esc(w)}</span>`).join("")}</div>
      <button class="btn" style="margin-top:8px" data-highlight>${highlighted ? "본문 표시 끄기" : "본문에서 위치 보기"}</button>`);
  }

  if (S.rule.images.length) {
    sections.push(`<h3>사진 확인</h3>${S.rule.images.slice(0, 3).map((im) => `
      <div class="img-row">
        <img src="${esc(im.src)}" alt="" referrerpolicy="no-referrer" />
        <div style="flex:1;min-width:0">
          <div class="cap">${esc(im.caption || "캡션 없음")}</div>
          <div class="chips" style="margin-top:4px">${im.flags.map((f) => `<span class="${toneCls(f.tone)}">${esc(f.text)}</span>`).join("")}</div>
          <a href="https://lens.google.com/uploadbyurl?url=${encodeURIComponent(im.src)}" target="_blank" rel="noopener" class="muted">이 사진이 처음 쓰인 곳 찾기 ↗</a>
        </div>
      </div>`).join("")}`);
  }

  return `<details class="card more" id="more">
    <summary>근거 자세히 보기</summary>
    <div class="more-body">${sections.join("")}</div>
  </details>`;
}

function relRow(i) {
  const lv = levelOf(i.titleScore ?? 0);
  return `<a class="rel" href="${esc(i.link)}" target="_blank" rel="noopener">
    <div class="rel-top"><span class="rel-press">${esc(i.press || i.host)}</span><span>${esc(timeAgo(i.date))}</span>
      ${i.reused ? `<span class="pill warn">${i.olderDays}일 전 유사 기사</span>` : `<span class="pill bg-${lv.key}">자극도 ${i.titleScore}</span>`}</div>
    <div class="rel-title">${esc(i.title)}</div></a>`;
}

// ---------------- 데모 모드 (발표용: API 없이 화면 확인) ----------------
async function runDemo() {
  const demo = await (await fetch("../data/demo.json")).json();
  const my = ++runId;
  startAnalysis(demo.article, {}, my);
  S.hasAI = S.hasNaver = true;
  S.rule.title = scoreTitle(demo.article.title, demo.article.body, { aiTitle: demo.aiTitle.neutral_title });
  S.aiTitle = { status: "done", data: demo.aiTitle };
  const items = demo.reporterItems.map((i) => ({ ...i, date: parseDate(i.date) }));
  S.reporter = { status: "done", name: demo.article.reporters[0], items, trend: reporterTrend(items) };
  const rel = demo.related.map((i) => ({ ...i, date: parseDate(i.date), titleScore: scoreTitle(i.title).score }));
  S.related = { status: "done", query: demo.aiTitle.search_query, items: rel, pressCount: new Set(rel.filter((r) => !r.reused).map((r) => r.press)).size };
  S.cross = { status: "done", data: demo.cross };
  S.claims = { status: "done", items: demo.claims.map((c, i) => ({ ...c, id: i })) };
  renderHead();
  render();
}

init();
