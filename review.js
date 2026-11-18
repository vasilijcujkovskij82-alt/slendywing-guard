'use strict';

// Проверка достижений (/првдостижений) — копия механики рекламы (/пиар).
//
// Всё оформление лежит в review.json и перечитывается на лету:
//   /првдостижений -> главная карточка с кнопкой «➕»;
//   «➕»           -> окно «Выставите достижение на проверку»: название, ссылка на видео и файлы (до 4);
//   отправка      -> ответ на сообщение с «➕»: название и автор, ссылка на видео и сетка фото/видео в рамке;
//   «🗑️»         -> удаление публикации автором или модератором (без лишних сообщений).
//
// Реакции лайка/дизлайка сюда не добавляются.

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
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  FileBuilder,
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const emojis = require('./emojis');

const REVIEW_PATH = path.join(__dirname, 'review.json');
const DEFAULT_COLOR = 0x262b64;
// id строки статуса: по нему «✅» и «❌» находят, что заменить
const STATUS_ID = 777;

const FALLBACK = {
  color: '#262B64',
  author: '༻𝐒𝐋𝐄𝐍𝐃𝐘𝐖𝐈𝐍𝐆༺',
  main: { text: 'Проверка достижений пока не заполнена.', image: '' },
  button: { label: '➕' },
  deleteButton: { emoji: '🗑️' },
  modal: {
    title: 'Выставите достижение на проверку',
    linkLabel: 'название достижение',
    descriptionLabel: 'Ссылка на видео (если файл весит больше 50 МБ)',
    fileLabel: 'Фото или видео',
  },
  publication: {
    text: '# ༻ 🎖️ │ {link}\n## 𝄢 👤 │ {member}',
    description: '## ༻ 📁 │ {description}',
  },
  status: {
    pending: '## ༻ ➖ │ На рассмотрении',
    accepted: '## ༻ ✅ │ Принято',
    rejected: '## ༻ ❌ │ Отклонено',
  },
  thread: { name: 'Обсуждение', autoArchiveDuration: 1440 },
  moderatorRoles: [],
  deniedText: '### Ошибка доступа',
};

// Ветки, созданные ботом под публикациями. Нужны, чтобы удалять только свои
// системные сообщения «ветка создана» и не трогать чужие.
const ownThreads = new Set();
const OWN_THREADS_LIMIT = 1000;

function rememberThread(id) {
  const value = String(id || '').trim();
  if (!value) return;
  ownThreads.add(value);

  while (ownThreads.size > OWN_THREADS_LIMIT) {
    const oldest = ownThreads.values().next().value;
    ownThreads.delete(oldest);
  }
}

function isOwnThread(id) {
  return ownThreads.has(String(id || '').trim());
}

let cached = null;
let cachedMtimeMs = -1;

function read() {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(REVIEW_PATH).mtimeMs;
  } catch {
    return FALLBACK;
  }

  if (cached && mtimeMs === cachedMtimeMs) return cached;

  try {
    const data = JSON.parse(fs.readFileSync(REVIEW_PATH, 'utf8'));
    if (!data || typeof data !== 'object' || !data.main) throw new Error('нет поля main');
    cached = data;
    cachedMtimeMs = mtimeMs;
    return data;
  } catch (err) {
    console.log(`  [!] review.json не прочитан (${err.message}), использую предыдущие тексты.`);
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
    uploaded = interaction.fields.getUploadedFiles('rw_file');
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

  // Имена вложений должны быть уникальными — иначе Discord отклонит сообщение
  const used = new Set();
  for (const file of files) {
    if (!used.has(file.name)) {
      used.add(file.name);
      continue;
    }

    const dot = file.name.lastIndexOf('.');
    const base = dot > 0 ? file.name.slice(0, dot) : file.name;
    const ext = dot > 0 ? file.name.slice(dot) : '';
    let index = 2;
    while (used.has(`${base}-${index}${ext}`)) index += 1;
    file.name = `${base}-${index}${ext}`;
    used.add(file.name);
  }

  return files;
}

function createButton(data) {
  const label = String(data.button?.label || '➕').slice(0, 80) || '➕';
  return new ButtonBuilder().setCustomId('rwcreate').setLabel(label).setStyle(ButtonStyle.Secondary);
}

