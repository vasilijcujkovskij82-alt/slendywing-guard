'use strict';

// Локальный редактор текстов навигации.
// Запуск: "Редактор.bat" -> откроется http://127.0.0.1:3060

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CONTENT_PATH = path.join(ROOT, 'content.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = 3060;

const GIT = fs.existsSync('C:\\Program Files\\Git\\cmd\\git.exe')
  ? 'C:\\Program Files\\Git\\cmd\\git.exe'
  : 'git';

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

      const add = runGit(['add', 'content.json']);
      if (!add.ok) return send(res, 500, JSON.stringify({ ok: false, error: add.out }));

      const commit = runGit(['commit', '-m', 'Update navigation texts via editor']);
      const nothingToCommit = !commit.ok && /nothing to commit/i.test(commit.out);

      if (!commit.ok && !nothingToCommit) {
        return send(res, 500, JSON.stringify({ ok: false, error: commit.out }));
      }

      if (nothingToCommit) {
        return send(res, 200, JSON.stringify({ ok: true, message: 'Сохранено. Изменений нет — деплой не нужен.' }));
      }

      const push = runGit(['push']);
      if (!push.ok) return send(res, 500, JSON.stringify({ ok: false, error: push.out }));

      return send(
        res,
        200,
        JSON.stringify({ ok: true, message: 'Сохранено и отправлено. Render обновится через ~1–2 минуты.' })
      );
    });

    return;
  }

  send(res, 404, JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`  Редактор: http://127.0.0.1:${PORT}`);
  console.log('  Закрой это окно, когда закончишь редактирование.');
});
