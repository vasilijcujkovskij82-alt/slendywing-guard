'use strict';

const path = require('node:path');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { SECTIONS, BANNER_URL, SECTION_COLOR } = require('./navigation');

// ---------------------------------------------------------------------------
// Настройки сервера SlendyWing
// ---------------------------------------------------------------------------
const GUILD_ID = '1283395341881835581';    // сервер SlendyWing
const GUILD_NAME = 'slendywing';           // запасной поиск по названию
const CATEGORY_ID = '1435283815789760513'; // категория TempVoice
const ROLE_ID = '1563532837456584824';     // роль "Нарушитель"

// Токен читается из файла .env
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // файла .env пока нет
}

const TOKEN = (process.env.TOKEN || '').trim();

if (!TOKEN) {
  console.error('');
  console.error('  [Ошибка] Не найден токен бота.');
  console.error('  Запусти ярлык "SlendyWing Guard" на рабочем столе.');
  console.error('');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------------------------------------------------------------------------
// Запретить роли "Нарушитель" видеть канал и заходить в него
// ---------------------------------------------------------------------------
async function blockRole(channel) {
  const role = channel.guild.roles.cache.get(ROLE_ID);
  if (!role) {
    console.log(`  [!] Роль ${ROLE_ID} не найдена на сервере "${channel.guild.name}".`);
    return false;
  }

  await channel.permissionOverwrites.edit(
    role,
    { ViewChannel: false, Connect: false },
    { reason: 'Нарушитель: доступ к временному голосовому каналу закрыт' }
  );

  console.log(`  [OK] Закрыт канал: ${channel.name}  (${channel.guild.name})`);
  return true;
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------
function tempVoiceChannels(guild) {
  return guild.channels.cache.filter(
    (ch) =>
      ch.parentId === CATEGORY_ID &&
      (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)
  );
}

function isBlocked(channel) {
  const overwrite = channel.permissionOverwrites.cache.get(ROLE_ID);
  if (!overwrite) return false;
  return overwrite.deny.has(PermissionFlagsBits.ViewChannel) || overwrite.deny.has(PermissionFlagsBits.Connect);
}

async function unblockRole(channel) {
  const overwrite = channel.permissionOverwrites.cache.get(ROLE_ID);
  if (!overwrite) return false;
  await channel.permissionOverwrites.delete(ROLE_ID, 'Снят запрет для роли Нарушитель');
  return true;
}

// ---------------------------------------------------------------------------
// Слеш-команды
// ---------------------------------------------------------------------------
const COMMANDS = [
  { name: 'навигация', description: 'Навигация по серверу: правила, нарушения, роли, о сервере' },
  { name: 'status', description: 'Показать состояние бота и категории TempVoice' },
  { name: 'channels', description: 'Список голосовых каналов категории и их состояние' },
  { name: 'block', description: 'Закрыть роль Нарушитель во всех каналах категории' },
  { name: 'unblock', description: 'Снять запрет с каналов категории' },
];

// ---------------------------------------------------------------------------
// Навигация: меню и вывод разделов
// ---------------------------------------------------------------------------
function chunkText(text, size = 1900) {
  const out = [];
  let current = '';

  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > size && current) {
      out.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

function navRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('nav:rules').setEmoji('📚').setLabel('│ ПРАВИЛА').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:violations').setEmoji('🚫').setLabel('│ НАРУШЕНИЯ').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:roles').setEmoji('🎭').setLabel('│ РОЛИ').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:about').setEmoji('❔').setLabel('│ O SLENDYWING').setStyle(ButtonStyle.Secondary)
  );
}

