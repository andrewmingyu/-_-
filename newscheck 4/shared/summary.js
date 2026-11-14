// 출처 추적 현황 요약.
// 기사 내용의 사실·거짓이나 신뢰도를 판정하지 않고, 서버가 돌려준 "출처 확인 상태"만 센다.
const STATUS_LABELS = {
  original_found: '원본 자료 확인',
  secondary_only: '재인용만 확인',
  source_not_found: '원출처 못 찾음',
  unknown: '정보 부족',
};
export const TRACE_NOTE = '출처를 찾았는지 보여 주는 표시예요. 원본 자료가 있어도 기사 내용이 맞다는 뜻은 아니고, 사실 여부는 판정하지 않아요.';

export function traceSummary(a) {
  if (!a || a.ui_state) return null; // 분석 중·오류 화면에서는 표시하지 않는다
  const claims = Array.isArray(a.claims) ? a.claims : [];
  const claimStatuses = claims.map(c => (c.source_status in STATUS_LABELS ? c.source_status : 'unknown'));
  const count = key => claimStatuses.filter(s => s === key).length;
  const total = claimStatuses.length;
  const found = count('original_found');

  let headline;
  if (!total) headline = '기사에서 출처를 추적할 주장을 찾지 못했어요';
  else if (found === total) headline = '주장 ' + total + '개 모두 원본 자료를 찾았어요';
  else if (found > 0) headline = '주장 ' + total + '개 중 ' + found + '개의 원본 자료를 찾았어요';
  else if (count('secondary_only') > 0) headline = '원본은 못 찾고 재인용 자료만 확인했어요';
  else if (count('source_not_found') > 0) headline = '원출처를 찾지 못했어요';
  else headline = '출처를 확인할 정보가 부족해요';

  const notice = sourceNotice(a);
  const cautionCount = notice?.issues.length || 0;
  return {
    headline,
    total,
    cells: claimStatuses.map(key => ({ key, label: STATUS_LABELS[key] })),
    legend: Object.keys(STATUS_LABELS).filter(key => count(key) > 0).map(key => ({ key, label: STATUS_LABELS[key], count: count(key) })),
    caution: cautionCount > 0,
    cautionCount,
    partial: notice?.partial || false,
  };
}

export const NOTICE_NOTE = '출처 확인·주의 상태이며 기사의 사실·거짓이나 언론사의 신뢰 등급을 판정하지 않습니다.';
const LEVELS = {
  review: {icon:'🔴',text:'교차검증 필요'},
  clear: {icon:'🟢',text:'확보한 범위에서 별도 주의사항 없음'},
  caution: {icon:'🟡',text:'주의 필요'},
  unknown: {icon:'⚪',text:'확인 정보 부족'}
};
const normalize = text => String(text || '').replace(/\s+/g,' ').trim().replace(/[.!。]+$/,'').trim();

export function reportReviewPoints(report) {
  if(!report.id || report.comparison_status!=='compared' || !['body_excerpt','search_snippet','title_only'].includes(report.comparison_basis))return [];
  return (report.comparison_points || []).filter(p=>{
    if(p.kind!=='difference' || p.article_quote===p.related_quote || !['event','actors','time','figures','attribution'].includes(p.aspect) ||
      !['claim_conflict','citation_difference'].includes(p.review_kind) || !['paired_excerpt','needs_confirmation'].includes(p.review_status))return false;
    if(![p.article_quote,p.related_quote].every(q=>typeof q==='string' && q.trim().length>=8))return false;
    if(p.review_kind==='citation_difference' && !report.cited_by_article)return false;
    return p.review_status==='needs_confirmation' || (report.comparison_basis==='body_excerpt' &&
      typeof p.context_anchor==='string' && p.context_anchor.length>=2 && p.article_quote.includes(p.context_anchor) && p.related_quote.includes(p.context_anchor));
  });
}

