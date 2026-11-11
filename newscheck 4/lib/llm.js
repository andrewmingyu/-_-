// AI 모델 호출: Gemini / OpenAI / Claude 중 설정에서 고른 것을 사용합니다.

export const PROVIDERS = {
  gemini: { label: "Google Gemini", defaultModel: "gemini-2.5-flash", keyHint: "AIza..." },
  openai: { label: "OpenAI", defaultModel: "gpt-4o-mini", keyHint: "sk-..." },
  anthropic: { label: "Anthropic Claude", defaultModel: "claude-haiku-5-5", keyHint: "sk-ant-..." },
};

function parseJson(text) {
  if (!text) throw new Error("AI 응답이 비어 있어요.");
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("AI 응답을 해석하지 못했어요.");
}

async function call(settings, system, user) {
  const provider = settings.provider || "gemini";
  const key = settings.apiKey;
  const model = settings.model || PROVIDERS[provider].defaultModel;
  if (!key) throw new Error("NO_KEY");

  let res, data;
  if (provider === "gemini") {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    });
    data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Gemini 오류 (${res.status})`);
    return parseJson(data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "");
  }

  if (provider === "openai") {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `OpenAI 오류 (${res.status})`);
    return parseJson(data?.choices?.[0]?.message?.content);
  }

  if (provider === "anthropic") {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system: system + "\nJSON 객체 하나만 출력하고 다른 말은 쓰지 마세요.",
        messages: [{ role: "user", content: user }],
      }),
    });
    data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Claude 오류 (${res.status})`);
    return parseJson(data?.content?.map((c) => c.text || "").join(""));
  }
  throw new Error("알 수 없는 AI 제공자예요.");
}

const SYSTEM = `당신은 한국 뉴스 기사를 분석하는 중립적인 미디어 리터러시 도우미입니다.
기사 내용의 정치적 입장을 평가하지 말고, 제목과 본문이 얼마나 일치하는지, 표현이 얼마나 자극적인지만 판단하세요.
반드시 한국어로, 요청한 JSON 형식으로만 답하세요.`;

/** 기능 1·5: AI 제목 생성 + 원제목 자극도 비교 */
export async function analyzeTitle(settings, article) {
  const user = `다음 기사의 본문만 읽고, 내용을 과장 없이 정확하게 전달하는 제목을 새로 쓰세요.
그다음 원래 제목과 비교해 원제목이 얼마나 자극적·과장되었는지 평가하세요.
"사망", "폭락"처럼 본문에서 사실로 확인되는 단어는 과장이 아닙니다. 본문에 없는 감정 표현, 확정되지 않은 일을 단정한 표현, 본문과 다른 수치만 과장으로 판단하세요.

[원제목]
${article.title}

[본문]
${article.body.slice(0, 6000)}

다음 JSON으로 답하세요:
{
  "neutral_title": "본문 기반의 담백한 제목 (원제목과 비슷한 길이)",
  "sensational_score": 0~100 정수 (0=본문과 정확히 일치하고 담백, 100=본문과 동떨어진 낚시성),
  "verdict": "담백함" | "약간 강조" | "다소 과장" | "매우 자극적",
  "differences": ["원제목과 AI 제목의 차이점을 구체적으로, 최대 3개"],
  "exaggerated_phrases": [{"phrase": "원제목 속 표현", "why": "왜 과장인지 한 문장"}],
  "summary": ["본문 핵심 요약 1", "요약 2", "요약 3"],
  "search_query": "같은 사건을 다룬 다른 기사를 찾기 위한 검색어 (핵심 명사 2~4개, 자극적 단어 제외)"
}`;
  return call(settings, SYSTEM, user);
}

/** 기능 2: 기자 작성 스타일 요약 */
export async function analyzeReporter(settings, reporter, press, titles, style) {
  const user = `기자 "${reporter}"(${press || "언론사 미상"})의 최근 기사 제목들과, 현재 기사에서 측정한 작성 지표입니다.
기자 개인을 평가하거나 정치 성향을 추측하지 말고, 관찰 가능한 작성 패턴만 설명하세요.

[최근 기사 제목]
${titles.slice(0, 30).map((t, i) => `${i + 1}. ${t}`).join("\n") || "(없음)"}

[현재 기사 지표]
평균 문장 길이 ${style.avgSentenceLength}자, 직접 인용 문장 비율 ${style.quoteRatio}%, 익명 출처 ${style.anonymousSources}회, 전언·추정 표현 ${style.hearsay}회, 공식 출처 ${style.officialSources}회

다음 JSON으로 답하세요:
{
  "main_fields": ["주로 다루는 분야, 최대 3개"],
  "style_summary": "작성 스타일을 2문장 이내로",
  "title_tendency": "제목 작성 경향을 1문장으로 (예: 사실 전달형, 인용 강조형, 의문형 제목 다수 등)"
}`;
  return call(settings, SYSTEM, user);
}