async function sendSection(interaction, key) {
  const section = SECTIONS[key];
  if (!section) return;

  let text = section.text;
  if (key === 'about') {
    text = text.replace('{MEMBERS}', String(interaction.guild ? interaction.guild.memberCount : '—'));
  }

  // Если у раздела есть отдельный заголовок — убираем первую строку текста,
  // иначе заголовок из текста остаётся (и рисуется как markdown H1)
  if (section.title) {
    text = text.replace(/^#\s[^\n]*\n+/, '');
  }

  const parts = chunkText(text, 4000);
  const icon = interaction.guild?.iconURL({ size: 256 }) ?? null;

  const embeds = parts.map((part, index) => {
    const embed = new EmbedBuilder().setColor(SECTION_COLOR).setDescription(part);
    if (index === 0) {
      if (section.title) embed.setTitle(section.title);
      if (icon) embed.setThumbnail(icon);
    }
    return embed;
  });

  // Картинка в самый низ раздела
  if (section.image && embeds.length > 0) {
    embeds[embeds.length - 1].setImage(section.image);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply({ embeds: [embeds[0]] });

  for (const embed of embeds.slice(1)) {
    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

// ---------------------------------------------------------------------------
// Ищем сервер: по ID, потом по названию, потом единственный доступный
// ---------------------------------------------------------------------------
function resolveGuild() {
  const byId = client.guilds.cache.get(GUILD_ID);
  if (byId) return byId;

  const byName = client.guilds.cache.find((g) => g.name.toLowerCase().includes(GUILD_NAME));
  if (byName) return byName;

  if (client.guilds.cache.size === 1) return client.guilds.cache.first();

  return null;
}

let started = false;

async function start() {
  if (started) return;
  started = true;

  await client.guilds.fetch();

  console.log('');
  console.log(`  Бот запущен: ${client.user.tag}`);
  console.log('');
  console.log('  Серверы, на которых бот есть:');

  if (client.guilds.cache.size === 0) {
    console.log('    (ни одного — бот не приглашён ни на один сервер)');
  }
  for (const g of client.guilds.cache.values()) {
    console.log(`    - ${g.name}  |  ID: ${g.id}`);
  }
  console.log('');

  const guild = resolveGuild();

  if (!guild) {
    console.log('  [!] Не удалось определить сервер.');
    console.log(`      В настройках прописан ID: ${GUILD_ID}`);
    console.log('      Проверь, что бот приглашён именно на SlendyWing.');
    console.log('');
    return;
  }

  if (guild.id !== GUILD_ID) {
    console.log(`  [i] ID сервера в настройках (${GUILD_ID}) не совпал.`);
    console.log(`      Работаю с сервером: ${guild.name} (${guild.id})`);
    console.log('');
  }

  const botMember = await guild.members.fetchMe();

  // Гарантируем, что кэш ролей и каналов заполнен
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});

  const role = guild.roles.cache.get(ROLE_ID);

  if (!role) {
    console.log(`  [!] Роль с ID ${ROLE_ID} не найдена на этом сервере.`);
    console.log('      Проверь ID роли "Нарушитель".');
    console.log('');
  } else if (botMember.roles.highest.position <= role.position) {
    console.log('  [!] Роль бота НИЖЕ роли "Нарушитель" — запретить ей права не получится.');
    console.log('      Настройки сервера -> Роли -> подними роль бота выше.');
    console.log('');
  }

  const category = guild.channels.cache.get(CATEGORY_ID);
  if (!category) {
    console.log(`  [!] Категория ${CATEGORY_ID} на сервере не найдена.`);
    console.log('      Проверь ID категории TempVoice.');
    console.log('');
  } else {
    console.log(`  Категория: ${category.name}`);
  }

  // Регистрируем слеш-команды на этом сервере
  try {
    const registered = await client.application.commands.set(COMMANDS, guild.id);
    console.log(`  Команды (${registered.size}): ${registered.map((c) => '/' + c.name).join(' ')}`);
  } catch (err) {
    console.log(`  [!] Не удалось зарегистрировать команды: ${err.message}`);
  }

  // Закрываем уже существующие голосовые каналы в категории
  let closed = 0;
  for (const channel of guild.channels.cache.values()) {
    if (channel.parentId !== CATEGORY_ID) continue;
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
    try {
      if (await blockRole(channel)) closed++;
    } catch (err) {
      console.log(`  [!] Не удалось закрыть ${channel.name}: ${err.message}`);
    }
  }

  console.log('');
  console.log(`  Существующих каналов закрыто: ${closed}`);
  console.log('  Слежу за новыми голосовыми каналами в категории TempVoice...');
  console.log('  Окно не закрывай — пока оно открыто, бот работает.');
  console.log('');
}

client.once('clientReady', start);

client.on('channelCreate', async (channel) => {
  try {
    if (channel.parentId !== CATEGORY_ID) return;
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) return;

    await blockRole(channel);
  } catch (err) {
    console.log(`  [!] Ошибка при обработке нового канала: ${err.message}`);
  }
});

client.on('error', (err) => console.log(`  [!] Ошибка: ${err.message}`));

// ---------------------------------------------------------------------------
// Обработка слеш-команд
// ---------------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('nav:')) return;
    try {
      await sendSection(interaction, interaction.customId.slice(4));
    } catch (err) {
      console.log(`  [!] Ошибка навигации: ${err.message}`);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'навигация') {
      const embed = new EmbedBuilder()
        .setAuthor({ name: 'SLENDYWING' })
        .setTitle('𝐒𝐋𝐄𝐍𝐃𝐘𝐖𝐈𝐍𝐆')
        .setDescription('Выбери раздел кнопкой ниже 👇')
        .setColor(SECTION_COLOR);

      const icon = interaction.guild?.iconURL({ size: 256 });
      if (icon) embed.setThumbnail(icon);
      if (BANNER_URL) embed.setImage(BANNER_URL);

      await interaction.reply({ embeds: [embed], components: [navRow()] });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: 'Нужны права «Управление сервером».',
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: 'Команда работает только на сервере.', ephemeral: true });
      return;
    }

    const channels = tempVoiceChannels(guild);

    if (interaction.commandName === 'status') {
      const blocked = channels.filter((ch) => isBlocked(ch)).size;
      const category = guild.channels.cache.get(CATEGORY_ID);
      const role = guild.roles.cache.get(ROLE_ID);

      await interaction.reply({
        ephemeral: true,
        content: [
          `**Бот:** ${client.user.tag}`,
          `**Онлайн:** ${Math.floor(process.uptime() / 60)} мин`,
          `**Сервер:** ${guild.name}`,
          `**Категория:** ${category ? category.name : 'не найдена'}`,
          `**Роль:** ${role ? role.name : 'не найдена'}`,
          `**Каналов в категории:** ${channels.size}`,
          `**Из них закрыто:** ${blocked}`,
        ].join('\n'),
      });
      return;
    }

    if (interaction.commandName === 'channels') {
      if (channels.size === 0) {
        await interaction.reply({ content: 'В категории нет голосовых каналов.', ephemeral: true });
        return;
      }

      const lines = channels.map((ch) => `${isBlocked(ch) ? '🔒' : '🔓'} ${ch.name}`);
      await interaction.reply({
        ephemeral: true,
        content: `**Голосовые каналы категории (${channels.size}):**\n${lines.join('\n')}`,
      });
      return;
    }

    if (interaction.commandName === 'block') {
      await interaction.deferReply({ ephemeral: true });

      let done = 0;
      const failed = [];
      for (const ch of channels.values()) {
        try {
          await blockRole(ch);
          done++;
        } catch (err) {
          failed.push(`${ch.name}: ${err.message}`);
        }
      }

      await interaction.editReply({
        content:
          `Закрыто каналов: **${done}**` +
          (failed.length ? `\nОшибки:\n${failed.join('\n')}` : ''),
      });
      return;
    }

    if (interaction.commandName === 'unblock') {
      await interaction.deferReply({ ephemeral: true });

      let done = 0;
      for (const ch of channels.values()) {
        try {
          if (await unblockRole(ch)) done++;
        } catch {
          // пропускаем
        }
      }

      await interaction.editReply({ content: `Запрет снят с каналов: **${done}**` });
    }
  } catch (err) {
    console.log(`  [!] Ошибка команды: ${err.message}`);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: `Ошибка: ${err.message}` }).catch(() => {});
    } else {
      await interaction
        .reply({ content: `Ошибка: ${err.message}`, ephemeral: true })
        .catch(() => {});
    }
  }
});