// Derived only from the existing source-analysis contract. No weights, truth scores,
// outlet rankings, title word-overlap or age-based deductions are generated.
export function sourceNotice(a) {
  if (!a || a.ui_state) return null;
  const claims=a.claims || [], mentions=a.evidence_mentions || [], sources=a.sources || [];
  const claimIds=new Set(claims.map(c=>c.id)), sourceIds=new Set(sources.map(s=>s.id));
  const reports=a.related_articles || [],reportIds=new Set(reports.map(r=>r.id));
  const issues=new Map(), incomplete=new Set();
  const add=(code,text,cids=[],sids=[],rids=[],severity='caution')=>{
    const item=issues.get(code) || {code,text,claim_ids:[],source_ids:[],report_ids:[],severity};
    item.claim_ids=[...new Set([...item.claim_ids,...cids.filter(id=>claimIds.has(id))])];
    item.source_ids=[...new Set([...item.source_ids,...sids.filter(id=>sourceIds.has(id))])];
    item.report_ids=[...new Set([...item.report_ids,...rids.filter(id=>reportIds.has(id))])];
    issues.set(code,item);
  };
  if (!claims.length) incomplete.add('출처를 추적할 핵심 주장을 확보하지 못했습니다.');
  if (a.search_status==='not_run') incomplete.add('출처 분석 전이거나 검색할 근거가 부족합니다.');
  else if (a.search_status==='failed') incomplete.add('원출처 검색 요청이 실패했습니다.');
  else if (a.search_status!=='completed') incomplete.add('출처 검색 완료 여부를 확인하지 못했습니다.');
  const coreErrors=(a.pipeline_errors || []).filter(e=>['source_search','document_fetch','source_review'].includes(e.phase));
  for(const error of coreErrors) incomplete.add(error.message);
  for(const error of a.search_errors || []) {
    if (!/관련 기사|다른 보도/.test(error)) incomplete.add(error);
  }
  for(const c of claims) {
    if(['opinion','interpretation','prediction'].includes(c.claim_type)) {
      add('interpretation','해석·예측 주의: 사건 발생 사실과 구분해 읽어야 합니다.',[c.id],c.source_ids || []);
    }
    const own=mentions.filter(m=>(m.claim_ids || []).includes(c.id));
    if(own.some(m=>m.anonymous)) add('anonymous','출처 추가 확인 필요: 익명 발언에 의존하는 주장이 있습니다.',[c.id],c.source_ids || []);
    if(c.source_status==='secondary_only') add('secondary','원자료 확인 필요: 재인용 자료만 확인했습니다.',[c.id],c.source_ids || []);
    else if(c.source_status==='source_not_found' && a.search_status==='completed') add('not_found','원출처 추가 확인 필요: 완료한 검색 범위에서 원자료를 찾지 못했습니다.',[c.id]);
    else if(c.source_status!=='original_found') incomplete.add('일부 핵심 주장과 원출처의 관계를 확인하지 못했습니다.');
    if(c.source_status==='original_found') {
      const linked=sources.filter(s=>(c.source_ids || []).includes(s.id) && s.discovery==='article_cited' &&
        s.original_status==='original_found' && (s.mention_ids || []).some(id=>own.some(m=>m.id===id)));
      if(!linked.some(s=>s.content_status==='retrieved')) incomplete.add('일부 핵심 근거의 원문 또는 기사 인용 관계를 확인하지 못했습니다.');
    }
  }
  // Keep objective explanations and their references; consolidate repeated server rules.
  const decisions=[{decision:a.caution,cids:[],sids:[]},
    ...claims.map(c=>({decision:c.caution,cids:[c.id],sids:c.source_ids || []})),
    ...sources.filter(s=>s.discovery==='article_cited').map(s=>({decision:s.caution,cids:[],sids:[s.id]}))];
  for(const {decision,cids,sids} of decisions) {
    if(!decision) continue;
    const details=decision.details || [];
    const rows=[...details,...(decision.reasons || []).filter(reason=>!details.some(d=>normalize(d.reason)===normalize(reason))).map(reason=>({reason}))]
      .filter(row=>!row.source_ids?.length || row.claim_ids?.length || row.source_ids.some(id=>sources.some(s=>s.id===id && s.discovery==='article_cited')));
    if(decision?.status==='unknown') {
      for(const row of rows) {
        if(!normalize(row.reason).startsWith('출처 속성을 확인하지 못했습니다:')) incomplete.add(row.reason);
      }
    }
    if(decision?.status!=='caution') continue;
    for(const row of rows) {
      const text=normalize(row.reason);
      if(!text || /^(원본 자료 확인은|출처 확인은|주의사항의 존재나 부재는|확보한 출처 정보에서 별도의 주의사항을 발견하지)/.test(text)) continue;
      // Optional profile fields, publication age and operational failures are not adverse evidence.
      if(/^(출처 속성을 확인하지|자료 발행일은 기사 작성일보다|원출처 검색 요청이 실패|검색된 자료와 기사 출처의 관계|기사에서 검색할 근거를 확보하지)/.test(text)) continue;
      if((a.search_errors || []).some(error=>normalize(error)===text)) continue;
      let code='reason:'+text, message=text;
      if(/익명 관계자/.test(text)){code='anonymous';message='출처 추가 확인 필요: 익명 발언에 의존하는 주장이 있습니다.';}
      else if(/의견·해석·예측/.test(text)){code='interpretation';message='해석·예측 주의: 사건 발생 사실과 구분해 읽어야 합니다.';}
      else if(/재인용/.test(text)){code='secondary';message='원자료 확인 필요: 재인용 자료만 확인했습니다.';}
      else if(/완료된 검색 범위.*원출처를 찾지/.test(text)){code='not_found';message='원출처 추가 확인 필요: 완료한 검색 범위에서 원자료를 찾지 못했습니다.';}
      else if(/근거의 출처가 기사에 명확히/.test(text)){code='attribution';message='출처 표기 확인 필요: 일부 주장의 근거 출처가 명확하지 않습니다.';}
      else if(/조사·연구 방법/.test(text)){code='methodology';message='조사 방법 확인 필요: 통계·연구의 방법을 확인하지 못했습니다.';}
      else if(/자료 작성자의 이해관계/.test(text)){message='이해관계 주의: '+text;}
      add(code,message,[...cids,...(row.claim_ids || [])],[...sids,...(row.source_ids || [])]);
    }
  }
  for(const report of reports) {
    const points=reportReviewPoints(report);
    for(const kind of ['claim_conflict','citation_difference']) {
      const own=points.filter(p=>p.review_kind===kind);if(!own.length)continue;
      const red=own.some(p=>p.review_status==='paired_excerpt');
      const label=report.publisher?report.publisher+' · '+report.title:report.title;
      const message=kind==='citation_difference'
        ? '원문 대조 필요: 「'+label+'」와 인용·조건 표현에 차이가 있어 왜곡 여부를 확인해야 합니다.'
        : red?'교차검증 필요: 「'+label+'」와 같은 사안의 서술이 충돌할 가능성이 있어 확인이 필요합니다.'
          :'교차검증 필요: 「'+label+'」와 차이 후보가 있어 원문·비교 맥락을 추가 확인해야 합니다.';
      add('report:'+report.id+':'+kind,message,[],[],[report.id],red?'review':'caution');
    }
  }
  const items=[...issues.values()].sort((a,b)=>(b.severity==='review')-(a.severity==='review'));
  const level=items.some(i=>i.severity==='review')?'review':items.length?'caution':incomplete.size?'unknown':'clear';
  return {level,...LEVELS[level],issues:items,incomplete:[...incomplete],partial:incomplete.size>0};
}

export function badgeInfo(a) {
  const notice=sourceNotice(a);
  if(!notice) return null;
  const claimLabel=item=>item.claim_ids.map(id=>'주장 '+((a.claims || []).findIndex(c=>c.id===id)+1)).join('·');
  return {level:notice.level,label:notice.icon+' '+notice.text+(a.is_demo?' · 시연용':''),caution:'',headline:notice.text,
    lines:notice.issues.slice(0,3).map(item=>item.text+(item.claim_ids.length?' ('+claimLabel(item)+')':'')),
    partial:notice.partial,note:[...(a.is_demo?['시연용 예시 · 실제 분석 결과가 아닙니다.']:[]),...notice.incomplete,NOTICE_NOTE].join(' ')};
}
