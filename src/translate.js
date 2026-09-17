'use strict';

const LANGS = ['my', 'en', 'th', 'zh', 'ko', 'ja'];
const GOOGLE_MAP = { my: 'my', en: 'en', th: 'th', zh: 'zh-CN', ko: 'ko', ja: 'ja' };
const MEMORY_MAP = { my: 'my', en: 'en', th: 'th', zh: 'zh-CN', ko: 'ko', ja: 'ja' };

function normalizeLang(code) {
  const c = String(code || '')
    .trim()
    .toLowerCase()
    .replace('_', '-')
    .slice(0, 2);
  return LANGS.includes(c) ? c : null;
}

function isSupportedLang(code) {
  return Boolean(normalizeLang(code));
}

async function translateText(text, from, to) {
  const src = normalizeLang(from);
  const dest = normalizeLang(to);
  const body = String(text || '');
  if (!body) return body;
  if (!src || !dest || src === dest) return body;
  const key = String(process.env.TRANSLATE_API_KEY || '').trim();
  if (key === 'test' || key === 'stub') return `[${dest}] ${body}`;
  if (process.env.NODE_ENV === 'test') return null;
  const timeout = AbortSignal.timeout(Number(process.env.TRANSLATE_TIMEOUT_MS || 5000));
  if (key) {
    try {
      const google = await translateGoogle(body, src, dest, key, timeout);
      if (google) return google;
    } catch {
      /* fall through */
    }
    try {
      const libre = await translateLibre(body, src, dest, key, timeout);
      if (libre) return libre;
    } catch {
      /* fall through */
    }
  }
  try {
    const memory = await translateMyMemory(body, src, dest, timeout);
    if (memory) return memory;
  } catch {
    /* degrade */
  }
  return null;
}

async function translateGoogle(text, from, to, key, signal) {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: GOOGLE_MAP[from],
      target: GOOGLE_MAP[to],
      format: 'text'
    }),
    signal
  });
  if (!res.ok) return null;
  const data = await res.json();
  const out = data && data.data && data.data.translations && data.data.translations[0];
  return out && out.translatedText ? String(out.translatedText) : null;
}

async function translateLibre(text, from, to, key, signal) {
  const base = String(process.env.TRANSLATE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  const res = await fetch(`${base}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: from,
      target: to,
      api_key: key,
      format: 'text'
    }),
    signal
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.translatedText ? String(data.translatedText) : null;
}

async function translateMyMemory(text, from, to, signal) {
  const q = encodeURIComponent(text.slice(0, 450));
  const pair = `${MEMORY_MAP[from]}|${MEMORY_MAP[to]}`;
  const res = await fetch(`https://api.mymemory.translated.net/get?q=${q}&langpair=${pair}`, { signal });
  if (!res.ok) return null;
  const data = await res.json();
  const out = data && data.responseData && data.responseData.translatedText;
  if (!out) return null;
  if (/INVALID SOURCE LANGUAGE|MYMEMORY WARNING/i.test(String(out))) return null;
  return String(out);
}

module.exports = {
  LANGS,
  normalizeLang,
  isSupportedLang,
  translateText
};