function deleteButton(data, authorId) {
  const value = String(data.deleteButton?.emoji || '🗑️').trim() || '🗑️';
  const button = new ButtonBuilder()
    .setCustomId(`rwdelete:${authorId}`)
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
// Окно создания поста
// ---------------------------------------------------------------------------
async function openModal(interaction) {
  const data = read();
  const modalData = data.modal || {};

  const modal = new ModalBuilder()
    .setCustomId('rwmodal')
    .setTitle(String(modalData.title || FALLBACK.modal.title).slice(0, 45) || FALLBACK.modal.title);

  const link = new LabelBuilder()
    .setLabel(String(modalData.linkLabel || FALLBACK.modal.linkLabel).slice(0, 45))
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId('rw_link')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(500)
    );

  const description = new LabelBuilder()
    .setLabel(String(modalData.descriptionLabel || FALLBACK.modal.descriptionLabel).slice(0, 45))
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId('rw_description')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
    );

  const file = new LabelBuilder()
    .setLabel(String(modalData.fileLabel || FALLBACK.modal.fileLabel).slice(0, 45))
    .setFileUploadComponent(
      new FileUploadBuilder()
        .setCustomId('rw_file')
        .setRequired(true)
        .setMaxValues(4)
    );

  modal.addComponents(link, description, file);

  await interaction.showModal(modal);
}

// ---------------------------------------------------------------------------
// Публикация
// ---------------------------------------------------------------------------
function isVideoFile(file) {
  const type = String(file?.type || '');
  if (type.startsWith('video/')) return true;
  if (type) return false;
  return /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(String(file?.name || ''));
}

function statusText(data, key) {
  const value = data?.status?.[key] ?? FALLBACK.status[key] ?? '';
  return emojis.resolve(String(value)).trim().slice(0, 2000);
}

function publicationView(interaction, { link, description, uploaded = [] }) {
  const data = read();
  const member = interaction.member;
  const user = interaction.user;

  const username = user?.username || 'участник';
  const displayName = member?.displayName || username;

  // Ссылка и автор — обычным текстом над карточкой
  const text = fillTemplate(data.publication?.text || FALLBACK.publication.text, {
    link: link || '—',
    member: user?.id ? `<@${user.id}>` : displayName,
    description: description || '',
    image: '',
    username,
    displayName,
  });

  // «Ссылка на видео» — необязательное поле: пустую строку Discord не принимает
  const descriptionText = emojis.resolve(description || '').trim();
  const media = uploaded.filter((file) => isImageFile(file) || isVideoFile(file));
  const otherFiles = uploaded.filter((file) => !media.includes(file));

  const components = [];
  const content = emojis.resolve(text).trim().slice(0, 2000);
  if (content) components.push(new TextDisplayBuilder().setContent(content));
  if (descriptionText) {
    // Ссылка на видео оформляется так же, как название: «# ༻ 📁 │ ссылка»
    const linkTemplate = data.publication?.description || FALLBACK.publication.description;
    const linkLine = fillTemplate(linkTemplate, { description: descriptionText })
      .trim()
      .slice(0, 2000);
    if (linkLine) components.push(new TextDisplayBuilder().setContent(linkLine));
  }

  // Статус проверки — отдельная строка с id, чтобы «✅» и «❌» могли её заменить
  components.push(
    new TextDisplayBuilder().setId(STATUS_ID).setContent(statusText(data, 'pending'))
  );

  // Все фото и видео — сеткой без рамки: 1 крупно, 2 в ряд, 3–4 квадратом.
  // Остальные файлы показываем отдельными компонентами, чтобы они не пропали в Components V2.
  if (media.length) {
    const gallery = new MediaGalleryBuilder();
    for (const file of media) {
      gallery.addItems(new MediaGalleryItemBuilder().setURL(`attachment://${file.name}`));
    }
    components.push(gallery);
  }

  for (const file of otherFiles) {
    components.push(new FileBuilder().setURL(`attachment://${file.name}`));
  }

  const row = new ActionRowBuilder().addComponents(
    createButton(data),
    deleteButton(data, user.id)
  );
  components.push(row);

  // «✅» и «❌» видит каждый, но нажать может только администратор или модератор
  const decisionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rwaccept').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId('rwreject').setStyle(ButtonStyle.Danger).setEmoji('❌')
  );
  components.push(decisionRow);

  const payload = {
    components,
    allowedMentions: { parse: [] },
    flags: MessageFlags.IsComponentsV2,
  };
  if (uploaded.length) {
    payload.files = uploaded.map(
      (file) => new AttachmentBuilder(file.attachment, { name: file.name })
    );
  }

  return payload;
}

