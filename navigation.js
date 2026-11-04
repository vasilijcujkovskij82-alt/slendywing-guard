'use strict';

// Все тексты навигации лежат в content.json — их можно менять через редактор
// (файл "Редактор.bat" на рабочем столе).

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

function load() {
  try {
    const raw = fs.readFileSync(CONTENT_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.sections) return FALLBACK;
    return data;
  } catch (err) {
    console.log(`  [!] content.json не прочитан (${err.message}), использую заглушку.`);
    return FALLBACK;
  }
}

const data = load();

const SECTIONS = data.sections;

// Баннер карточки навигации (полноразмерная картинка снизу)
const BANNER_URL = typeof data.bannerUrl === 'string' ? data.bannerUrl : '';

// Цвет боковой полосы, в content.json хранится как "#262B64"
const SECTION_COLOR = (() => {
  const value = String(data.color || '#262B64').replace('#', '');
  const parsed = Number.parseInt(value, 16);
  return Number.isNaN(parsed) ? 0x262b64 : parsed;
})();

module.exports = { SECTIONS, BANNER_URL, SECTION_COLOR, CONTENT_PATH };
