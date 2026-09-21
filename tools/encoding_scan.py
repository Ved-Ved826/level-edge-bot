# -*- coding: utf-8 -*-
"""Диагностика mojibake: скан исходников, проверка BOM/UTF-8, статистика по файлам."""
import os
import re
import sys

ROOT = r"E:\disbot"
SKIP_DIRS = {"node_modules", ".git", "venv", "dist", "build", ".wrangler", ".claude"}
EXTS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".json", ".yaml", ".yml",
    ".md", ".txt", ".toml", ".sql", ".html", ".css", ".sh", ".ps1", ".cfg", ".ini",
    ".example", ".env", ".dockerfile", ".svg", ".xml",
}
SPECIAL_NAMES = {"Dockerfile", "docker-compose.yml", ".env.example", ".gitignore", ".npmrc"}

# Символы CP1251 0x80-0xBF (продолжения UTF-8 многобайтных последовательностей, прочитанных как CP1251)
HIGH = "".join(chr(b) for b in range(0x80, 0xC0) if b not in (0x81, 0x8D, 0x8F, 0x90, 0x9D))
# байты 0x81 0x8D 0x8F 0x90 0x9D в cp1251 не имеют отображения? Проверим ниже просто через errors=strict
HIGH = "".join(chr(b) for b in range(0x80, 0xC0))

# Пары "лид + продолжение": лид — буква, чей cp1251-байт = UTF-8 lead (0xC0-0xF4)
LEADS = "РСТУФрстуфвВ"  # D0 D1 D2 D3 D4 F0 F1 F2 F3 F4 E2 D2
PAIR_RE = re.compile("(?:[" + LEADS + "][" + re.escape(HIGH) + "])+")
LEGIT_CYR_RE = re.compile(r"[А-ЯЁ][а-яё]{2,}|[а-яё]{3,}")
BROKEN_MARK_RE = re.compile("[" + re.escape(HIGH) + "]")


def iter_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext in EXTS or fn in SPECIAL_NAMES or fn.startswith(".env"):
                yield os.path.join(dirpath, fn)


def is_mojibake_run(s: str) -> bool:
    """Строгая проверка: строка — это UTF-8, прочитанный как CP1251."""
    try:
        fixed = s.encode("cp1251").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return False
    return fixed != s


def main():
    print("=" * 100)
    print("1) ФАЙЛЫ С ПРИЗНАКАМИ MOJIBAKE (битый текст в исходниках)")
    print("=" * 100)
    broken_files = []
    non_utf8 = []
    bom_files = []
    for path in iter_files():
        rel = os.path.relpath(path, ROOT)
        try:
            with open(path, "rb") as f:
                raw = f.read()
        except (OSError, PermissionError) as e:
            print(f"[SKIP] {rel}: {e}")
            continue
        if raw.startswith(b"\xef\xbb\xbf"):
            bom_files.append(rel)
        if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
            bom_files.append(rel + " (UTF-16 BOM)")
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            non_utf8.append(rel)
            continue
        lines = text.splitlines()
        hits = []
        for i, line in enumerate(lines, 1):
            runs = [m.group(0) for m in PAIR_RE.finditer(line)]
            runs = [r for r in runs if is_mojibake_run(r)]
            if runs:
                hits.append((i, runs))
        if hits:
            broken_files.append((rel, len(hits), hits))

    for rel, n, hits in sorted(broken_files):
        print(f"\n--- {rel}: строк с mojibake = {n}")
        for i, runs in hits[:15]:
            sample = runs[0][:60]
            print(f"    строка {i}: {sample}{' ...' if len(runs) > 1 else ''}")
        if len(hits) > 15:
            print(f"    ... ещё {len(hits) - 15} строк")

    print("\n" + "=" * 100)
    print("2) ФАЙЛЫ НЕ В UTF-8 (не декодируются как UTF-8)")
    print("=" * 100)
    print("\n".join(non_utf8) if non_utf8 else "(нет)")

    print("\n" + "=" * 100)
    print("3) ФАЙЛЫ С BOM")
    print("=" * 100)
    print("\n".join(bom_files) if bom_files else "(нет)")

    print("\n" + "=" * 100)
    print("4) СМЕШАННЫЙ КОНТЕНТ (битый + нормальная кириллица в одном файле)")
    print("=" * 100)
    for rel, n, hits in sorted(broken_files):
        with open(os.path.join(ROOT, rel), "rb") as f:
            text = f.read().decode("utf-8")
        cleaned = PAIR_RE.sub(" ", text)
        legit = LEGIT_CYR_RE.findall(cleaned)
        if legit:
            print(f"\n--- {rel}: есть НОРМАЛЬНАЯ кириллица ({len(legit)} фрагментов), примеры:")
            for frag in legit[:10]:
                print(f"    «{frag}»")
        else:
            print(f"--- {rel}: нормальной кириллицы НЕТ (файл полностью битый)")

    print("\n[EXIT 0]")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
