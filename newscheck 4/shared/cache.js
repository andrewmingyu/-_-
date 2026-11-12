import { normalizeArticleUrl } from './article.js';
export class ArticleInputCache {
  constructor({ttl=30000,max=64,clock=Date.now}={}) { this.ttl=ttl;this.max=max;this.clock=clock;this.entries=new Map(); }
  put(payload,articleId,revision=0) {
    if (!payload?.page_text || !articleId) return;
    const url=normalizeArticleUrl(payload.url);
    if((this.entries.get(url)?.revision ?? -1)>revision)return;
    const clean={url,title:payload.title || '',page_text:payload.page_text,refresh:false,
      metadata:payload.metadata ? {...payload.metadata,url} : null,
      article_context:payload.article_context || {cited_links:[],quotations:[],body_truncated:false}};
    if (this.entries.size>=this.max && !this.entries.has(url)) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(url,{payload:structuredClone(clean),article_id:articleId,revision,expires:this.clock()+this.ttl});
  }
  get(value) {
    const url=normalizeArticleUrl(value),entry=this.entries.get(url);
    if (!entry || entry.expires<=this.clock()) {this.entries.delete(url);return null;}
    return structuredClone(entry);
  }
  delete(value) { try {this.entries.delete(normalizeArticleUrl(value));} catch {} }
}
