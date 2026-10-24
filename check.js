'use strict';

// Проверяет, вписан ли токен в файл .env

const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(__dirname, '.env');

let token = '';
try {
  const text = fs.readFileSync(envPath, 'utf8');
  const match = text.match(/^\s*TOKEN\s*=\s*(.*)$/m);
  if (match) token = match[1].trim().replace(/^["']|["']$/g, '');
} catch {
  // файла нет
}

if (token.length >= 30 && !token.includes('ВСТАВЬ')) {
  process.exit(0);
}

console.log('');
console.log('  Токен не найден или вписан неверно.');
console.log('');
console.log('  Сейчас откроется Блокнот с файлом .env.');
console.log('  Впиши токен сразу после TOKEN= (без кавычек и пробелов),');
console.log('  нажми Ctrl+S, затем закрой Блокнот.');
console.log('');
process.exit(1);
