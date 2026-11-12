'use strict';

// Раздел «Игры» — каталог игр по Slendytubbies.
//
// Всё оформление лежит в games.json и перечитывается на лету:
//   /игры -> главная карточка с категориями;
//   категория -> список игр;
//   игра -> описание, ссылки и кнопка проверки достижений;
//   проверка достижений -> отдельная карточка «есть» или «нету».

const fs = require('node:fs');
const path = require('node:path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const emojis = require('./emojis');

const GAMES_PATH = path.join(__dirname, 'games.json');
const DEFAULT_COLOR = 0x262b64;

const FALLBACK = {
  author: '༻𝐒𝐋𝐄𝐍𝐃𝐘𝐖𝐈𝐍𝐆༺',
  color: '#262B64',
  main: { image: '', buttons: [] },
  categories: {},
  games: {},
  achievements: {},
};

let cached = null;
let cachedMtimeMs = -1;

function read() {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(GAMES_PATH).mtimeMs;
  } catch {
    return FALLBACK;
  }

  if (cached && mtimeMs === cachedMtimeMs) return cached;

  try {
    const data = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));
    if (!data || typeof data !== 'object' || !data.games) throw new Error('нет поля games');
    cached = data;
    cachedMtimeMs = mtimeMs;
    return data;
  } catch (err) {
    console.log(`  [!] games.json не прочитан (${err.message}), использую предыдущие тексты.`);
    return cached || FALLBACK;
  }
}

// Цвет рамки: hex («#262B64») или RGB («152 115 255»).
function parseColor(value, fallback = DEFAULT_COLOR) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;

  if (/^#?[0-9a-fA-F]{6}$/.test(text)) {
    return Number.parseInt(text.replace('#', ''), 16);
  }

  const parts = text
    .split(/[^0-9]+/)
    .filter(Boolean)
    .slice(0, 3);

  if (parts.length === 3) {
    const rgb = parts.map((part) => Math.max(0, Math.min(255, Number.parseInt(part, 10))));
    if (rgb.every(Number.isFinite)) return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
  }

  return fallback;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function button(label, customId) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(String(label || '').slice(0, 80))
    .setStyle(ButtonStyle.Secondary);
}

function rowsFrom(buttons) {
  return chunk(buttons, 5).map((group) => new ActionRowBuilder().addComponents(group));
}

function author(data, interaction) {
  return {
    name: data.author || FALLBACK.author,
    iconURL: interaction.guild?.iconURL({ size: 256 }) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Главная карточка
// ---------------------------------------------------------------------------
function mainView(interaction) {
  const data = read();
  const main = data.main || FALLBACK.main;

  const embed = new EmbedBuilder()
    .setColor(parseColor(data.color))
    .setAuthor(author(data, interaction));

  if (main.text) embed.setDescription(emojis.resolve(main.text).slice(0, 4096));
  if (main.image) embed.setImage(main.image);

  const buttons = (main.buttons || [])
    .filter((item) => item && item.target)
    .map((item) => button(item.label, `games:cat:${item.target}`));

  return { embeds: [embed], components: rowsFrom(buttons) };
}

// ---------------------------------------------------------------------------
// Категория: официальные и фанатские игры
// ---------------------------------------------------------------------------
function categoryView(interaction, key) {
  const data = read();
  const category = data.categories?.[key];
  if (!category) return mainView(interaction);

  const description = [`# ${category.title || category.label || key}`, category.text || '']
    .filter(Boolean)
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(parseColor(category.color || data.color))
    .setAuthor(author(data, interaction))
    .setDescription(emojis.resolve(description).slice(0, 4096));

  const gameKeys = (category.games || []).filter((gameKey) => {
    const game = data.games?.[gameKey];
    return game && !game.parent;
  });

  let components = [];
  if (gameKeys.length) {
    const options = gameKeys.slice(0, 25).map((gameKey) => {
      const game = data.games[gameKey];
      return {
        label: String(game.label || gameKey).slice(0, 100),
        value: gameKey,
      };
    });

    components = [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('games:select')
          .setPlaceholder('𝄢 │ Выбери игру')
          .addOptions(options)
      ),
    ];
  }

  return { embeds: [embed], components };
}

// ---------------------------------------------------------------------------
// Страница игры
// ---------------------------------------------------------------------------
function gameView(interaction, key) {
  const data = read();
  const game = data.games?.[key];
  if (!game) return mainView(interaction);

  const embed = new EmbedBuilder()
    .setColor(parseColor(game.color || data.color))
    .setDescription(emojis.resolve(game.text || '').slice(0, 4096));

  if (game.thumbnail) embed.setThumbnail(game.thumbnail);
  if (game.image) embed.setImage(game.image);

  const check = button(
    '𝄢 🔎│ ПРОВЕРКА НА НАЛИЧИЕ ДОСТИЖЕНИЙ',
    `games:check:${key}`
  );

  // Под-игры (например, Ø Records у Ø и ST2DR Forever у 2D Revolution)
  const childButtons = Object.entries(data.games || {})
    .filter(([, item]) => item && item.parent === key)
    .map(([childKey, child]) => button(child.label || childKey, `games:game:${childKey}`));

  return {
    embeds: [embed],
    components: rowsFrom([...childButtons, check]),
  };
}

// ---------------------------------------------------------------------------
// Проверка достижений (ответ только тому, кто нажал)
// ---------------------------------------------------------------------------
function achievementView(interaction, key) {
  const data = read();
  const game = data.games?.[key];
  const state = game?.achievements === 'yes' ? 'yes' : 'no';
  const achievement = data.achievements?.[state];
  if (!achievement) return null;

  const embed = new EmbedBuilder()
    .setColor(parseColor(achievement.color || data.color))
    .setDescription(emojis.resolve(achievement.text || '').slice(0, 4096));

  if (achievement.thumbnail) embed.setThumbnail(achievement.thumbnail);
  if (achievement.image) embed.setImage(achievement.image);

  const payload = {
    embeds: [embed],
    allowedMentions: { parse: [] },
    flags: MessageFlags.Ephemeral,
  };

  if (state === 'yes' && achievement.link?.url) {
    const link = new ButtonBuilder()
      .setLabel(String(achievement.link.label || '𝄢🎖️│ДОСТИЖЕНИЯ').slice(0, 80))
      .setStyle(ButtonStyle.Link)
      .setURL(achievement.link.url);

    payload.components = [new ActionRowBuilder().addComponents(link)];
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Кнопки: любой ответ виден только тому, кто нажал (эфермерное сообщение)
// ---------------------------------------------------------------------------
async function handleButton(interaction) {
  const parts = String(interaction.customId || '').split(':');
  const action = parts[1];
  const key = parts.slice(2).join(':');

  const ephemeral = (payload) => ({
    ...payload,
    allowedMentions: { parse: [] },
    flags: MessageFlags.Ephemeral,
  });

  if (action === 'main' || !action) {
    await interaction.reply(ephemeral(mainView(interaction)));
    return;
  }

  if (action === 'cat') {
    await interaction.reply(ephemeral(categoryView(interaction, key)));
    return;
  }

  if (action === 'select') {
    const picked = interaction.values?.[0];
    if (!picked) return;
    await interaction.reply(ephemeral(gameView(interaction, picked)));
    return;
  }

  if (action === 'game') {
    await interaction.reply(ephemeral(gameView(interaction, key)));
    return;
  }

  if (action === 'check') {
    const payload = achievementView(interaction, key);
    if (!payload) return;
    await interaction.reply(payload);
  }
}

module.exports = {
  GAMES_PATH,
  mainView,
  categoryView,
  gameView,
  achievementView,
  handleButton,
};
