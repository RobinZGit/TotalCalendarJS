# AGENT_CONTEXT — контекст проекта для агентов

Обновляется перед каждым push (см. `.cursor/rules/save-context-before-push.mdc`).

- **Дата:** 2026-08-26
- **Ветка:** master, синхронизирована с origin/master
- **Версия:** 25 (2026-08-26; счётчик в шапке index.html + app-build.txt)

## Состояние

Локальный клон `C:\Users\Сергей\VsCodeProjects\TotalCalendarJS` репозитория https://github.com/RobinZGit/TotalCalendarJS. Основной файл — `index.html` (монолит: данные тренировок + вся логика). Веб-версия: github.io/TotalCalendarJS; APK собирает CI.

## Сделано в этой сессии

1. **GitHub Release для APK:** добавлен шаг `Create GitHub Release with APK` в `.github/workflows/build-android-apk.yml` (action `softprops/action-gh-release@v2`). После сборки APK автоматически создаётся GitHub Release с тегом `auto-build-<run_number>` и APK прикреплён как ассет — доступен для скачивания напрямую со страницы Releases без логина в Actions.

## Проверка

- Синтаксис workflow валиден; теги auto-build уникальны за счёт `github.run_number`.
- Версия поднята 24 → 25 во всех трёх точках (верхний комментарий, `tcjs-app-build`, `app-build.txt`).

## Открытые вопросы / ограничения

- Озвученный MP3 зависит от поддержки захвата звука вкладки (ПК Chrome/Edge); на Android рассчитывать на кнопку «таймер-дорожка».
- Для попадания исправлений в APK нужен пересбор CI.
