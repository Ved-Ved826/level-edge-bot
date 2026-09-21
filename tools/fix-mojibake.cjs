// Декодер mojibake: UTF-8-русский текст, испорченный чтением как CP1251.
// Алгоритм: найти максимальные последовательности не-ASCII символов,
// перекодировать каждый символ в его байт CP1251 и попытаться прочитать
// байты как UTF-8. Если получилось валидно и "санитарно" — заменить.
// Использование:
//   node tools/fix-mojibake.cjs analyze <файл...>   — только отчёт, без записи
//   node tools/fix-mojibake.cjs fix <файл...>       — запись исправленных копий
'use strict';
const fs = require('fs');
const path = require('path');

// --- Таблица CP1251 (байт -> символ), обратная карта строится из неё ---
const b2c = [];
for (let b = 0; b < 0x80; b++) b2c[b] = String.fromCharCode(b);
const specials = [
  [0x80, 0x0402], [0x81, 0x0403], [0x82, 0x201A], [0x83, 0x0453], [0x84, 0x201E],
  [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x20AC], [0x89, 0x2030],
  [0x8A, 0x0409], [0x8B, 0x2039], [0x8C, 0x040A], [0x8D, 0x040C], [0x8E, 0x040B],
  [0x8F, 0x040F], [0x90, 0x0452], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201C],
  [0x94, 0x201D], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x0098],
  [0x99, 0x2122], [0x9A, 0x0459], [0x9B, 0x203A], [0x9C, 0x045A],
  [0x9D, 0x045C], [0x9E, 0x045B],
  [0x9E, 0x045B], [0x9F, 0x045F], [0xA0, 0x00A0], [0xA1, 0x040E], [0xA2, 0x045E], [0xA3, 0x0408],
  [0xA4, 0x00A4], [0xA5, 0x0490], [0xA6, 0x00A6], [0xA7, 0x00A7], [0xA8, 0x0401],
  [0xA9, 0x00A9], [0xAA, 0x0404], [0xAB, 0x00AB], [0xAC, 0x00AC], [0xAD, 0x00AD],
  [0xAE, 0x00AE], [0xAF, 0x0407], [0xB0, 0x00B0], [0xB1, 0x00B1], [0xB2, 0x0406],
  [0xB3, 0x0456], [0xB4, 0x0491], [0xB5, 0x00B5], [0xB6, 0x00B6], [0xB7, 0x00B7],
  [0xB8, 0x0451], [0xB9, 0x2116], [0xBA, 0x0454], [0xBB, 0x00BB], [0xBC, 0x0458],
  [0xBD, 0x0405], [0xBE, 0x0455], [0xBF, 0x0457],
];
for (const [b, c] of specials) b2c[b] = String.fromCharCode(c);
for (let i = 0; i < 32; i++) b2c[0xC0 + i] = String.fromCharCode(0x0410 + i); // А..Я
for (let i = 0; i < 32; i++) b2c[0xE0 + i] = String.fromCharCode(0x0430 + i); // а..я

const c2b = new Map();
b2c.forEach((ch, b) => { if (!c2b.has(ch)) c2b.set(ch, b); });