client.login(TOKEN).catch((err) => {
  console.log('');
  console.log(`  [Ошибка входа] ${err.message}`);
  console.log('  Скорее всего токен неверный или сброшен.');
  console.log('  Запусти ярлык "SlendyWing Guard" заново и впиши новый токен в Блокноте.');
  console.log('');
});

// ---------------------------------------------------------------------------
// Мини-HTTP-сервер. Нужен только для хостинга (Render), локально не мешает.
// ---------------------------------------------------------------------------
const PORT = process.env.PORT;

if (PORT) {
  const http = require('node:http');

  http
    .createServer((req, res) => {
      const body = {
        ok: true,
        botOnline: client.isReady(),
        botTag: client.user ? client.user.tag : null,
        uptimeSec: Math.round(process.uptime()),
        guilds: client.guilds.cache.map((g) => ({ name: g.name, id: g.id })),
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body, null, 2));
    })
    .listen(Number(PORT), () => {
      console.log(`  HTTP-порт ${PORT} открыт (для хостинга)`);
    });

  // Самопинг: не даём бесплатному Render уснуть.
  // Render сам передаёт переменную RENDER_EXTERNAL_URL.
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    const ping = () => {
      fetch(selfUrl, { signal: AbortSignal.timeout(20000) }).catch(() => {});
    };
    setInterval(ping, 10 * 60 * 1000);
    console.log(`  Самопинг каждые 10 минут: ${selfUrl}`);
  }
}
