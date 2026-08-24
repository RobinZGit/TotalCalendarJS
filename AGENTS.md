# AGENTS.md — правила для агентов (opencode / Cursor и др.)

## Перед каждым push (обязательно)

1. Поднять номер версии на 1 и обновить дату:
   - комментарий в самом верху `index.html` (`<!-- TotalCalendarJS | Версия N | ГГГГ-ММ-ДД -->`);
   - блок `<script id="tcjs-app-build">` в `index.html`;
   - файл `app-build.txt`.
2. Обновить **`docs/AGENT_CONTEXT.md`** — контекст сессии: дата, ветка, что сделано, как проверено, открытые вопросы.
3. Обновить **`docs/USER_INSTRUCTIONS.md`** — накопленные инструкции пользователя (новые добавляются в конец).
4. Включить все изменения в коммит, только потом пушить.

Подробнее: `.cursor/rules/save-context-before-push.mdc`.

## Git-команды в терминале

Не использовать literal `git commit` (Cursor может внедрить `--trailer`, ломающий PowerShell):
использовать полный путь к git или `git.exe commit …`.
Подробнее: `.cursor/rules/git-commit-terminal.mdc`.
