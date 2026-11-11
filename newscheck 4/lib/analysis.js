// API 키 없이도 동작하는 규칙 기반 분석 함수들 (브라우저·Node 양쪽에서 실행 가능)

// 자극 키워드 사전: weight가 클수록 자극적. 팀에서 자유롭게 추가·수정하세요.
// kind는 아래 FACT_WORDS에 있으면 "fact"(사실 단어), 없으면 "emotion"(감정 단어)으로 자동 지정됩니다.
//  - 감정 단어: 정보 없이 감정만 자극 → 항상 감점
//  - 사실 단어: 실제 일어난 일일 수 있음 → 본문이 뒷받침하면 감점하지 않음
export const SENSATIONAL_WORDS = [
  // 3점: 강한 감정 유발·낚시성
  { w: "충격", weight: 3 }, { w: "경악", weight: 3 }, { w: "발칵", weight: 3 }, { w: "날벼락", weight: 3 },
  { w: "소름", weight: 3 }, { w: "멘붕", weight: 3 }, { w: "이럴수가", weight: 3 }, { w: "헉", weight: 3 },
  { w: "초토화", weight: 3 }, { w: "아수라장", weight: 3 }, { w: "대참사", weight: 3 }, { w: "알고보니", weight: 3 },
  { w: "알고 보니", weight: 3 }, { w: "뭐길래", weight: 3 }, { w: "역대급", weight: 3 }, { w: "대박", weight: 3 },
  { w: "섬뜩", weight: 3 }, { w: "끔찍", weight: 3 }, { w: "패닉", weight: 3 }, { w: "폭탄", weight: 2 },
  // 2점: 결말·단정을 과장
  { w: "결국", weight: 2 }, { w: "급기야", weight: 2 }, { w: "끝내", weight: 2 }, { w: "사망", weight: 2 },
  { w: "참사", weight: 2 }, { w: "폭로", weight: 2 }, { w: "파문", weight: 2 }, { w: "맹비난", weight: 2 },
  { w: "직격탄", weight: 2 }, { w: "몰락", weight: 2 }, { w: "망신", weight: 2 }, { w: "굴욕", weight: 2 },
  { w: "격분", weight: 2 }, { w: "분노", weight: 2 }, { w: "폭등", weight: 2 }, { w: "폭락", weight: 2 },
  { w: "공포", weight: 2 }, { w: "최악", weight: 2 }, { w: "초유", weight: 2 }, { w: "처참", weight: 2 },
  { w: "저격", weight: 2 }, { w: "일침", weight: 2 }, { w: "벼랑", weight: 2 }, { w: "비명", weight: 2 },
  // 1점: 흔하지만 강조 효과
  { w: "논란", weight: 1 }, { w: "긴급", weight: 1 }, { w: "비상", weight: 1 }, { w: "경고", weight: 1 },
  { w: "전격", weight: 1 }, { w: "단독", weight: 1 }, { w: "속보", weight: 1 }, { w: "무슨 일", weight: 1 },
  { w: "이유는", weight: 1 }, { w: "정체", weight: 1 }, { w: "완전히", weight: 1 }, { w: "난리", weight: 1 },
];

// 사실 단어와, 본문에서 그 사실을 뒷받침하는 표현들
export const FACT_WORDS = {
  "사망": ["사망", "숨졌", "숨진", "숨지", "숨을 거", "목숨을 잃", "별세", "사망자", "시신", "희생자"],
  "참사": ["참사", "사망자", "희생자", "숨진", "숨졌"],
  "폭로": ["폭로", "공개했", "제보"],
  "파문": ["파문", "논란", "반발", "비판"],
  "몰락": ["몰락", "파산", "폐업", "퇴출"],
  "폭등": ["폭등", "급등", "치솟"],
  "폭락": ["폭락", "급락", "곤두박질"],
  "초유": ["초유", "처음", "최초"],
  "비상": ["비상"], "경고": ["경고"], "긴급": ["긴급"], "전격": ["전격"],
  "단독": ["단독"], "속보": ["속보"], "논란": ["논란", "반발", "비판"],
};
SENSATIONAL_WORDS.forEach((x) => { x.kind = FACT_WORDS[x.w] ? "fact" : "emotion"; });

// "사망설", "사망 의혹"처럼 사실이 아니라 소문·의혹을 가리키는 쓰임
const HEDGED_SUFFIX = "(?:\\s?(?:설|說|의혹|가능성|루머|오보|가짜|여부))";
const stripHedged = (text, word) => text.replace(new RegExp(word + HEDGED_SUFFIX, "g"), " ");

/** 본문이 사실 단어를 뒷받침하는가 (소문·의혹 표현은 제외) */
export function isFactSupported(word, body = "") {
  const clean = stripHedged(body, word);
  return (FACT_WORDS[word] || [word]).some((v) => clean.includes(v));
}

