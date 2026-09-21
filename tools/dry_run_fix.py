# -*- coding: utf-8 -*-
"""Сухая проверка: можно ли целиком восстановить crises.ts обратным преобразованием."""
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

path = r"E:\disbot\collector\src\crises.ts"
with open(path, "rb") as f:
    raw = f.read()

had_bom = raw.startswith(b"\xef\xbb\xbf")
text = raw.decode("utf-8-sig")

cur = text
rounds = 0
while rounds < 5:
    try:
        nxt = cur.encode("cp1251").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError) as e:
        print(f"СТОП на раунде {rounds}: {e}")
        break
    if nxt == cur:
        break
    cur = nxt
    rounds += 1

print(f"BOM: {had_bom}, раундов декодирования: {rounds}")
print("--- Первые 12 строк восстановленного файла ---")
for i, line in enumerate(cur.splitlines()[:12], 1):
    print(f"{i}: {line}")
print("--- Проверка ключевых строк ---")
for i, line in enumerate(cur.splitlines(), 1):
    if "рџ" in line or "вЂ”" in line or "вЊ" in line:
        print(f"ОСТАТКИ БИТЫХ СИМВОЛОВ в строке {i}: {line[:80]}")
        break
else:
    print("OK: битых последовательностей не осталось")
print(f"Всего строк: {len(cur.splitlines())}")
