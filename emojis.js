'use strict';

// Поддержка кастомных эмодзи из других серверов.
//
// В текстах можно писать коротко:  :smug:  или  :necoarclumina:
// Бот сам подставит полный вид <:smug:1234567890>, и Discord покажет картинку.
//
// Откуда берутся эмодзи:
//   1. Эмодзи приложения (application emojis) — работают на любом сервере;
//   2. Эмодзи всех серверов, где стоит бот;
//   3. Файл emojis.json — ручные соответствия для эмодзи с чужих серверов.
//
// Формат emojis.json:
//   {
//     "smug": "123456789012345678",
//     "necoarclumina": "a:987654321098765432"
//   }
//   "a:" в начале означает анимированный эмодзи.

const fs = require('node:fs');
const path = require('node:path');

const MAP_PATH = path.join(__dirname, 'emojis.json');
const REFRESH_MS = 10 * 60 * 1000;

/** name (в нижнем регистре) -> { id, name, animated } */
let cache = new Map();
let lastRefresh = 0;

function normalizeName(name) {
  return String(name).toLowerCase();
}

function readManual() {
  const map = new Map();
  let raw;
  try {
    raw = fs.readFileSync(MAP_PATH, 'utf8');
  } catch {
    return map;
  }

  try {
    const data = JSON.parse(raw);
    for (const [name, value] of Object.entries(data || {})) {
      if (!name || typeof value !== 'string') continue;

      // Поддерживаем три формы: "id", "a:id" и готовый "<:name:id>"
      const full = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d+)>$/.exec(value.trim());
      if (full) {
        map.set(normalizeName(name), { id: full[3], name: full[2], animated: full[1] === 'a' });
        continue;
      }

      const plain = /^(a)?:?(\d{10,25})$/.exec(value.trim());
      if (plain) {
        map.set(normalizeName(name), { id: plain[2], name, animated: !!plain[1] });
      }
    }
  } catch (err) {
    console.log(`  [!] emojis.json не прочитан (${err.message})`);
  }

  return map;
}

function addEmoji(map, emoji) {
  if (!emoji || !emoji.id || !emoji.name) return;

  const key = normalizeName(emoji.name);
  if (map.has(key)) return; // первый источник выигрывает

  map.set(key, {
    id: emoji.id,
    name: emoji.name,
    animated: Boolean(emoji.animated),
  });
}

/** Собирает эмодзи приложения и всех серверов бота */
async function refresh(client, { force = false } = {}) {
  if (!force && Date.now() - lastRefresh < REFRESH_MS) return cache;
  lastRefresh = Date.now();

  const map = new Map();

  // 1. Эмодзи приложения — работают везде, где есть бот
  try {
    const appEmojis = await client.application.emojis.fetch();
    for (const emoji of appEmojis.values()) addEmoji(map, emoji);
  } catch (err) {
    console.log(`  [!] Эмодзи приложения не получены: ${err.message}`);
  }

  // 2. Эмодзи серверов, где стоит бот
  for (const guild of client.guilds.cache.values()) {
    try {
      if (guild.emojis.cache.size === 0) await guild.emojis.fetch();
    } catch {
      // нет доступа — пропускаем
    }
    for (const emoji of guild.emojis.cache.values()) addEmoji(map, emoji);
  }

  // 3. Ручные соответствия из emojis.json — главнее всего
  for (const [name, emoji] of readManual()) {
    map.set(name, emoji);
  }

  cache = map;
  return cache;
}

function get(name) {
  return cache.get(normalizeName(name)) || null;
}

/**
 * Заменяет :name: на <:name:id>, если такой эмодзи известен.
 * Не трогает уже готовые <:name:id>, ссылки и прочие <...>.
 */
function resolve(text) {
  if (typeof text !== 'string' || text.length === 0 || cache.size === 0) return text;

  return text
    .split(/(<[^>]*>)/) // чётные куски — обычный текст, нечётные — уже готовые <...>
    .map((chunk, index) => {
      if (index % 2 === 1) return chunk;
      return chunk.replace(/:([a-zA-Z0-9_]{2,32}):/g, (whole, name) => {
        const emoji = cache.get(normalizeName(name));
        if (!emoji) return whole;
        return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
      });
    })
    .join('');
}

/**
 * Приводит значение поля "эмодзи" к виду, понятному ButtonBuilder.setEmoji.
 * Понимает :name:, <:name:id>, <a:name:id> и обычный юникод.
 */
function forButton(value) {
  if (!value) return null;

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const full = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d+)>$/.exec(trimmed);
  if (full) return { animated: full[1] === 'a', name: full[2], id: full[3] };

  const short = /^:([a-zA-Z0-9_]{2,32}):$/.exec(trimmed);
  if (short) {
    const emoji = cache.get(normalizeName(short[1]));
    return emoji ? { animated: emoji.animated, name: emoji.name, id: emoji.id } : null;
  }

  return trimmed; // юникод-эмодзи
}

/** Ищет emoji в тексте, чтобы предупредить о ненайденных :name: */
function missing(text) {
  if (typeof text !== 'string') return [];
  const found = new Set();

  for (const chunk of text.split(/(<[^>]*>)/).filter((_, i) => i % 2 === 0)) {
    for (const match of chunk.matchAll(/:([a-zA-Z0-9_]{2,32}):/g)) {
      if (!cache.has(normalizeName(match[1]))) found.add(match[1]);
    }
  }

  return [...found];
}

function size() {
  return cache.size;
}

function names() {
  return [...cache.keys()].sort();
}

module.exports = { refresh, resolve, forButton, missing, get, size, names, MAP_PATH };