// 기사 본문에서 쓰이는 "불확실·전언" 표현
const HEDGE_PATTERNS = [
  "검토", "알려졌다", "전해졌다", "것으로 보인다", "관측", "전망", "가능성", "예정", "추진", "논의",
  "할 듯", "될 듯", "~듯", "추정", "거론", "제기", "의혹", "미정", "확정되지", "아직",
];
const ASSERTIVE_TITLE = /(확정|결정|단행|돌입|시행|폐지|사망|사실로|드러나|밝혀져|결국)/;
const ANON_SOURCE = /(관계자|소식통|측근|익명|한 인사|고위 인사|업계에선|업계에 따르면|정통한)/g;
const HEARSAY = /(알려졌다|전해졌다|것으로 보인다|관측된다|전망이다|라는 후문|라는 말이 나온다|라는 지적이 나온다|우려가 나온다|목소리가 나온다)/g;
const OFFICIAL = /(발표했다|밝혔다|브리핑|보도자료|공식|공문|통계|자료에 따르면|조사 결과|발표에 따르면)/g;

const STOPWORDS = new Set([
  "기자", "뉴스", "오늘", "이번", "지난", "있다", "했다", "하는", "위해", "대한", "관련", "통해", "그리고",
  "하지만", "이후", "때문", "것으로", "것이", "등의", "에서", "까지", "부터", "단독", "속보", "종합", "사진",
]);

export const stripHtml = (s = "") =>
  s.replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();

