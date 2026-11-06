'use strict';

// Меню ролей (/роли) — порт команды «!Роли» из JuniperBot.
//
// Все тексты, картинки, кнопки и цвета лежат в roles.json.
// Файл перечитывается на лету: правки из редактора применяются без перезапуска.
//
// Как это работает:
//   /роли  -> в канал отправляется главная карточка с тремя кнопками;
//   кнопки -> открывают категорию (ответ виден только нажавшему);
//   кнопки ролей -> выдают/снимают роль по клику;
//   селект цветов -> ставит один цвет (или убирает все).

const fs = require('node:fs');
const path = require('node:path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require('discord.js');

const emojis = require('./emojis');

const ROLES_PATH = path.join(__dirname, 'roles.json');
const BACK_LABEL = '༻↩│НАЗАД';

const FALLBACK = {
  color: '#262B64',
  author: '༻𝐒𝐋𝐄𝐍𝐃𝐘𝐖𝐈𝐍𝐆༺',
  main: { text: 'Меню ролей пока не заполнено.', image: '' },
  categories: {},
};

let cached = null;
let cachedMtimeMs = -1;

function read() {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(ROLES_PATH).mtimeMs;
  } catch {
    return FALLBACK;
  }

  if (cached && mtimeMs === cachedMtimeMs) return cached;

  try {
    const data = JSON.parse(fs.readFileSync(ROLES_PATH, 'utf8'));
    if (!data || typeof data !== 'object' || !data.categories) throw new Error('нет поля categories');
    cached = data;
    cachedMtimeMs = mtimeMs;
    return data;
  } catch (err) {
    console.log(`  [!] roles.json не прочитан (${err.message}), использую предыдущие тексты.`);
    return cached || FALLBACK;
  }
}

function parseColor(value) {
  const hex = String(value || '#262B64').replace('#', '');
  const parsed = Number.parseInt(hex, 16);
  return Number.isNaN(parsed) ? 0x262b64 : parsed;
}

// ---------------------------------------------------------------------------
// Сборка карточек
// ---------------------------------------------------------------------------
function embedFor(interaction, text, image) {
  const data = read();

  const embed = new EmbedBuilder()
    .setColor(parseColor(data.color))
    .setAuthor({
      name: data.author || '༻𝐒𝐋𝐄𝐍𝐃𝐘𝐖𝐈𝐍𝐆༺',
      iconURL: interaction.guild?.iconURL({ size: 256 }) ?? undefined,
    })
    .setDescription(emojis.resolve(String(text || ' ')));

  if (image) embed.setImage(image);
  return embed;
}

function menuRows() {
  const data = read();
  const entries = Object.entries(data.categories || {}).filter(([, cat]) => cat && !cat.hidden);

  const list = entries.slice(0, 5).map(([key, cat]) =>
    new ButtonBuilder()
      .setCustomId(`rolemenu:${key}`)
      .setLabel(String(cat.label || key).slice(0, 80))
      .setStyle(ButtonStyle.Secondary)
  );

  return list.length ? [new ActionRowBuilder().addComponents(list)] : [];
}

