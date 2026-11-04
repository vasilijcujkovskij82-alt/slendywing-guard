'use strict';

// Кнопки навигации: главная карточка и дополнительные кнопки внутри разделов.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const emojis = require('./emojis');

function makeButton({ customId, label, emoji }) {
  const text = String(label || '').toUpperCase();
  // Если в названии уже есть разделитель «│», оставляем как есть
  const caption = text.includes('│') ? text : `│ ${text}`;

  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(caption)
    .setStyle(ButtonStyle.Secondary);

  const parsed = emojis.forButton(emoji);
  if (parsed) button.setEmoji(parsed);

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
        const linkText = String(button.label || 'ССЫЛКА').toUpperCase();
        const link = new ButtonBuilder()
          .setLabel(linkText.includes('│') ? linkText : `│ ${linkText}`)
          .setStyle(ButtonStyle.Link)
          .setURL(button.target.slice(4));

        const parsed = emojis.forButton(button.emoji);
        if (parsed) link.setEmoji(parsed);
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

module.exports = { navRows, sectionRows };
