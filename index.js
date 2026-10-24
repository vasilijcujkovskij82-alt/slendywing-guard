'use strict';

const path = require('node:path');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

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
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('SlendyWing Guard работает');
    })
    .listen(Number(PORT), () => {
      console.log(`  HTTP-порт ${PORT} открыт (для хостинга)`);
    });
}
