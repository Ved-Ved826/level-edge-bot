# -*- coding: utf-8 -*-
"""Восстановление кириллицы в crises.ts: обратное преобразование UTF-8->CP1251->UTF-8.

Строит таблицу "символ cp1251 -> исходный байт" для всех байтов 0x80-0xFF,
с особым случаем U+0098 (байт 0x98 не имеет отображения в cp1251 при encode).
"""
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PATH = r"E:\disbot\collector\src\crises.ts"

# Таблица: байт -> символ cp1251 (0x98 не декодируется -> считаем его U+0098)
byte_to_char = {}
for b in range(0x20, 0x100):
    try:
        byte_to_char[b] = bytes([b]).decode("cp1251")
    except UnicodeDecodeError:
        byte_to_char[b] = chr(b)  # 0x98 и прочие неопределённые -> C1-контролы (latin-1)

char_to_byte = {}
for b, ch in byte_to_char.items():
    if ch not in char_to_byte:  # первый байт побеждает
        char_to_byte[ch] = b


def reverse_once(text: str) -> str:
    """Моjibake-текст -> байты -> UTF-8 строка. Бросает исключение при неудаче."""
    out = []
    for ch in text:
        if ch in char_to_byte:
            out.append(char_to_byte[ch])
        elif ord(ch) < 0x80:
            out.append(ord(ch))
        else:
            raise ValueError(f"символ {ch!r} не в CP1251")
    data = bytes(out)
    return data.decode("utf-8")


with open(PATH, "rb") as f:
    raw = f.read()
had_bom = raw.startswith(b"\xef\xbb\xbf")
text = raw.decode("utf-8-sig")

cur = text
rounds = 0
while rounds < 5:
    try:
        nxt = reverse_once(cur)
    except (UnicodeDecodeError, ValueError):
        # Текст содержит символы вне CP1251 (например, настоящие эмодзи) —
        # значит, после предыдущего раунда он уже нормальный; останавливаемся.
        if rounds > 0:
            break
        print("СТОП на раунде 0: файл не разворачивается")
        sys.exit(1)
    if nxt == cur:
        break
    cur = nxt
    rounds += 1

# Проверки результата (точный набор продолжений-байтов 0x80-0xBF из CP1251)
HIGH = "".join(bytes([b]).decode("cp1251") for b in range(0x80, 0xC0))
PAIR_RE = re.compile("[РС][" + re.escape(HIGH) + "]")
residual = [m.group(0) for m in PAIR_RE.finditer(cur)]
ctrl = [i for i, ch in enumerate(cur) if ord(ch) < 0x20 and ch not in "\t\n\r"]

print(f"BOM был: {had_bom}; раундов: {rounds}; остаточных пар: {len(residual)}; контрол-символов: {len(ctrl)}")
if residual:
    print("ОСТАТКИ:", residual[:10])
    sys.exit(1)

# Пример до/после для отчёта
for old, new in zip(text.splitlines()[:8], cur.splitlines()[:8]):
    if old != new:
        print(f"БЫЛО: {old[:110]}")
        print(f"СТАЛО: {new[:110]}")
        break

with open(PATH, "wb") as f:
    f.write(cur.encode("utf-8"))
print(f"Записано: {PATH} (UTF-8 без BOM), строк: {len(cur.splitlines())}")
