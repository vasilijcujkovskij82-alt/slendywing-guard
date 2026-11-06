'use strict';

const path = require('node:path');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder, Routes } = require('discord.js');
const nav = require('./navigation'); // тексты перечитываются из content.json на лету
const emojis = require('./emojis');  // :name: -> <:name:id> для эмодзи с других серверов
const buttons = require('./buttons'); // кнопки главной карточки и разделов

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

// Discord иногда отвечает очень долго (или не отвечает) — не даём запуску зависнуть
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label}: нет ответа ${Math.round(ms / 1000)} с`)), ms);
      timer.unref?.();
    }),
  ]);
}
// Количество участников: держим актуальным, а не «на момент запуска».
// Discord отдаёт member_count в GET /guilds/:id — спрашиваем при каждом показе
// раздела, но не чаще раза в 15 секунд (кэш).
const memberCountCache = new Map(); // guildId -> { count, at }

async function fetchMemberCount(guild) {
  if (!guild) return null;

  const cached = memberCountCache.get(guild.id);
  const now = Date.now();
  if (cached && now - cached.at < 15000) return cached.count;

  try {
    // with_counts=true — Discord отдаёт approximate_member_count (то же число,
    // что показывает сам Discord и джунипер в {{guild.memberCount}})
    const data = await withTimeout(
      client.rest.get(Routes.guild(guild.id), { query: new URLSearchParams({ with_counts: 'true' }) }),
      5000,
      'количество участников'
    );
    const raw = data?.approximate_member_count ?? data?.member_count;
    const count = typeof raw === 'number' ? raw : guild.memberCount;
    memberCountCache.set(guild.id, { count, at: now });
    return count;
  } catch {
    // Discord не ответил — показываем последнее известное значение
    return cached ? cached.count : guild.memberCount ?? null;
  }
}

// {MEMBERS} из старых текстов и {{guild.memberCount}} — как в других ботах
const MEMBER_PLACEHOLDER = /\{MEMBERS\}|\{\{\s*guild\.memberCount\s*\}\}|\{\{\s*memberCount\s*\}\}|\{\{\s*members\s*\}\}/i;

function applyMemberCount(text, count) {
  if (!text) return text;
  const value = count == null ? '—' : String(count);
  return text
    .replace(/\{MEMBERS\}/g, value)
    .replace(/\{\{\s*guild\.memberCount\s*\}\}/gi, value)
    .replace(/\{\{\s*memberCount\s*\}\}/gi, value)
    .replace(/\{\{\s*members\s*\}\}/gi, value);
}

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
  {
    name: 'навигация',
    description: 'Отправить навигацию по серверу в этот канал',
    // '0' — команду видят только администраторы
    defaultMemberPermissions: '0',
  },
  {
    // Полная копия /навигация — для проверок, чтобы не трогать основную команду
    name: 'тест',
    description: 'Тестовая копия /навигация — отправляет такую же карточку',
    defaultMemberPermissions: '0',
  },
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

function navRows() {
  return buttons.navRows(nav.SECTIONS);
}

function testNavRows() {
  return buttons.navRows(nav.TEST_SECTIONS, 'test');
}

async function sendSection(interaction, key, source = 'nav') {
  // 'nav' — обычная навигация (content.json), 'test' — /тест (content.test.json)
  const isTest = source === 'test';
  const sections = isTest ? nav.TEST_SECTIONS : nav.SECTIONS;
  const section = sections[key];
  if (!section) return;

  let text = section.text || '';

  // Счётчик участников — всегда свежий (пришёл/ушёл кто-то — число новое)
  if (MEMBER_PLACEHOLDER.test(text)) {
    text = applyMemberCount(text, await fetchMemberCount(interaction.guild));
  }

  // Если у раздела есть отдельный заголовок — убираем первую строку текста,
  // иначе заголовок из текста остаётся (и рисуется как markdown H1)
  if (section.title) {
    text = text.replace(/^#\s[^\n]*\n+/, '');
  }

  // :name: -> <:name:id>, чтобы работали эмодзи с других серверов
  text = emojis.resolve(text);

  const parts = chunkText(text, 4000);
  const icon = interaction.guild?.iconURL({ size: 256 }) ?? null;

  const embeds = parts.map((part, index) => {
    const embed = new EmbedBuilder()
      .setColor(isTest ? nav.TEST_SECTION_COLOR : nav.SECTION_COLOR)
      .setDescription(part);
    if (index === 0) {
      if (section.title) embed.setTitle(emojis.resolve(section.title));
      if (icon) embed.setThumbnail(icon);
    }
    return embed;
  });

  // Картинка в самый низ раздела
  if (section.image && embeds.length > 0) {
    embeds[embeds.length - 1].setImage(section.image);
  }

  // Дополнительные кнопки внутри раздела (например, «ДОСКА ПОЧЕТА» в «О SlendyWing»)
  const extraRows = buttons.sectionRows(section, sections, source);

  await interaction.reply({ embeds: [embeds[0]], components: extraRows, flags: MessageFlags.Ephemeral });

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

  let botMember = null;
  try {
    botMember = await withTimeout(guild.members.fetchMe(), 15000, 'бот на сервере');
  } catch (err) {
    console.log(`  [!] ${err.message} — продолжаю запуск.`);
  }

  // Гарантируем, что кэш ролей и каналов заполнен (но не ждём вечно)
  await withTimeout(guild.roles.fetch(), 15000, 'роли').catch(() => {});
  await withTimeout(guild.channels.fetch(), 15000, 'каналы').catch(() => {});

  // Эмодзи: собираем со всех серверов бота и из emojis.json
  await withTimeout(emojis.refresh(client, { force: true }), 20000, 'эмодзи').catch(() => {});
  console.log(`  Эмодзи в базе: ${emojis.size()}`);

  if (botMember && !botMember.permissions.has(PermissionFlagsBits.UseExternalEmojis)) {
    console.log('  [!] У бота нет права «Использовать внешние эмодзи».');
    console.log('      Эмодзи с других серверов не отобразятся — включи право в настройках роли бота.');
    console.log('');
  }

  // Учимся эмодзи из готовых записей <:name:id> прямо из текстов
  for (const section of Object.values(nav.SECTIONS)) {
    emojis.learn(section?.text);
  }

  const unknown = new Set();
  for (const section of Object.values(nav.SECTIONS)) {
    for (const name of emojis.missing(section?.text)) unknown.add(name);
  }
  if (unknown.size > 0) {
    console.log(`  [i] Эмодзи не найдены: ${[...unknown].map((n) => ':' + n + ':').join(', ')}`);
    console.log('      Добавь их ID в emojis.json или пригласи бота на сервер с ними.');
    console.log('');
  }

  // Раз в 10 минут подхватываем новые эмодзи
  setInterval(() => {
    emojis.refresh(client, { force: true }).catch(() => {});
  }, 10 * 60 * 1000).unref?.();

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

// Появился новый сервер — сразу подтягиваем его эмодзи
client.on('guildCreate', () => {
  emojis.refresh(client, { force: true }).catch(() => {});
});

// Кто-то пришёл или ушёл — счётчик участников больше не актуален.
// (Срабатывает, если у бота включено право «Участники сервера»;
// без него число всё равно обновится при следующем показе раздела.)
client.on('guildMemberAdd', (member) => memberCountCache.delete(member.guild.id));
client.on('guildMemberRemove', (member) => memberCountCache.delete(member.guild.id));

// ---------------------------------------------------------------------------
// Обработка слеш-команд
// ---------------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const id = interaction.customId;

    // nav:* — обычная навигация, test:* — кнопки команды /тест
    if (id.startsWith('nav:')) {
      try {
        await sendSection(interaction, id.slice(4), 'nav');
      } catch (err) {
        console.log(`  [!] Ошибка навигации: ${err.message}`);
      }
      return;
    }

    if (id.startsWith('test:')) {
      try {
        await sendSection(interaction, id.slice(5), 'test');
      } catch (err) {
        console.log(`  [!] Ошибка тестовой навигации: ${err.message}`);
      }
      return;
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'навигация' || interaction.commandName === 'тест') {
      const isTest = interaction.commandName === 'тест';
      const icon = interaction.guild?.iconURL({ size: 256 });

      const embed = new EmbedBuilder()
        .setAuthor({ name: '༻𝐒𝐋𝐄𝐍𝐃𝐘𝐖𝐈𝐍𝐆༺', iconURL: icon ?? undefined })
        .setColor(isTest ? nav.TEST_SECTION_COLOR : nav.SECTION_COLOR);

      const bannerUrl = isTest ? nav.TEST_BANNER_URL : nav.BANNER_URL;
      if (bannerUrl) embed.setImage(bannerUrl);

      // Отвечаем невидимо, а карточку отправляем обычным сообщением —
      // так над ботом не появляется «использовал /навигацию»
      await interaction.reply({ content: 'Навигация отправлена 👇', flags: MessageFlags.Ephemeral });
      await interaction.channel.send({
        embeds: [embed],
        components: isTest ? testNavRows() : navRows(),
      });
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
