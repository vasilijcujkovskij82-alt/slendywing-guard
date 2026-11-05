'use strict';

// Кнопки навигации: главная карточка и дополнительные кнопки внутри разделов.
//
// Подпись строится так:  ༻<эмодзи>│ НАЗВАНИЕ
// Эмодзи ставится внутрь подписи, а не в отдельное поле кнопки —
// так он стоит ровно между «༻» и «│», как в оформлении сервера.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const emojis = require('./emojis');

// Кастомные эмодзи (<:name:id> или :name:) внутрь подписи не поставить —
// Discord рисует их только отдельным полем кнопки.
function isCustomEmoji(value) {
  const text = String(value || '').trim();
  return /^<a?:[^>]+>$/.test(text) || /^:[a-zA-Z0-9_]{2,32}:$/.test(text);
}

function buildLabel(label, emoji) {
  const text = String(label || '').toUpperCase();
  if (text.includes('│')) return { caption: text, emoji: null };

  if (emoji && !isCustomEmoji(emoji)) {
    return { caption: `༻${String(emoji).trim()}│ ${text}`, emoji: null };
  }

  return { caption: `༻│ ${text}`, emoji: emoji || null };
}

function makeButton({ customId, label, emoji }) {
  const { caption, emoji: fallback } = buildLabel(label, emoji);

  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(caption)
    .setStyle(ButtonStyle.Secondary);

  if (fallback) {
    const parsed = emojis.forButton(fallback);
    if (parsed) button.setEmoji(parsed);
  }

  return button;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Кнопки главной карточки: все разделы, кроме hidden */
function navRows(sections) {
  const entries = Object.entries(sections || {}).filter(([, section]) => !section?.hidden);
  const buttons = entries.slice(0, 20).map(([key, section]) =>
    makeButton({ customId: `nav:${key}`, label: section.label || key, emoji: section.emoji })
  );

  return chunk(buttons, 5).map((group) => new ActionRowBuilder().addComponents(group));
}

/**
 * Дополнительные кнопки внутри раздела.
 * В content.json это поле buttons: [{ "label": "ДОСКА ПОЧЕТА", "emoji": "🎖", "target": "honor" }]
 */
function sectionRows(section, sections) {
  const list = Array.isArray(section?.buttons) ? section.buttons : [];
  if (list.length === 0) return [];

  const buttons = list
    .filter((button) => button && button.target && (sections?.[button.target] || button.target.startsWith('url:')))
    .slice(0, 5)
    .map((button) => {
      if (button.target.startsWith('url:')) {
        const { caption, emoji: fallback } = buildLabel(button.label || 'ССЫЛКА', button.emoji);
        const link = new ButtonBuilder()
          .setLabel(caption)
          .setStyle(ButtonStyle.Link)
          .setURL(button.target.slice(4));

        if (fallback) {
          const parsed = emojis.forButton(fallback);
          if (parsed) link.setEmoji(parsed);
        }
        return link;
      }

      return makeButton({
        customId: `nav:${button.target}`,
        label: button.label || sections[button.target]?.label,
        emoji: button.emoji || sections[button.target]?.emoji,
      });
    });

  return buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
}

module.exports = { navRows, sectionRows, buildLabel };