// Отправляем публикацию ответом на сообщение, где нажали «➕».
// Если исходное сообщение недоступно — обычным сообщением в канал.
async function sendPublication(interaction, sourceMessage, payload) {
  const options = {
    ...payload,
    // Не пингуем автора и никого другого ответом
    allowedMentions: { parse: [], repliedUser: false },
  };

  if (sourceMessage?.reply) {
    try {
      return await sourceMessage.reply(options);
    } catch (err) {
      console.log(`  [!] Не удалось ответить на сообщение с «➕»: ${err.message}`);
    }
  }

  return interaction.channel.send(payload);
}

// ---------------------------------------------------------------------------
// Ветка обсуждения под публикацией
// ---------------------------------------------------------------------------
function threadName(data, values) {
  const raw = fillTemplate(data?.name || FALLBACK.thread.name, values);
  return (raw.trim() || FALLBACK.thread.name).slice(0, 100);
}

// Id ветки совпадает с id сообщения, поэтому запоминаем его заранее —
// уведомление о ветке может прийти раньше ответа API.
async function startDiscussionThread(message, values) {
  const data = read().thread || FALLBACK.thread;
  const duration = Number(data.autoArchiveDuration);

  rememberThread(message.id);

  try {
    const thread = await message.startThread({
      name: threadName(data, values),
      autoArchiveDuration: [60, 1440, 4320, 10080].includes(duration) ? duration : 1440,
      reason: 'Обсуждение проверки достижения',
    });
    if (thread?.id) rememberThread(thread.id);
    return thread;
  } catch (err) {
    ownThreads.delete(String(message.id));
    console.log(`  [!] Не удалось создать ветку обсуждения: ${err.message}`);
    return null;
  }
}

async function submitPost(interaction) {
  const link = interaction.fields.getTextInputValue('rw_link').trim();
  const description = interaction.fields.getTextInputValue('rw_description').trim();

  if (!link) {
    await interaction.reply({
      content: 'Напиши название достижения.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Сообщение с кнопкой «➕» запоминаем до deferUpdate — потом interaction.message пустеет
  const sourceMessage = interaction.message ?? null;

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

    const payload = publicationView(interaction, { link, description, uploaded });
    const sent = await sendPublication(interaction, sourceMessage, payload);

    if (sent) {
      const username = interaction.user?.username || 'участник';
      const displayName = interaction.member?.displayName || username;
      await startDiscussionThread(sent, { link, username, displayName, member: username });
    }
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
async function deletePost(interaction, authorId) {
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

  // Без текста: подтверждаем нажатие и удаляем само сообщение
  await interaction.deferUpdate();
  await interaction.message.delete().catch(() => {});
}

// ---------------------------------------------------------------------------
// Решение по достижению: «✅» принято, «❌» отклонено
// ---------------------------------------------------------------------------
function canModerate(interaction, data) {
  const member = interaction.member;

  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;

  return (
    Array.isArray(data.moderatorRoles) &&
    data.moderatorRoles.some((id) => member?.roles?.cache?.has(id))
  );
}

// Ищем компонент по id на любой глубине: строка статуса лежит прямо в сообщении
function findComponentById(list, targetId) {
  for (const component of list || []) {
    if (component?.id === targetId) return component;
    const nested = findComponentById(component?.components, targetId);
    if (nested) return nested;
  }
  return null;
}

async function decidePost(interaction, decision) {
  const data = read();

  if (!canModerate(interaction, data)) {
    await interaction.reply({
      content: data.deniedText || FALLBACK.deniedText,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const components = interaction.message.components.map((component) => component.toJSON());
  const status = findComponentById(components, STATUS_ID);

  if (!status) {
    await interaction.reply({
      content: 'Не нашёл строку статуса в этом посте.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  status.content = statusText(data, decision === 'accepted' ? 'accepted' : 'rejected');
  await interaction.update({ components });
}

module.exports = {
  REVIEW_PATH,
  mainView,
  openModal,
  submitPost,
  deletePost,
  decidePost,
  rememberThread,
  isOwnThread,
};