// 아주 단순한 한국어 토큰화: 2글자 이상 덩어리에서 흔한 조사를 떼어낸다
export function tokenize(text = "") {
  return (text.match(/[가-힣A-Za-z0-9]{2,}/g) || [])
    .map((t) => t.replace(/(으로|에서|에게|까지|부터|이라|라는|하는|했다|한다|이다|에는|과의|와의|은|는|이|가|을|를|의|에|와|과|도|로|만)$/, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function findSensational(text = "", { kind } = {}) {
  const found = [];
  for (const { w, weight, kind: k } of SENSATIONAL_WORDS) {
    if (kind && k !== kind) continue;
    // 사실 단어는 "사망설"처럼 소문을 가리키는 쓰임은 세지 않는다
    const t = k === "fact" ? stripHedged(text, w) : text;
    let idx = t.indexOf(w), count = 0;
    while (idx !== -1) { count++; idx = t.indexOf(w, idx + w.length); }
    if (count) found.push({ word: w, count, weight, kind: k });
  }
  // "알고 보니"와 "알고보니"처럼 겹치는 경우는 그대로 둔다 (사전에서 둘 중 하나만 맞음)
  return found.sort((a, b) => b.weight * b.count - a.weight * a.count);
}

// 제목 자체의 낚시성 패턴
function titlePatterns(title) {
  const out = [];
  if (/[!！]/.test(title)) out.push({ label: "느낌표 사용", weight: 6 });
  if (/\?\s*$|？/.test(title) && !/^["“']/.test(title)) out.push({ label: "물음표로 궁금증 유발", weight: 6 });
  if (/(…|\.\.\.)\s*$/.test(title)) out.push({ label: "말줄임표로 끝맺음", weight: 5 });
  if (/(이것|그것|이 사람|이곳|정체는|이유는|결과는)\W*$/.test(title)) out.push({ label: "핵심을 숨기는 표현", weight: 10 });
  if (/^\s*[“"'‘][^”"'’]+[”"'’]\s*$/.test(title)) out.push({ label: "따옴표 인용만으로 된 제목", weight: 5 });
  if (/ㅋ|ㅠ|ㄷㄷ|헐/.test(title)) out.push({ label: "인터넷 구어체", weight: 8 });
  return out;
}

const numberTokens = (s) => (s.match(/\d+(?:[.,]\d+)?\s?(?:%|퍼센트|배|억|만|조|명|원|년|일|건|개|위)?/g) || []).map((x) => x.replace(/\s/g, ""));

/**
 * 제목 자극도(0~100, 높을수록 자극적)를 규칙으로 계산
 */
export function scoreTitle(title = "", body = "", { aiTitle = "" } = {}) {
  const reasons = [];
  const exempt = [];
  let score = 0;

  // 원제목에만 있고, 본문·AI 제목으로 정당화되지 않는 단어만 감점
  const found = findSensational(title);
  const kws = [];
  found.forEach((k) => {
    if (aiTitle && aiTitle.includes(k.word)) exempt.push({ ...k, why: "AI가 쓴 담백한 제목에도 들어가는 불가피한 표현" });
    else if (k.kind === "fact" && body && isFactSupported(k.word, body)) exempt.push({ ...k, why: "본문에서 사실로 확인되는 표현" });
    else kws.push(k);
  });
  // 본문이 뒷받침하지 않는 사실 단어(예: 본문은 '사망설'인데 제목은 '사망')는 감정 단어보다 무겁게 본다
  let kwScore = kws.reduce((s, k) => s + k.weight * 6 * k.count * (k.kind === "fact" ? 1.5 : 1), 0);
  if (kws.some((k) => k.kind === "fact")) kwScore += 10;
  kwScore = Math.min(50, kwScore);
  const emo = kws.filter((k) => k.kind === "emotion").map((k) => k.word);
  const fact = kws.filter((k) => k.kind === "fact").map((k) => k.word);
  if (emo.length) reasons.push(`감정을 자극하는 단어: ${emo.join(", ")}`);
  if (fact.length) reasons.push(`본문에서 확인되지 않는 단정 표현: ${fact.join(", ")}`);
  score += kwScore;

  const pats = titlePatterns(title);
  pats.forEach((p) => { score += p.weight; reasons.push(p.label); });

  // 제목 단어가 본문에 얼마나 나오는가
  const tt = [...new Set(tokenize(title))];
  const bodyText = body || "";
  const covered = tt.filter((t) => bodyText.includes(t));
  const coverage = tt.length ? covered.length / tt.length : 1;
  if (body && coverage < 0.5) { score += 15; reasons.push(`제목 단어의 ${Math.round(coverage * 100)}%만 본문에 등장`); }

  // 제목 숫자가 본문에 없는가
  const nums = numberTokens(title).filter((n) => n.length > 1);
  const missingNums = nums.filter((n) => !bodyText.replace(/\s/g, "").includes(n));
  if (body && missingNums.length) { score += 10; reasons.push(`제목의 수치(${missingNums.join(", ")})가 본문에서 확인되지 않음`); }

  // 본문은 불확실한데 제목은 단정적인가
  const hedgeCount = HEDGE_PATTERNS.filter((h) => bodyText.includes(h)).length;
  const titleHedged = /(검토|전망|가능성|듯|추진|논의|의혹|\?)/.test(title);
  if (body && hedgeCount >= 3 && !titleHedged && ASSERTIVE_TITLE.test(title)) {
    score += 12; reasons.push("본문은 '검토·전망' 등 불확실한데 제목은 단정적");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, level: levelOf(score), reasons, keywords: kws, exempt, coverage: Math.round(coverage * 100) };
}

export function levelOf(score) {
  if (score >= 60) return { key: "high", label: "매우 자극적" };
  if (score >= 35) return { key: "mid", label: "다소 과장" };
  if (score >= 15) return { key: "low", label: "약간 강조" };
  return { key: "calm", label: "담백함" };
}

/**
 * 본문 자극 키워드 밀도 (1,000자당 가중 점수)
 */
export function bodySensationalness(body = "") {
  // 본문의 사실 단어(사망, 폭락 등)는 사건 서술에 필요하므로 감정 단어만 센다
  const kws = findSensational(body, { kind: "emotion" });
  const weighted = kws.reduce((s, k) => s + k.weight * k.count, 0);
  const per1k = body.length ? (weighted / body.length) * 1000 : 0;
  return { keywords: kws, per1k: Math.round(per1k * 10) / 10, total: kws.reduce((s, k) => s + k.count, 0) };
}

const countMatches = (text, re) => (text.match(re) || []).length;

/**
 * 이 기사 한 편에서 보이는 작성 스타일 지표
 */
export function writingStyle(body = "") {
  const sentences = body.split(/(?<=[.?!다])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 5);
  const n = sentences.length || 1;
  const quoteSentences = sentences.filter((s) => /[“"]/.test(s)).length;
  const anon = countMatches(body, ANON_SOURCE);
  const hearsay = countMatches(body, HEARSAY);
  const official = countMatches(body, OFFICIAL);
  const numbers = countMatches(body, /\d+(?:[.,]\d+)?\s?(?:%|명|원|억|조|건|배)/g);
  const avgLen = Math.round(sentences.reduce((s, x) => s + x.length, 0) / n);

  const traits = [];
  if (official >= anon + 2) traits.push({ tone: "good", text: "공식 발표·자료 인용 중심" });
  if (anon >= 3) traits.push({ tone: "warn", text: `익명 출처 의존 (${anon}회)` });
  if (hearsay >= 3) traits.push({ tone: "warn", text: `전언·추정 표현 많음 (${hearsay}회)` });
  if (quoteSentences / n > 0.4) traits.push({ tone: "neutral", text: "직접 인용 위주로 구성" });
  if (numbers >= 5) traits.push({ tone: "good", text: "수치·데이터 제시가 많음" });
  if (avgLen > 90) traits.push({ tone: "neutral", text: "긴 문장 위주의 해설형" });
  else if (avgLen < 45) traits.push({ tone: "neutral", text: "짧은 문장 위주의 속보형" });
  if (!traits.length) traits.push({ tone: "neutral", text: "뚜렷한 편중 없이 일반적인 구성" });

  return {
    sentences: n,
    avgSentenceLength: avgLen,
    quoteRatio: Math.round((quoteSentences / n) * 100),
    anonymousSources: anon,
    hearsay,
    officialSources: official,
    numbers,
    traits,
  };
}

/**
 * 기자의 최근 기사 제목 목록으로 경향 계산
 */
export function reporterTrend(items = []) {
  const titles = items.map((i) => i.title);
  const withKw = titles.filter((t) => findSensational(t, { kind: "emotion" }).length > 0);
  const scores = titles.map((t) => scoreTitle(t).score);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  const freq = new Map();
  titles.forEach((t) => [...new Set(tokenize(t))].forEach((w) => freq.set(w, (freq.get(w) || 0) + 1)));
  const topics = [...freq.entries()].filter(([w, c]) => c >= 2 && !findSensational(w).length).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);

  const kwFreq = new Map();
  titles.forEach((t) => findSensational(t, { kind: "emotion" }).forEach((k) => kwFreq.set(k.word, (kwFreq.get(k.word) || 0) + 1)));

  return {
    count: titles.length,
    sensationalRatio: titles.length ? Math.round((withKw.length / titles.length) * 100) : 0,
    avgTitleScore: avg,
    topics,
    topKeywords: [...kwFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}

// 자카드 유사도 (내용 재사용 판별용)
export function similarity(a = "", b = "") {
  const A = new Set(tokenize(a)), B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

export function parseDate(s) {
  if (!s) return null;
  const iso = Date.parse(s);
  if (!isNaN(iso)) return new Date(iso);
  const m = String(s).match(/(20\d{2})[.\-/년]\s?(\d{1,2})[.\-/월]\s?(\d{1,2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/**
 * 이미지 캡션으로 재사용·자료사진 여부를 추정
 */
export function checkImages(images = [], articleDate) {
  const ad = articleDate instanceof Date ? articleDate : parseDate(articleDate);
  return images.map((img) => {
    const cap = img.caption || "";
    const flags = [];
    if (/(자료\s?사진|파일\s?사진|자료\s?이미지|게티이미지|셔터스톡|gettyimages|shutterstock|이미지\s?투데이|클립아트|DB\b|자료\s?화면)/i.test(cap))
      flags.push({ tone: "warn", text: "자료사진·스톡 이미지로 표기됨" });
    if (/(AI\s?생성|생성형\s?AI|일러스트|그래픽|합성)/i.test(cap))
      flags.push({ tone: "warn", text: "그래픽·합성·AI 생성 이미지로 표기됨" });

    // 캡션 속 촬영 날짜가 기사 날짜와 다른가
    let capDate = null;
    const full = cap.match(/(20\d{2})[.\-/년]\s?(\d{1,2})[.\-/월]\s?(\d{1,2})/);
    const partial = cap.match(/(?:지난|올해|작년|지난해)?\s?(\d{1,2})월\s?(\d{1,2})일/);
    if (full) capDate = new Date(+full[1], +full[2] - 1, +full[3]);
    else if (partial && ad) {
      capDate = new Date(ad.getFullYear(), +partial[1] - 1, +partial[2]);
      if (capDate > ad) capDate.setFullYear(capDate.getFullYear() - 1);
      if (/지난해|작년/.test(cap)) capDate.setFullYear(ad.getFullYear() - 1);
    }
    if (capDate && ad) {
      const days = Math.round((ad - capDate) / 86400000);
      if (days > 14) flags.push({ tone: "warn", text: `캡션상 촬영 시점이 기사보다 약 ${days >= 60 ? Math.round(days / 30) + "개월" : days + "일"} 이전` });
    }
    if (!cap) flags.push({ tone: "neutral", text: "캡션이 없어 출처 확인 불가" });
    if (!flags.length) flags.push({ tone: "good", text: "캡션상 특이점 없음" });
    return { ...img, flags };
  });
}

export function hostOf(url = "") {
  try { return new URL(url).hostname.replace(/^www\.|^m\.|^mobile\./, ""); } catch { return ""; }
}

export function timeAgo(date) {
  if (!date) return "";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}분 전`;
  if (diff < 86400) return `${Math.round(diff / 3600)}시간 전`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)}일 전`;
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

// 관련 기사 검색어를 규칙으로 만든다 (AI가 없을 때)
export function fallbackQuery(title = "") {
  const clean = title.replace(/\[[^\]]*\]|\([^)]*\)|[“”"'‘’…·,!?]/g, " ");
  const toks = tokenize(clean).filter((t) => !findSensational(t).length);
  return toks.slice(0, 4).join(" ");
}