function categoryRows(interaction, key) {
  const data = read();
  const cat = data.categories?.[key];
  if (!cat) return null;

  const rows = [];

  // Кнопки выдачи/снятия ролей
  const buttons = Array.isArray(cat.buttons) ? cat.buttons.filter((b) => b && b.roleId) : [];
  if (buttons.length) {
    const list = buttons.slice(0, 5).map((button) =>
      new ButtonBuilder()
        .setCustomId(`roletoggle:${button.roleId}`)
        .setLabel(String(button.label || 'РОЛЬ').slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(new ActionRowBuilder().addComponents(list));
  }

  // Селект (например, цвета)
  const options = Array.isArray(cat.options) ? cat.options : [];
  if (options.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('rolecolor')
      .setPlaceholder(String(cat.placeholder || 'Выберите роль').slice(0, 150))
      .addOptions(
        options.slice(0, 25).map((option) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(String(option.label || option.value || 'Опция').slice(0, 100))
            .setValue(String(option.value || option.label || 'option'))
        )
      );
    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  // Кнопка «Назад» — возвращает в главное меню
  if (rows.length < 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rolemenu:main').setLabel(BACK_LABEL).setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return { embeds: [embedFor(interaction, cat.text, cat.image)], components: rows };
}

function mainView(interaction) {
  const data = read();
  return {
    embeds: [embedFor(interaction, data.main?.text, data.main?.image)],
    components: menuRows(),
  };
}

// ---------------------------------------------------------------------------
// Ответы
// ---------------------------------------------------------------------------
function isEphemeralMessage(interaction) {
  const flags = interaction.message?.flags;
  if (!flags) return false;
  if (typeof flags.has === 'function') return flags.has(MessageFlags.Ephemeral);
  return (Number(flags) & MessageFlags.Ephemeral) !== 0;
}

async function respond(interaction, view) {
  // Если категория уже открыта невидимым сообщением — просто обновляем его.
  // Публичную карточку не трогаем: на неё отвечаем отдельным эфемерным сообщением.
  if (interaction.message && isEphemeralMessage(interaction)) {
    await interaction.update(view);
  } else {
    await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
  }
}

async function showMenu(interaction, key) {
  const view = key === 'main' ? mainView(interaction) : categoryRows(interaction, key);
  if (!view) return;
  await respond(interaction, view);
}

// ---------------------------------------------------------------------------
// Выдача и снятие обычных ролей
// ---------------------------------------------------------------------------
async function toggleRole(interaction, roleId) {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member?.roles?.cache) {
    await interaction.reply({ content: 'Не удалось определить участника.', flags: MessageFlags.Ephemeral });
    return;
  }

  let role = guild.roles.cache.get(roleId);
  if (!role) role = await guild.roles.fetch(roleId).catch(() => null);

  if (!role) {
    await interaction.reply({ content: 'Роль не найдена на сервере.', flags: MessageFlags.Ephemeral });
    return;
  }

  const has = member.roles.cache.has(roleId);

  try {
    if (has) {
      await member.roles.remove(roleId, 'Меню ролей: снятие роли');
    } else {
      await member.roles.add(roleId, 'Меню ролей: выдача роли');
    }

    await interaction.reply({
      content: has ? `# Роль снята\n${role}` : `# Роль получена\n${role}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction
      .reply({
        content: `Не удалось ${has ? 'снять' : 'выдать'} роль **${role.name}**:\n${err.message}`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Цвета
// ---------------------------------------------------------------------------
async function pickColor(interaction) {
  const data = read();
  const cat = data.categories?.colors;
  const member = interaction.member;

  if (!cat || !member?.roles?.cache) return;

  const value = interaction.values?.[0];
  const options = Array.isArray(cat.options) ? cat.options : [];
  const chosen = options.find((option) => option.value === value);

  const colorRoles = options.filter((option) => option.roleId).map((option) => option.roleId);
  const legacyRoles = Array.isArray(cat.extraRoles) ? cat.extraRoles : [];
  const allColors = [...new Set([...colorRoles, ...legacyRoles])];
  const categoryRole = cat.categoryRole;

  try {
    // CLEAR (или неизвестное значение) — снимаем все цветные роли
    if (!chosen || !chosen.roleId) {
      const toRemove = [...new Set([categoryRole, ...allColors].filter(Boolean))].filter((id) =>
        member.roles.cache.has(id)
      );

      if (toRemove.length) await member.roles.remove(toRemove, 'Меню ролей: сброс цвета');

      await interaction.reply({
        content: '𝄢 ✅ │ **Цветные роли убраны из вашего профиля**',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Один цвет за раз: снимаем остальные, ставим выбранный
    const others = allColors.filter((id) => id !== chosen.roleId && member.roles.cache.has(id));
    if (others.length) await member.roles.remove(others, 'Меню ролей: смена цвета');

    const toAdd = [chosen.roleId];
    if (categoryRole && !member.roles.cache.has(categoryRole)) toAdd.push(categoryRole);
    await member.roles.add(toAdd, 'Меню ролей: выбор цвета');

    await interaction.reply({
      content: `𝄢 ✅ │ **Успешно установлена цветная роль <@&${chosen.roleId}>**`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction
      .reply({
        content: `Не удалось изменить цвет: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}

module.exports = {
  ROLES_PATH,
  mainView,
  showMenu,
  toggleRole,
  pickColor,
};
