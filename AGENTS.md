# AGENTS.md — правила для агентов (opencode / Cursor и др.)

## Перед каждым push (обязательно)

1. Обновить **`docs/AGENT_CONTEXT.md`** — контекст сессии: дата, ветка, что сделано, как проверено, открытые вопросы.
2. Обновить **`docs/USER_INSTRUCTIONS.md`** — накопленные инструкции пользователя (новые добавляются в конец).
3. Включить оба файла в коммит, только потом пушить.

Подробнее: `.cursor/rules/save-context-before-push.mdc`.

## Git-команды в терминале

Не использовать literal `git commit` (Cursor может внедрить `--trailer`, ломающий PowerShell):
использовать полный путь к git или `git.exe commit …`.
Подробнее: `.cursor/rules/git-commit-terminal.mdc`.
