export function articleRequest(a, refresh = false) {
  return { url:a.url, title:a.title, page_text:a.body.replace(/\s+/g,' ').trim(), refresh,
    metadata:{url:a.url,title:a.title,publisher:a.press || null,author:a.reporters?.join(', ') || null,
      published_at:a.published || null,updated_at:a.modified || null,event_time:null,event_location:null,author_profile_url:null} };
}
