'use strict';

const PHONE_09 = /(?<!\d)09[\s\-.]?\d{5,11}(?!\d)/;
const COMPACT_09 = /(?<!\d)09\d{7,11}(?!\d)/;

function normalizeForPhoneScan(text) {
  return String(text || '').replace(/[\s\-.]/g, '');
}

function messageFilterError(text) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (!trimmed) return 'Message cannot be empty.';
  if (trimmed.startsWith('@')) {
    return 'Messages cannot start with @.';
  }
  if (PHONE_09.test(trimmed) || COMPACT_09.test(normalizeForPhoneScan(trimmed))) {
    return 'Myanmar phone numbers starting with 09 cannot be sent.';
  }
  return null;
}

function isAllowedImageMime(mime) {
  return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(String(mime || '').toLowerCase());
}

function isAllowedVoiceMime(mime) {
  const m = String(mime || '').toLowerCase();
  return m.startsWith('audio/') || m === 'video/webm';
}

function isForbiddenVideo(mime, originalName = '') {
  const m = String(mime || '').toLowerCase();
  const name = String(originalName || '').toLowerCase();
  if (m.startsWith('audio/')) return false;
  if (m === 'video/webm') return false;
  if (m.startsWith('video/')) return true;
  if (/\.(mp4|mov|avi|mkv|m4v)$/i.test(name)) return true;
  return false;
}

module.exports = {
  messageFilterError,
  isAllowedImageMime,
  isAllowedVoiceMime,
  isForbiddenVideo
};
