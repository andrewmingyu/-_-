import { PROVIDERS } from "../lib/llm.js";

const ids = ["provider", "apiKey", "model", "naverId", "naverSecret"];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

function updateHints() {
  const p = PROVIDERS[el.provider.value];
  el.apiKey.placeholder = p.keyHint;
  el.model.placeholder = `기본값: ${p.defaultModel}`;
}

chrome.storage.local.get(ids).then((s) => {
  ids.forEach((id) => { if (s[id]) el[id].value = s[id]; });
  if (!s.provider) el.provider.value = "gemini";
  updateHints();
});

el.provider.addEventListener("change", () => { el.model.value = ""; updateHints(); });

document.getElementById("save").addEventListener("click", async () => {
  const data = Object.fromEntries(ids.map((id) => [id, el[id].value.trim()]));
  await chrome.storage.local.set(data);
  const s = document.getElementById("saved");
  s.hidden = false;
  setTimeout(() => (s.hidden = true), 1800);
});
