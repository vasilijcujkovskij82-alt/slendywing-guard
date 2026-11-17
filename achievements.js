'use strict';

// Раздел «Достижение» — меню достижений по Slendytubbies.
//
// Всё оформление лежит в achievements.json и перечитывается на лету:
//   /достижение -> главная карточка с меню выбора игры;
//   выбор игры  -> отдельная карточка с достижениями (только тому, кто выбрал).

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

const ACHIEVEMENTS_PATH = path.join(__dirname, 'achievements.json');
const DEFAULT_COLOR = 0x262b64;

const FALLBACK = {
  author: '༻𝐒𝐋𝐄𝐍𝐃𝐘𝐖𝐈𝐍𝐆༺',
  color: '#262B64',
  main: { text: '', thumbnail: '', image: '' },
  menu: { placeholder: '𝄢 │ Выбери игру', button: { label: '𝄢🔎│ПРОВЕРКА ДОСТИЖЕНИЙ', url: '' } },
  pages: {},
};

let cached = null;
let cachedMtimeMs = -1;

function read() {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(ACHIEVEMENTS_PATH).mtimeMs;
  } catch {
    return FALLBACK;
  }

  if (cached && mtimeMs === cachedMtimeMs) return cached;

  try {
    cached = JSON.parse(fs.readFileSync(ACHIEVEMENTS_PATH, 'utf8'));
    cachedMtimeMs = mtimeMs;
  } catch (err) {
    console.log(`  [!] achievements.json не прочитан (${err.message})`);
    return FALLBACK;
  }

  return cached;
}

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

function linkButton(data) {
  const button = data.menu?.button;
  if (!button?.url) return null;

  return new ButtonBuilder()
    .setLabel(String(button.label || '𝄢🔎│ПРОВЕРКА ДОСТИЖЕНИЙ').slice(0, 80))
    .setStyle(ButtonStyle.Link)
    .setURL(button.url);
}

function linkRow(data) {
  const button = linkButton(data);
  return button ? new ActionRowBuilder().addComponents(button) : null;
}

function author(data, interaction) {
  return {
    name: data.author || FALLBACK.author,
    iconURL: interaction.guild?.iconURL({ size: 256 }) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Главная карточка с меню выбора игры
// ---------------------------------------------------------------------------
function mainView(interaction) {
  const data = read();
  const main = data.main || FALLBACK.main;

  const embed = new EmbedBuilder()
    .setColor(parseColor(data.color))
    .setAuthor(author(data, interaction));

  if (main.text) embed.setDescription(emojis.resolve(main.text).slice(0, 4096));

  // Миниатюра — аватарка сервера SlendyWing (guild.iconUrl), как в макете.
  const thumbnail = interaction.guild?.iconURL({ size: 256 }) || main.thumbnail;
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (main.image) embed.setImage(main.image);

  const pages = Object.entries(data.pages || {}).filter(([, page]) => page && page.option);
  const components = [];

  if (pages.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('ach:select')
      .setPlaceholder(String(data.menu?.placeholder || FALLBACK.menu.placeholder).slice(0, 150))
      .addOptions(
        pages.slice(0, 25).map(([key, page]) => ({
          label: String(page.option || key).slice(0, 100),
          value: key,
        }))
      );

    components.push(new ActionRowBuilder().addComponents(select));
  }

  const row = linkRow(data);
  if (row) components.push(row);

  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

// ---------------------------------------------------------------------------
// Карточка достижений выбранной игры (без автора)
// ---------------------------------------------------------------------------
function pageView(interaction, key) {
  const data = read();
  const page = data.pages?.[key];
  if (!page) return mainView(interaction);

  const embed = new EmbedBuilder()
    .setColor(parseColor(page.color || data.color))
    .setDescription(emojis.resolve(page.text || '').slice(0, 4096));

  if (page.thumbnail) embed.setThumbnail(page.thumbnail);

  const row = linkRow(data);
  return {
    embeds: [embed],
    components: row ? [row] : [],
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Выбор игры: ответ виден только тому, кто выбрал
// ---------------------------------------------------------------------------
async function handleComponent(interaction) {
  if (!interaction.isStringSelectMenu()) return;

  const picked = interaction.values?.[0];
  if (!picked) return;

  await interaction.reply({
    ...pageView(interaction, picked),
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  ACHIEVEMENTS_PATH,
  mainView,
  pageView,
  handleComponent,
};
