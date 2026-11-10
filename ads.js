'use strict';

// Реклама (/пиар) — порт команды «Реклама» из JuniperBot.
//
// Всё оформление лежит в ads.json и перечитывается на лету:
//   /пиар -> главная карточка с кнопкой «➕»;
//   «➕»   -> окно «Оформите пост»: ссылка, описание и файл (фото или видео);
//   отправка -> сообщение со ссылкой и автором + карточка с описанием и файлом;
//   «🗑️»  -> удаление публикации автором или модератором (без лишних сообщений).

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
  LabelBuilder,
  FileUploadBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');

const emojis = require('./emojis');

const ADS_PATH = path.join(__dirname, 'ads.json');
const DEFAULT_COLOR = 0x262b64;

const FALLBACK = {
  color: '#262B64',
  author: '༻𝐒𝐋𝐄𝐍𝐃𝐘𝐖𝐈𝐍𝐆༺',
  main: { text: 'Меню рекламы пока не заполнено.', image: '' },
  button: { label: '➕' },
  deleteButton: { emoji: '🗑️' },
  modal: {
    title: 'Оформите пост',
    linkLabel: 'Ссылка',
    descriptionLabel: 'Описание',
    fileLabel: 'Фото или видео',
  },
  publication: { text: '# ༻ 🎖️│ {link}\n## 𝄢👤│ {member}' },
  moderatorRoles: [],
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

// Цвет рамки: hex («#262B64») или RGB («38 43 100»).
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

// {link}, {member}, {description}, {image}, {username}, {displayName}
function fillTemplate(template, values) {
  return String(template || '').replace(
    /\{(link|member|description|image|username|displayName)\}/g,
    (whole, key) => (values[key] == null ? '' : String(values[key]))
  );
}

function safeFileName(name, index) {
  const original = String(name || `file-${index}`).trim();
  const extMatch = original.match(/(\.[A-Za-z0-9]{1,8})$/);
  const ext = extMatch ? extMatch[1] : '';
  const base =
    original
      .slice(0, original.length - ext.length)
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '') || `file-${index}`;

  return `${base.slice(-60)}${ext}`;
}

function isImageFile(file) {
  const type = String(file?.type || '');
  if (type.startsWith('image/')) return true;
  if (type) return false;
  return /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(String(file?.name || ''));
}

async function downloadUploadedFiles(interaction) {
  let uploaded = null;
  try {
    uploaded = interaction.fields.getUploadedFiles('ad_file');
  } catch {
    uploaded = null;
  }

  if (!uploaded || uploaded.size === 0) return [];

  const files = [];
  for (const attachment of uploaded.values()) {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      files.push({
        attachment: buffer,
        name: safeFileName(attachment.name, files.length + 1),
        type: String(attachment.contentType || ''),
      });
    } catch (err) {
      console.log(`  [!] Не удалось получить файл «${attachment.name}»: ${err.message}`);
    }
  }

  return files;
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
    .setTitle(String(modalData.title || FALLBACK.modal.title).slice(0, 45) || FALLBACK.modal.title);

  const link = new LabelBuilder()
    .setLabel(String(modalData.linkLabel || FALLBACK.modal.linkLabel).slice(0, 45))
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId('ad_link')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(500)
    );

  const description = new LabelBuilder()
    .setLabel(String(modalData.descriptionLabel || FALLBACK.modal.descriptionLabel).slice(0, 45))
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId('ad_description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000)
    );

  const file = new LabelBuilder()
    .setLabel(String(modalData.fileLabel || FALLBACK.modal.fileLabel).slice(0, 45))
    .setFileUploadComponent(
      new FileUploadBuilder()
        .setCustomId('ad_file')
        .setRequired(false)
        .setMaxValues(1)
    );

  modal.addComponents(link, description, file);

  await interaction.showModal(modal);
}

// ---------------------------------------------------------------------------
// Публикация
// ---------------------------------------------------------------------------
function publicationView(interaction, { link, description, uploaded = [] }) {
  const data = read();
  const member = interaction.member;
  const user = interaction.user;

  const username = user?.username || 'участник';
  const displayName = member?.displayName || username;
  const avatar = member?.displayAvatarURL?.({ size: 128 }) || user?.displayAvatarURL?.({ size: 128 });

  // Ссылка и автор — обычным текстом над карточкой, как в JuniperBot
  const text = fillTemplate(data.publication?.text || FALLBACK.publication.text, {
    link: link || '—',
    member: user?.id ? `<@${user.id}>` : displayName,
    description: description || '',
    image: '',
    username,
    displayName,
  });

  const embed = new EmbedBuilder()
    .setColor(parseColor(data.color))
    // Автор карточки — тот, кто отправил рекламу
    .setAuthor({ name: username, iconURL: avatar })
    .setDescription(emojis.resolve(description || '').slice(0, 4096));

  // Фото с устройства показываем в карточке, видео — вложением под ней
  const uploadedImage = uploaded.find(isImageFile);
  if (uploadedImage) embed.setImage(`attachment://${uploadedImage.name}`);

  const row = new ActionRowBuilder().addComponents(
    createButton(data),
    deleteButton(data, user.id)
  );

  const content = emojis.resolve(text).slice(0, 2000);
  const payload = {
    content: content || undefined,
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [] },
  };
  if (uploaded.length) {
    payload.files = uploaded.map(
      (file) => new AttachmentBuilder(file.attachment, { name: file.name })
    );
  }

  return payload;
}

async function submitAd(interaction) {
  const link = interaction.fields.getTextInputValue('ad_link').trim();
  const description = interaction.fields.getTextInputValue('ad_description').trim();

  if (!link || !description) {
    await interaction.reply({
      content: 'Заполни ссылку и описание.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Подтверждаем окно без «SlendyWing думает» — просто закрываем его
  let usedReply = false;
  try {
    await interaction.deferUpdate();
  } catch {
    usedReply = true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  try {
    const uploaded = await downloadUploadedFiles(interaction);
    if (usedReply) await interaction.deleteReply().catch(() => {});
    await interaction.channel.send(
      publicationView(interaction, { link, description, uploaded })
    );
  } catch (err) {
    if (usedReply) await interaction.deleteReply().catch(() => {});
    await interaction
      .followUp({
        content: `Не удалось опубликовать: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
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

  // Без текста: подтверждаем нажатие и удаляем само сообщение с рекламой
  await interaction.deferUpdate();
  await interaction.message.delete().catch(() => {});
}

module.exports = {
  ADS_PATH,
  mainView,
  openModal,
  submitAd,
  deleteAd,
};
