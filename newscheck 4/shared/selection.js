const clean = value => String(value || '').replace(/\s+/g,' ').trim();
export function isSingleWord(text) {
  return text.length<=80 && /\p{L}/u.test(text) && /^[\p{L}\p{M}\p{N}]+(?:[-'’][\p{L}\p{M}\p{N}]+)*$/u.test(text);
}
export function selectionPageUrl(doc) {
  const candidates=[doc.location?.href,doc.referrer];
  try {candidates.push(doc.defaultView?.parent.location.href);} catch { /* Cross-origin parent. */ }
  for(const candidate of candidates) {
    try {const url=new URL(candidate);if(['http:','https:'].includes(url.protocol) && !url.username && !url.password)return url.href;} catch { /* Try the next actual origin. */ }
  }
  return null;
}

// A visible DOM excerpt is a fallback for unsupported/short/dynamic pages, never
// a fabricated complete article. No form/editable content is sent for selection.
export function selectionContext(selection, article) {
  if(!selection?.rangeCount) return null;
  const range=selection.getRangeAt(0);
  const element=node=>node?.nodeType===1?node:node?.parentElement;
  if([element(range.startContainer),element(range.endContainer)].some(el=>el?.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]'))) return null;
  const text=clean(selection.toString());
  if(!text || text.length>3000 || (text.length<2 && !isSingleWord(text))) return null;
  const full=clean(article?.body);
  let node=element(range.commonAncestorContainer), surrounding='';
  node=node?.closest('p,li,blockquote,td,figcaption,article,main') || node;
  for(let i=0;node && i<6;i++,node=node.parentElement) {
    const candidate=clean(node.innerText || node.textContent);
    let from=0;
    try {const prefix=range.cloneRange();prefix.selectNodeContents(node);prefix.setEnd(range.startContainer,range.startOffset);from=Math.max(0,clean(prefix.toString()).length-1);} catch { /* Use visible surrounding text. */ }
    let at=candidate.indexOf(text,from);
    if(at<0)at=candidate.indexOf(text);
    if(at>=0) {surrounding=candidate.slice(Math.max(0,at-500),at+text.length+500);break;}
  }
  if(!surrounding) surrounding=text;
  if(article?.isArticle && full.includes(surrounding)) return {text,scope:'article',body:full,surrounding};
  return {text,scope:'page_excerpt',body:surrounding,surrounding};
}