/** 기능 4: 관련 기사와 교차검증 */
export async function crossCheck(settings, article, related) {
  const list = related.slice(0, 10).map((r, i) => `${i + 1}. [${r.press}] ${r.title} — ${r.description}`).join("\n");
  const user = `현재 기사와 같은 사건을 다룬 다른 언론사 기사들입니다. 사실관계가 일치하는지, 현재 기사만 유독 자극적이거나 다른 주장을 하는지 비교하세요.

[현재 기사 제목] ${article.title}
[현재 기사 본문 앞부분] ${article.body.slice(0, 2000)}

[다른 기사들]
${list}

다음 JSON으로 답하세요:
{
  "consistency": "일치" | "부분 일치" | "단독 주장" | "판단 어려움",
  "consistency_note": "사실관계 비교 결과 1~2문장",
  "framing": "다른 기사들에 비해 현재 기사 제목·표현이 더 자극적인지, 비슷한지, 더 담백한지 1문장",
  "only_in_this_article": ["다른 기사에서는 확인되지 않는 이 기사만의 주장, 없으면 빈 배열"]
}`;
  return call(settings, SYSTEM, user);
}

/** 주장 단위 검증 ① 기사에서 검증 가능한 주장 뽑기 */
export async function extractClaims(settings, article) {
  const user = `다음 기사에서 사실 여부를 확인할 수 있는 핵심 주장을 최대 5개 뽑으세요.
누가, 언제, 무엇을, 얼마나 같은 구체적 사실 주장을 우선하고, 기자나 인용된 사람의 평가·의견은 type을 "의견"으로 표시하세요.

[제목] ${article.title}
[본문]
${article.body.slice(0, 6000)}

다음 JSON으로 답하세요:
{
  "claims": [
    {
      "text": "주장을 한 문장으로 (본문 표현을 최대한 살려서)",
      "type": "사실" | "전망" | "의견",
      "source": "기사가 이 주장의 근거로 든 출처 (예: 국방부 발표, 익명 관계자, SNS 게시글, 출처 없음)",
      "source_type": "공식" | "실명" | "익명" | "SNS·온라인" | "없음",
      "quote": "이 주장이 나온 본문 문장 그대로 (60자 이내로 자르기)",
      "search_query": "이 주장을 다른 기사에서 확인하기 위한 검색어 (핵심 명사 2~4개)"
    }
  ]
}`;
  return call(settings, SYSTEM, user);
}

/** 주장 단위 검증 ② 다른 보도와 대조 */
export async function verifyClaims(settings, claims) {
  const blocks = claims.map((c, i) => {
    const ev = (c.evidence || []).slice(0, 8)
      .map((e, j) => `  [${j}] (${e.press}, ${e.dateText}) ${e.title} — ${e.description}`).join("\n");
    return `주장 ${i}: ${c.text}\n다른 보도:\n${ev || "  (검색 결과 없음)"}`;
  }).join("\n\n");
  const user = `각 주장을 아래 다른 언론사 보도들과 대조하세요. 보도에 실제로 적힌 내용만 근거로 삼고, 당신이 알고 있는 지식으로 판단하지 마세요.
다른 보도가 같은 사실을 독립적으로 전하면 "일치", 다른 사실(다른 수치·날짜·결과)을 전하면 "충돌", 관련 보도가 없거나 이 주장을 확인할 수 없으면 "근거 없음"입니다.

${blocks}

다음 JSON으로 답하세요:
{
  "results": [
    { "index": 주장 번호, "status": "일치" | "충돌" | "근거 없음", "note": "판단 근거 한 문장 (어느 보도가 무엇을 말했는지)", "evidence": [근거가 된 보도 번호들] }
  ]
}`;
  return call(settings, SYSTEM, user);
}
