#!/usr/bin/env python3
"""Export Cursor agent-transcripts for this project to a readable Markdown file."""
import json
import glob
import os
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
TRANSCRIPTS_BASE = os.path.join(
    os.path.expanduser("~"),
    ".cursor",
    "projects",
    "c-Users-VsCodeProjects-TotalCalendarJS",
    "agent-transcripts",
)
OUTPUT = os.path.join(REPO_ROOT, "docs", "cursor-chat-history-totalcalendarjs.md")


def extract_text(msg: dict) -> str:
    content = msg.get("message", {}).get("content") or msg.get("content") or []
    if isinstance(content, str):
        return content.strip()
    parts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
            parts.append(block["text"].strip())
    return "\n\n".join(p for p in parts if p)


def main() -> None:
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    files = []
    for path in glob.glob(os.path.join(TRANSCRIPTS_BASE, "**", "*.jsonl"), recursive=True):
        files.append((os.path.getmtime(path), path))
    files.sort()

    out: list[str] = []
    out.append("# История переписки Cursor — TotalCalendarJS\n\n")
    out.append(f"Экспорт: **{datetime.now().strftime('%Y-%m-%d %H:%M')}**\n\n")
    out.append(
        "Источник: локальные транскрипты Cursor "
        "(`%USERPROFILE%\\.cursor\\projects\\...\\agent-transcripts`).\n\n"
    )
    out.append(
        "> В экспорте только текст сообщений пользователя и ассистента. "
        "Вызовы инструментов и служебные блоки в исходных jsonl могут быть сокращены.\n\n"
    )
    out.append("---\n")

    for session_num, (mtime, path) in enumerate(files, 1):
        sid = os.path.basename(path).replace(".jsonl", "")
        when = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        out.append(f"\n## Сессия {session_num} — {when}\n\n")
        out.append(f"ID: `{sid}`\n\n")

        with open(path, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    out.append(f"> *(строка {line_no}: не JSON)*\n\n")
                    continue

                role = obj.get("role", "unknown")
                text = extract_text(obj)
                if not text or text.strip() == "[REDACTED]":
                    continue

                label = "**Вы**" if role == "user" else "**Ассистент**"
                out.append(f"### {label}\n\n")
                out.append(text + "\n\n")
                out.append("---\n\n")

    with open(OUTPUT, "w", encoding="utf-8") as wf:
        wf.write("".join(out))

    print(f"Wrote: {OUTPUT}")
    print(f"Size: {os.path.getsize(OUTPUT):,} bytes")
    print(f"Sessions: {len(files)}")


if __name__ == "__main__":
    main()
