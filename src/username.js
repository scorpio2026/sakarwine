'use strict';

const USERNAME_RE = /^(?:[A-Za-z0-9\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]){1,12}$/;
const USERNAME_ERROR =
  'Username must be 1–12 letters and numbers only (English or Myanmar). No spaces or symbols.';

function usernameError(name) {
  const s = String(name == null ? '' : name).trim();
  if (!USERNAME_RE.test(s)) return USERNAME_ERROR;
  return null;
}

module.exports = {
  USERNAME_RE,
  USERNAME_ERROR,
  usernameError
};
