'use strict';

// Все тексты навигации лежат в content.json — их можно менять через редактор
// (ярлык "EDITOR - SlendyWing" на рабочем столе).
//
// Файл перечитывается на лету: если content.json изменился, бот подхватит
// новый текст без перезапуска.

const fs = require('node:fs');
const path = require('node:path');

const CONTENT_PATH = path.join(__dirname, 'content.json');

const FALLBACK = {
  color: '#262B64',
  bannerUrl: '',
  sections: {
    rules: { label: 'ПРАВИЛА', emoji: '📚', title: '', text: 'Правила пока не заполнены.', image: '' },
    violations: { label: 'НАРУШЕНИЯ', emoji: '🚫', title: '', text: 'Раздел пока не заполнен.', image: '' },
    roles: { label: 'РОЛИ', emoji: '🎭', title: '', text: 'Раздел пока не заполнен.', image: '' },
    about: { label: 'O SLENDYWING', emoji: '❔', title: '', text: 'Раздел пока не заполнен.', image: '' },
  },
};

let cached = null;
let cachedMtimeMs = -1;

function readFile() {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(CONTENT_PATH).mtimeMs;
  } catch {
    return FALLBACK;
  }

  if (cached && mtimeMs === cachedMtimeMs) return cached;

  try {
    const data = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
    if (!data || typeof data !== 'object' || !data.sections) throw new Error('нет поля sections');
    cached = data;
    cachedMtimeMs = mtimeMs;
    return data;
  } catch (err) {
    console.log(`  [!] content.json не прочитан (${err.message}), использую заглушку.`);
    return FALLBACK;
  }
}

function parseColor(value) {
  const hex = String(value || '#262B64').replace('#', '');
  const parsed = Number.parseInt(hex, 16);
  return Number.isNaN(parsed) ? 0x262b64 : parsed;
}

// Геттеры читают файл при каждом обращении — правки в редакторе применяются сразу
module.exports = {
  CONTENT_PATH,
  get SECTIONS() {
    return readFile().sections;
  },
  get BANNER_URL() {
    const value = readFile().bannerUrl;
    return typeof value === 'string' ? value : '';
  },
  get SECTION_COLOR() {
    return parseColor(readFile().color);
  },
};
