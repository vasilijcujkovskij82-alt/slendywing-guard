'use strict';

// Все тексты навигации лежат в content.json — их можно менять через редактор
// (ярлык "EDITOR - SlendyWing" на рабочем столе).
//
// content.test.json — отдельная копия текстов для команды /тест.
// Её правки не затрагивают основную навигацию.
//
// Файлы перечитываются на лету: если файл изменился, бот подхватит
// новый текст без перезапуска.

const fs = require('node:fs');
const path = require('node:path');

const CONTENT_PATH = path.join(__dirname, 'content.json');
const TEST_CONTENT_PATH = path.join(__dirname, 'content.test.json');

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

// Кэш на каждый файл отдельно
const cache = new Map(); // filePath -> { data, mtimeMs }

function readFile(filePath) {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    return FALLBACK;
  }

  const cached = cache.get(filePath);
  if (cached && mtimeMs === cached.mtimeMs) return cached.data;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object' || !data.sections) throw new Error('нет поля sections');
    cache.set(filePath, { data, mtimeMs });
    return data;
  } catch (err) {
    console.log(`  [!] ${path.basename(filePath)} не прочитан (${err.message}), использую заглушку.`);
    return cached ? cached.data : FALLBACK;
  }
}

function parseColor(value) {
  const hex = String(value || '#262B64').replace('#', '');
  const parsed = Number.parseInt(hex, 16);
  return Number.isNaN(parsed) ? 0x262b64 : parsed;
}

function banner(filePath) {
  const value = readFile(filePath).bannerUrl;
  return typeof value === 'string' ? value : '';
}

// Геттеры читают файл при каждом обращении — правки в редакторе применяются сразу
module.exports = {
  CONTENT_PATH,
  TEST_CONTENT_PATH,

  // Основная навигация (/навигация)
  get SECTIONS() {
    return readFile(CONTENT_PATH).sections;
  },
  get BANNER_URL() {
    return banner(CONTENT_PATH);
  },
  get SECTION_COLOR() {
    return parseColor(readFile(CONTENT_PATH).color);
  },

  // Тестовая навигация (/тест) — отдельный файл
  get TEST_SECTIONS() {
    return readFile(TEST_CONTENT_PATH).sections;
  },
  get TEST_BANNER_URL() {
    return banner(TEST_CONTENT_PATH);
  },
  get TEST_SECTION_COLOR() {
    return parseColor(readFile(TEST_CONTENT_PATH).color);
  },
};
