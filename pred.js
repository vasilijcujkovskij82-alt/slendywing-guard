'use strict';

// Предупреждения (/пред) — порт команды «Пред» из JuniperBot.
//
// Всё оформление лежит в pred.json и перечитывается на лету:
//   /пред -> карточка с кнопкой «➕»;
//   «➕»  -> окно: участник, глава, пункт, кол-во предупреждений за акт, акт;
//   отправка -> предупреждение публикуется ответом на сообщение с «➕»;
//   «🗑️» -> удаление предупреждения (только администраторы и роли из pred.json).
//
// Пользоваться командой и кнопкой могут администраторы по правам,
// владелец сервера и роли из moderatorRoles.

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
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const emojis = require('./emojis');

const PRED_PATH = path.join(__dirname, 'pred.json');
const DEFAULT_COLOR = 0x262b64;
// Цвет рамки отказа в действии: 134 53 53
const DENIED_COLOR = 0x863535;

const FALLBACK = {
  color: '38 43 100',
  author: '𝄢 SLENDYWING 𝄢',
  main: { text: '## ༻ 🛡️ │ ВЫДАЧА ПРЕДУПРЕЖДЕНИЙ' },
  button: { label: '➕' },
  deleteButton: { emoji: '🗑️' },
  modal: {
    title: 'Выдача предупреждений',
    memberLabel: 'Участник',
    chapterLabel: 'Глава',
    pointLabel: 'Пункт',
    countLabel: 'Кол-во предупреждений за акт',
    actLabel: 'Акт',
  },
  publication: {
    content: '### ༻❗│ {member}',
    author: '༻❗│ Предупреждение',
    description:
      '*𝄢 🛡️ │ Модератор: {moderator}*\n\n' +
      '𝄢│ Участник: **{member}**\n' +
      '𝄢│ Глава: **{chapter}**\n' +
      '𝄢│ Пункт: **{point}**\n' +
      '𝄢│ Кол-во предупреждений: **{count} /3**\n' +
      '𝄢│ АКТ: **{act}**',
  },
  moderatorRoles: [],
  deniedText: '## ༻ ❌ │ Действие невозможно',
};

let cached = null;
let cachedMtimeMs = -1;

function read() {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(PRED_PATH).mtimeMs;
  } catch {
    return FALLBACK;
  }

  if (cached && mtimeMs === cachedMtimeMs) return cached;

  try {
    const data = JSON.parse(fs.readFileSync(PRED_PATH, 'utf8'));
    if (!data || typeof data !== 'object' || !data.main) throw new Error('нет поля main');
    cached = data;
    cachedMtimeMs = mtimeMs;
    return data;
  } catch (err) {
    console.log(`  [!] pred.json не прочитан (${err.message}), использую предыдущие тексты.`);
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

// {member}, {moderator}, {chapter}, {point}, {count}, {act}
function fillTemplate(template, values) {
  return String(template || '').replace(
    /\{(member|moderator|chapter|point|count|act)\}/g,
    (whole, key) => (values[key] == null ? '' : String(values[key]))
  );
}

// Выдавать предупреждения могут администраторы по правам, владелец сервера
// и роли из pred.json
function canModerate(interaction, data) {
  const member = interaction.member;

  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (interaction.guild && interaction.guild.ownerId === interaction.user?.id) return true;

  return (
    Array.isArray(data.moderatorRoles) &&
    data.moderatorRoles.some((id) => member?.roles?.cache?.has(id))
  );
}

// «Действие невозможно» — в рамке, чтобы отказ выглядел аккуратно
function deniedView(data) {
  const text = emojis
    .resolve(String(data.deniedText || FALLBACK.deniedText))
    .trim()
    .slice(0, 2000);

  return {
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(DENIED_COLOR)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(text || FALLBACK.deniedText)
        ),
    ],
  };
}

function createButton(data) {
  const label = String(data.button?.label || '➕').slice(0, 80) || '➕';
  return new ButtonBuilder().setCustomId('predcreate').setLabel(label).setStyle(ButtonStyle.Secondary);
}

function deleteButton(data) {
  const value = String(data.deleteButton?.emoji || '🗑️').trim() || '🗑️';
  const button = new ButtonBuilder().setCustomId('preddelete').setStyle(ButtonStyle.Secondary);

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

  // Аватарка SW — миниатюра справа
  if (icon) embed.setThumbnail(icon);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(createButton(data))],
  };
}

// ---------------------------------------------------------------------------
// Окно выдачи предупреждения
// ---------------------------------------------------------------------------
function textField(customId, label, maxLength = 100) {
  return new LabelBuilder()
    .setLabel(String(label).slice(0, 45))
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId(customId)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(maxLength)
    );
}

// Список чисел для «Кол-во предупреждений» (1–3) и «Акт» (1–2)
function numberSelect(customId, label, values) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      values.map((value) => ({ label: value, value }))
    );

  return new LabelBuilder()
    .setLabel(String(label).slice(0, 45))
    .setStringSelectMenuComponent(select);
}

