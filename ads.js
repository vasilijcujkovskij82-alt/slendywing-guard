'use strict';

// Реклама (/пиар) — порт команды «Реклама» из JuniperBot.
//
// Всё оформление лежит в ads.json и перечитывается на лету:
//   /пиар -> главная карточка с кнопкой «➕»;
//   «➕»   -> окно с полями «Ссылка», «Описание», «Изображение»;
//   отправка -> публикация с автором-отправителем и кнопками «➕» и «🗑️»;
//   «🗑️»  -> удаление публикации автором или модератором.

const fs = require('node:fs');
const path = require('node:path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const emojis = require('./emojis');

const ADS_PATH = path.join(__dirname, 'ads.json');

const FALLBACK = {
  color: '#262B64',
  author: '༻𝐒𝐋𝐄𝐍𝐃𝐘𝐖𝐈𝐍𝐆༺',
  main: { text: 'Меню рекламы пока не заполнено.', image: '' },
  button: { label: '➕' },
  deleteButton: { emoji: '🗑️' },
  modal: {
    title: 'Реклама',
    linkLabel: 'Ссылка',
    descriptionLabel: 'Описание',
    imageLabel: 'Изображение',
  },
  publication: { text: '# ༻ 🎖️│ {link}\n## 𝄢👤│ {member}\n\n{description}' },
  moderatorRoles: [],
  publishedText: 'Реклама опубликована 👇',
  deletedText: 'Реклама удалена.',
  deniedText: '### Ошибка доступа',
};

let cached = null;
let cachedMtimeMs = -1;

function read() {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(ADS_PATH).mtimeMs;
  } catch {
    return FALLBACK;
  }

  if (cached && mtimeMs === cachedMtimeMs) return cached;

  try {
    const data = JSON.parse(fs.readFileSync(ADS_PATH, 'utf8'));
    if (!data || typeof data !== 'object' || !data.main) throw new Error('нет поля main');
    cached = data;
    cachedMtimeMs = mtimeMs;
    return data;
  } catch (err) {
    console.log(`  [!] ads.json не прочитан (${err.message}), использую предыдущие тексты.`);
    return cached || FALLBACK;
  }
}

function parseColor(value) {
  const hex = String(value || '#262B64').replace('#', '');
  const parsed = Number.parseInt(hex, 16);
  return Number.isNaN(parsed) ? 0x262b64 : parsed;
}

// {link}, {member}, {description}, {image}, {username}, {displayName}
function fillTemplate(template, values) {
  return String(template || '').replace(
    /\{(link|member|description|image|username|displayName)\}/g,
    (whole, key) => (values[key] == null ? '' : String(values[key]))
  );
}

function validImageUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function createButton(data) {
  const label = String(data.button?.label || '➕').slice(0, 80) || '➕';
  return new ButtonBuilder().setCustomId('adcreate').setLabel(label).setStyle(ButtonStyle.Secondary);
}

function deleteButton(data, authorId) {
  const value = String(data.deleteButton?.emoji || '🗑️').trim() || '🗑️';
  const button = new ButtonBuilder()
    .setCustomId(`addelete:${authorId}`)
    .setStyle(ButtonStyle.Danger);

  const parsed = emojis.forButton(value);
  if (parsed) button.setEmoji(parsed);
  else button.setLabel(value.slice(0, 80) || 'Удалить');

  return button;
}

// ---------------------------------------------------------------------------
// Главная карточка
// ---------------------------------------------------------------------------
function mainView(interaction) {
  const data = read();
  const icon = interaction.guild?.iconURL({ size: 256 }) ?? undefined;

  const embed = new EmbedBuilder()
    .setColor(parseColor(data.color))
    .setAuthor({
      name: data.author || FALLBACK.author,
      iconURL: icon,
    })
    .setDescription(emojis.resolve(String(data.main?.text || FALLBACK.main.text)));

  // Миниатюрная аватарка сервера — только на главной карточке
  if (icon) embed.setThumbnail(icon);
  if (data.main?.image) embed.setImage(data.main.image);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(createButton(data))],
  };
}

// ---------------------------------------------------------------------------
// Окно создания рекламы
// ---------------------------------------------------------------------------
async function openModal(interaction) {
  const data = read();
  const modalData = data.modal || {};

  const modal = new ModalBuilder()
    .setCustomId('admodal')
    .setTitle(String(modalData.title || 'Реклама').slice(0, 45) || 'Реклама');

  const link = new TextInputBuilder()
    .setCustomId('ad_link')
    .setLabel(String(modalData.linkLabel || 'Ссылка').slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(500);

  const description = new TextInputBuilder()
    .setCustomId('ad_description')
    .setLabel(String(modalData.descriptionLabel || 'Описание').slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);

  const image = new TextInputBuilder()
    .setCustomId('ad_image')
    .setLabel(String(modalData.imageLabel || 'Изображение').slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500)
    .setPlaceholder('https://... (необязательно)');

  modal.addComponents(
    new ActionRowBuilder().addComponents(link),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(image)
  );

  await interaction.showModal(modal);
}

// ---------------------------------------------------------------------------
// Публикация
// ---------------------------------------------------------------------------
function publicationView(interaction, { link, description, image }) {
  const data = read();
  const member = interaction.member;
  const user = interaction.user;

  const username = user?.username || 'участник';
  const displayName = member?.displayName || username;
  const avatar = member?.displayAvatarURL?.({ size: 128 }) || user?.displayAvatarURL?.({ size: 128 });

  const text = fillTemplate(data.publication?.text || FALLBACK.publication.text, {
    link: link || '—',
    member: user?.id ? `<@${user.id}>` : displayName,
    description: description || '',
    image: image || '',
    username,
    displayName,
  });

  const embed = new EmbedBuilder()
    .setColor(parseColor(data.color))
    // Автор публикации — тот, кто её отправил, а не SlendyWing
    .setAuthor({ name: username, iconURL: avatar })
    .setDescription(emojis.resolve(text).slice(0, 4096));

  // Картинка из поля «Изображение» — только в самой публикации
  if (image && validImageUrl(image)) embed.setImage(image);

  const row = new ActionRowBuilder().addComponents(
    createButton(data),
    deleteButton(data, user.id)
  );

  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function submitAd(interaction) {
  const data = read();

  const link = interaction.fields.getTextInputValue('ad_link').trim();
  const description = interaction.fields.getTextInputValue('ad_description').trim();
  const image = interaction.fields.getTextInputValue('ad_image').trim();

  if (!link || !description) {
    await interaction.reply({
      content: 'Заполни ссылку и описание.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: data.publishedText || FALLBACK.publishedText,
    flags: MessageFlags.Ephemeral,
  });

  await interaction.channel.send(publicationView(interaction, { link, description, image }));
}

// ---------------------------------------------------------------------------
// Удаление публикации
// ---------------------------------------------------------------------------
async function deleteAd(interaction, authorId) {
  const data = read();
  const member = interaction.member;

  const isAuthor = interaction.user?.id === authorId;
  const isModerator =
    Array.isArray(data.moderatorRoles) &&
    data.moderatorRoles.some((id) => member?.roles?.cache?.has(id));

  if (!isAuthor && !isModerator) {
    await interaction.reply({
      content: data.deniedText || FALLBACK.deniedText,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: data.deletedText || FALLBACK.deletedText,
    flags: MessageFlags.Ephemeral,
  });
  await interaction.message.delete().catch(() => {});
}

module.exports = {
  ADS_PATH,
  mainView,
  openModal,
  submitAd,
  deleteAd,
};