// --- Строгий декодер UTF-8 (возвращает null при любой ошибке) ---
function utf8DecodeStrict(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp, len;
    if (b < 0x80) { cp = b; len = 1; }
    else if (b < 0xC0) return null; // одинокий байт продолжения
    else if (b < 0xE0) { cp = b & 0x1F; len = 2; }
    else if (b < 0xF0) { cp = b & 0x0F; len = 3; }
    else if (b < 0xF8) { cp = b & 0x07; len = 4; }
    else return null;
    if (i + len > bytes.length) return null;
    for (let k = 1; k < len; k++) {
      const c = bytes[i + k];
      if ((c & 0xC0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3F);
    }
    if (len === 2 && cp < 0x80) return null;   // overlong
    if (len === 3 && cp < 0x800) return null;  // overlong
    if (len === 4 && cp < 0x10000) return null;
    if (cp >= 0xD800 && cp <= 0xDFFF) return null;
    if (cp > 0x10FFFF) return null;
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

// --- Санитарная проверка: декод должен состоять из разумных символов ---
function isSane(t) {
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    if (cp < 0x7F) continue; // ASCII
    if (cp === 0x00A0 || cp === 0x00AD) continue; // NBSP, soft hyphen
    if (cp >= 0x00A9 && cp <= 0x00BB) continue; // © « ¬ ® ° ± µ · »
    if (cp === 0x2116 || cp === 0x20AC || cp === 0x2122) continue; // № € ™
    if (cp >= 0x0401 && cp <= 0x0451) continue; // Ё/ё и основной кириллический блок
    if (cp >= 0x2000 && cp <= 0x206F) continue; // тире, кавычки, …, • и т.п.
    if (cp === 0x2009 || cp === 0x200D || cp === 0xFE0F) continue;
    if (cp >= 0x2190 && cp <= 0x2BFF) continue; // стрелки, звёзды, символы
    if (cp >= 0x1F000 && cp <= 0x1FAFF) continue; // эмодзи
    return false;
  }
  return true;
}

// --- Декодирование одной последовательности ---
function decodeRun(run) {
  const bytes = [];
  for (const ch of run) {
    const b = c2b.get(ch);
    if (b === undefined || b < 0x80) return null;
    bytes.push(b);
  }
  const decoded = utf8DecodeStrict(bytes);
  if (decoded === null) return null;
  if (!isSane(decoded)) return null;
  return decoded;
}

// --- Обработка файла в памяти ---
function processText(src, fileLabel, report, write) {
  let out = '';
  let last = 0;
  let replaced = 0;
  let kept = 0;
  const re = /[^{\x00-\x7F}]+/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const run = m[0];
    const decoded = decodeRun(run);
    if (decoded !== null && decoded !== run) {
      // Вычислить строку для отчёта
      const line = src.slice(0, m.index).split('\n').length;
      if (report && write) {
        report.push(`${fileLabel}:${line}: ${JSON.stringify(run).slice(0, 80)} -> ${JSON.stringify(decoded).slice(0, 80)}`);
      }
      out += src.slice(last, m.index) + decoded;
      last = m.index + run.length;
      replaced++;
    } else if (decoded === null && /[^{\x00-\x7F}]/.test(run)) {
      // Не декодируется — но проверить, не mojibake ли это частично
      // (чистая кириллица/эмодзи проходит мимо без записи)
      if (write && /[РрСс][Ђ-ї°µ¶·ё№є»јЅѕї]/.test(run)) {
        report && report.push(`${fileLabel}:${src.slice(0, m.index).split('\n').length}: SUSPECT-KEPT ${JSON.stringify(run).slice(0, 100)}`);
      }
      kept++;
    }
  }
  out += src.slice(last);
  return { out, replaced, kept };
}

const mode = process.argv[2];
const files = process.argv.slice(3);
if (!mode || !files.length) {
  console.error('Использование: node tools/fix-mojibake.cjs analyze|fix <файл...>');
  process.exit(1);
}

const report = [];
let totalReplaced = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const { out, replaced, kept } = processText(src, f, report, true);
  totalReplaced += replaced;
  if (mode === 'fix') {
    if (out !== src) {
      fs.writeFileSync(f, out, 'utf8');
      console.log(`${f}: исправлено фрагментов ${replaced}, пропущено ${kept}`);
    } else {
      console.log(`${f}: без изменений (${replaced} замен)`);
    }
  } else {
    console.log(`${f}: можно исправить ${replaced}, некодируемых фрагментов ${kept}`);
  }
}
if (report.length) {
  fs.writeFileSync('tools/mojibake-report.txt', report.join('\n'), 'utf8');
  console.log(`Отчёт: tools/mojibake-report.txt (${report.length} строк)`);
}
console.log(`Итого фрагментов: ${totalReplaced}`);