async function openModal(interaction) {
  const data = read();

  if (!canModerate(interaction, data)) {
    await interaction.reply(deniedView(data));
    return;
  }

  const modalData = data.modal || {};
  const label = (key) => String(modalData[key] || FALLBACK.modal[key]).slice(0, 45);
  // id сообщения с «➕» переносим в окно, чтобы после отправки ответить именно на него
  const sourceId = interaction.message?.id || '';

  const modal = new ModalBuilder()
    .setCustomId(`predmodal:${sourceId}`)
    .setTitle(label('title'));

  modal.addComponents(
    new LabelBuilder()
      .setLabel(label('memberLabel'))
      .setUserSelectMenuComponent(
        new UserSelectMenuBuilder()
          .setCustomId('pred_member')
          .setMinValues(1)
          .setMaxValues(1)
      ),
    textField('pred_chapter', label('chapterLabel')),
    textField('pred_point', label('pointLabel')),
    numberSelect('pred_count', label('countLabel'), ['1', '2', '3']),
    numberSelect('pred_act', label('actLabel'), ['1', '2'])
  );

  await interaction.showModal(modal);
}

// ---------------------------------------------------------------------------
// Публикация предупреждения — ответом на сообщение с «➕»
// ---------------------------------------------------------------------------
function publicationView(interaction, values) {
  const data = read();
  const icon = interaction.guild?.iconURL({ size: 256 }) ?? undefined;
  const publication = data.publication || FALLBACK.publication;

  const content = fillTemplate(publication.content || FALLBACK.publication.content, values);
  const description = fillTemplate(
    publication.description || FALLBACK.publication.description,
    values
  );

  const embed = new EmbedBuilder()
    .setColor(parseColor(data.color))
    .setAuthor({ name: publication.author || FALLBACK.publication.author })
    .setDescription(emojis.resolve(description).slice(0, 4096));

  // Аватарка SW — миниатюра справа
  if (icon) embed.setThumbnail(icon);

  return {
    content: emojis.resolve(content).slice(0, 2000),
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(createButton(data), deleteButton(data))],
    allowedMentions: { users: [values.memberId], repliedUser: false },
  };
}

async function submitPred(interaction) {
  const data = read();

  // Окно могли оставить открытым после снятия роли — проверяем ещё раз
  if (!canModerate(interaction, data)) {
    await interaction.reply(deniedView(data));
    return;
  }

  let user = null;
  try {
    user = interaction.fields.getSelectedUsers('pred_member')?.first() ?? null;
  } catch {
    user = null;
  }

  const chapter = interaction.fields.getTextInputValue('pred_chapter').trim();
  const point = interaction.fields.getTextInputValue('pred_point').trim();

  let countRaw = '';
  let act = '';
  try {
    countRaw = String(interaction.fields.getStringSelectValues('pred_count')?.[0] || '').trim();
  } catch {
    countRaw = '';
  }
  try {
    act = String(interaction.fields.getStringSelectValues('pred_act')?.[0] || '').trim();
  } catch {
    act = '';
  }

  if (!user) {
    await interaction.reply({
      content: 'Выбери участника.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!chapter || !point) {
    await interaction.reply({
      content: 'Заполни главу и пункт.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!['1', '2', '3'].includes(countRaw) || !['1', '2'].includes(act)) {
    await interaction.reply({
      content: 'Выбери кол-во предупреждений (1–3) и акт (1–2).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const count = Number.parseInt(countRaw, 10);

  // Сообщение с «➕» запоминаем до deferUpdate — потом interaction.message пустеет
  const parts = String(interaction.customId || '').split(':');
  const sourceId = parts[1] || '';
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
    const payload = publicationView(interaction, {
      memberId: user.id,
      member: `<@${user.id}>`,
      moderator: interaction.user?.id ? `<@${interaction.user.id}>` : '—',
      chapter,
      point,
      count: String(count),
      act,
    });

    // Публикуем ответом на сообщение с «➕» (как в проверке достижений)
    let source = sourceMessage;
    if (!source && sourceId) {
      try {
        source = await interaction.channel.messages.fetch(sourceId);
      } catch {
        source = null;
      }
    }

    if (source?.reply) {
      try {
        await source.reply(payload);
      } catch (err) {
        console.log(`  [!] Не удалось ответить на сообщение с «➕»: ${err.message}`);
        await interaction.channel.send(payload);
      }
    } else {
      await interaction.channel.send(payload);
    }

    if (usedReply) await interaction.deleteReply().catch(() => {});
  } catch (err) {
    console.log(`  [!] Не удалось опубликовать предупреждение: ${err.message}`);
    await interaction
      .followUp({
        content: `Не удалось опубликовать: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Удаление предупреждения
// ---------------------------------------------------------------------------
async function deletePost(interaction) {
  const data = read();

  // Удалять могут только администраторы и модераторы из pred.json
  if (!canModerate(interaction, data)) {
    await interaction.reply(deniedView(data));
    return;
  }

  // Без текста: подтверждаем нажатие и удаляем само сообщение
  await interaction.deferUpdate();
  await interaction.message.delete().catch(() => {});
}

module.exports = {
  PRED_PATH,
  mainView,
  openModal,
  submitPred,
  deletePost,
  canModerate,
  deniedView,
  read,
};
