'use strict';

// Локальный редактор текстов навигации.
// Запуск: "Редактор.bat" -> откроется http://127.0.0.1:3060

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CONTENT_PATH = path.join(ROOT, 'content.json');
const ROLES_PATH = path.join(ROOT, 'roles.json');
const ADS_PATH = path.join(ROOT, 'ads.json');
const GAMES_PATH = path.join(ROOT, 'games.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = 3060;

const GIT = fs.existsSync('C:\\Program Files\\Git\\cmd\\git.exe')
  ? 'C:\\Program Files\\Git\\cmd\\git.exe'
  : 'git';

// ---------------------------------------------------------------------------
// Список эмодзи для подсказки в редакторе
// ---------------------------------------------------------------------------
const DISCORD_API = 'https://discord.com/api/v10';
const GUILD_ID = '1283395341881835581';

let emojiCache = { at: 0, list: [] };

function readToken() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const line = raw.split(/\r?\n/).find((l) => /^\s*TOKEN\s*=/.test(l));
    if (!line) return '';
    return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

async function apiGet(pathname, token) {
  const res = await fetch(`${DISCORD_API}${pathname}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}`);
  return res.json();
}

async function loadEmojis() {
  if (Date.now() - emojiCache.at < 5 * 60 * 1000 && emojiCache.list.length) return emojiCache.list;

  const token = readToken();
  if (!token) throw new Error('В .env не найден TOKEN');

  const me = await apiGet('/users/@me', token);
  const list = [];

  // Эмодзи приложения — работают на любом сервере
  try {
    const appEmojis = await apiGet(`/applications/${me.id}/emojis`, token);
    for (const e of appEmojis.items || []) {
      list.push({ name: e.name, id: e.id, animated: !!e.animated, source: 'бот' });
    }
  } catch {
    // старые приложения без поддержки — не страшно
  }

  // Эмодзи серверов, где стоит бот
  let guilds = [];
  try {
    guilds = await apiGet('/users/@me/guilds', token);
  } catch {
    guilds = [];
  }

  for (const guild of guilds) {
    try {
      const guildEmojis = await apiGet(`/guilds/${guild.id}/emojis`, token);
      for (const e of guildEmojis) {
        list.push({ name: e.name, id: e.id, animated: !!e.animated, source: guild.name });
      }
    } catch {
      // нет доступа — пропускаем
    }
  }

  const seen = new Set();
  const unique = list
    .filter((e) => {
      const key = e.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  emojiCache = { at: Date.now(), list: unique };
  return unique;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

function runGit(args) {
  const result = spawnSync(GIT, args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return {
    ok: result.status === 0,
    out: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

// Сохраняет файлы, коммитит и отправляет на GitHub.
// Render подхватит изменения по workflow deploy.yml.
function commitAndPush(files, message) {
  const add = runGit(['add', ...files]);
  if (!add.ok) return { ok: false, error: add.out };

  const commit = runGit(['commit', '-m', message]);
  const nothingToCommit =
    !commit.ok && /nothing to commit|nothing added to commit|no changes added to commit/i.test(commit.out);

  if (!commit.ok && !nothingToCommit) return { ok: false, error: commit.out };
  if (nothingToCommit) {
    return { ok: true, message: 'Сохранено. Изменений нет — деплой не нужен.' };
  }

  const push = runGit(['push']);
  if (!push.ok) return { ok: false, error: push.out };

  return { ok: true, message: 'Сохранено и отправлено. Render обновится через ~1–2 минуты.' };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    return send(res, 200, html, 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/api/content') {
    try {
      return send(res, 200, fs.readFileSync(CONTENT_PATH, 'utf8'));
    } catch (err) {
      return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/emojis') {
    loadEmojis()
      .then((list) => send(res, 200, JSON.stringify({ ok: true, emojis: list })))
      .catch((err) => send(res, 200, JSON.stringify({ ok: false, error: err.message, emojis: [] })));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/content') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy();
    });

    req.on('end', () => {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Некорректный JSON' }));
      }

      if (!data || typeof data !== 'object' || !data.sections || typeof data.sections !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля sections' }));
      }

      try {
        fs.writeFileSync(CONTENT_PATH, JSON.stringify(data, null, 2), 'utf8');
      } catch (err) {
        return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
      }

      const result = commitAndPush(['content.json'], 'Update navigation texts via editor');
      return send(res, result.ok ? 200 : 500, JSON.stringify(result));
    });

    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/roles') {
    try {
      return send(res, 200, fs.readFileSync(ROLES_PATH, 'utf8'));
    } catch (err) {
      return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/roles') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy();
    });

    req.on('end', () => {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Некорректный JSON' }));
      }

      if (!data || typeof data !== 'object' || !data.main || typeof data.main !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля main' }));
      }

      if (!data.categories || typeof data.categories !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля categories' }));
      }

      try {
        fs.writeFileSync(ROLES_PATH, JSON.stringify(data, null, 2), 'utf8');
      } catch (err) {
        return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
      }

      const result = commitAndPush(['roles.json'], 'Update role menu via editor');
      return send(res, result.ok ? 200 : 500, JSON.stringify(result));
    });

    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ads') {
    try {
      return send(res, 200, fs.readFileSync(ADS_PATH, 'utf8'));
    } catch (err) {
      return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/ads') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy();
    });

    req.on('end', () => {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Некорректный JSON' }));
      }

      if (!data || typeof data !== 'object' || !data.main || typeof data.main !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля main' }));
      }

      if (!data.publication || typeof data.publication !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля publication' }));
      }

      try {
        fs.writeFileSync(ADS_PATH, JSON.stringify(data, null, 2), 'utf8');
      } catch (err) {
        return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
      }

      const result = commitAndPush(['ads.json'], 'Update ads via editor');
      return send(res, result.ok ? 200 : 500, JSON.stringify(result));
    });

    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/games') {
    try {
      return send(res, 200, fs.readFileSync(GAMES_PATH, 'utf8'));
    } catch (err) {
      return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/games') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4_000_000) req.destroy();
    });

    req.on('end', () => {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Некорректный JSON' }));
      }

      if (!data || typeof data !== 'object' || !data.main || typeof data.main !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля main' }));
      }

      if (!data.games || typeof data.games !== 'object' || Array.isArray(data.games)) {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля games' }));
      }

      if (!data.categories || typeof data.categories !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля categories' }));
      }

      if (!data.achievements || typeof data.achievements !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля achievements' }));
      }

      for (const [key, game] of Object.entries(data.games)) {
        if (!game || typeof game !== 'object') {
          return send(res, 400, JSON.stringify({ ok: false, error: `Игра ${key} должна быть объектом` }));
        }
        if (typeof game.text !== 'string') {
          return send(res, 400, JSON.stringify({ ok: false, error: `У игры ${key} нет текста` }));
        }
        if (game.text.length > 4096) {
          return send(
            res,
            400,
            JSON.stringify({ ok: false, error: `Текст игры ${key} больше 4096 символов — Discord не примет.` })
          );
        }
        if (game.achievements !== 'yes' && game.achievements !== 'no') {
          return send(
            res,
            400,
            JSON.stringify({ ok: false, error: `У игры ${key} в achievements нужно "yes" или "no".` })
          );
        }
        if (game.parent !== undefined && game.parent !== '') {
          if (typeof game.parent !== 'string' || !data.games[game.parent]) {
            return send(
              res,
              400,
              JSON.stringify({ ok: false, error: `У игры ${key} родитель ${game.parent} не найден.` })
            );
          }
          if (game.parent === key) {
            return send(
              res,
              400,
              JSON.stringify({ ok: false, error: `Игра ${key} не может быть под-игрой сама у себя.` })
            );
          }
        }
      }

      for (const [key, game] of Object.entries(data.games)) {
        const seen = new Set([key]);
        let current = game.parent;
        while (current) {
          if (seen.has(current)) {
            return send(
              res,
              400,
              JSON.stringify({ ok: false, error: `Замкнутая вложенность игр вокруг ${key}.` })
            );
          }
          seen.add(current);
          current = data.games[current]?.parent;
        }
      }

      try {
        fs.writeFileSync(GAMES_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
      } catch (err) {
        return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
      }

      const result = commitAndPush(['games.json'], 'Update games catalog via editor');
      return send(res, result.ok ? 200 : 500, JSON.stringify(result));
    });

    return;
  }

  // Сохранение сразу нескольких файлов — используется вкладкой «Кнопки»
  if (req.method === 'POST' && url.pathname === '/api/save-all') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4_000_000) req.destroy();
    });

    req.on('end', () => {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Некорректный JSON' }));
      }

      const content = data?.content;
      const roles = data?.roles;
      const ads = data?.ads;

      if (!content || typeof content !== 'object' || !content.sections || typeof content.sections !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля content.sections' }));
      }

      if (!roles || typeof roles !== 'object' || !roles.main || typeof roles.main !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля roles.main' }));
      }

      if (!roles.categories || typeof roles.categories !== 'object') {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля roles.categories' }));
      }

      if (ads && (typeof ads !== 'object' || !ads.main || typeof ads.main !== 'object')) {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля ads.main' }));
      }

      if (ads && (!ads.publication || typeof ads.publication !== 'object')) {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Нет поля ads.publication' }));
      }

      try {
        fs.writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2), 'utf8');
        fs.writeFileSync(ROLES_PATH, JSON.stringify(roles, null, 2), 'utf8');
        if (ads) fs.writeFileSync(ADS_PATH, JSON.stringify(ads, null, 2), 'utf8');
      } catch (err) {
        return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
      }

      const files = ['content.json', 'roles.json'];
      if (ads) files.push('ads.json');

      const result = commitAndPush(files, 'Update buttons via editor');
      return send(res, result.ok ? 200 : 500, JSON.stringify(result));
    });

    return;
  }

  send(res, 404, JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`  Редактор: http://127.0.0.1:${PORT}`);
  console.log('  Закрой это окно, когда закончишь редактирование.');
});
