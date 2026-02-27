# 🚀 AgentMux

**Multi-agent CLI orchestrator** — единый терминал для управления AI-кодинг агентами.

AgentMux запускает Claude Code, Codex и других AI-агентов из одного интерфейса, автоматически распределяет задачи между ними и позволяет в реальном времени переключаться между сессиями агентов.

---

## Проблема

Разработчики используют несколько AI-агентов (Claude Code, Codex CLI, Gemini CLI, Aider и др.), но:

- Каждый запускается отдельно в своём терминале
- Нет единого места для оркестрации задач
- Невозможно сравнить результаты разных агентов на одной задаче
- Переключение между агентами — ручной и неудобный процесс
- Нет способа автоматически выбрать лучшего агента под конкретную задачу

## Решение

AgentMux — CLI-мультиплексор для AI-агентов с TUI-интерфейсом (Terminal UI), который:

- Запускает нескольких агентов параллельно или последовательно
- Автоматически выбирает агента под тип задачи (роутинг)
- Позволяет переключаться между активными сессиями стрелками ←/→
- Показывает статус каждого агента в реальном времени

---

## Архитектура

```
┌─────────────────────────────────────────────────┐
│                  AgentMux CLI                    │
│                                                  │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │  Claude    │  │  Codex    │  │  Custom   │   │
│  │  Code      │  │  CLI      │  │  Agent    │   │
│  │  adapter   │  │  adapter  │  │  adapter  │   │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘   │
│        │              │              │           │
│  ┌─────▼──────────────▼──────────────▼─────┐    │
│  │            Process Manager               │    │
│  │  (spawn, monitor, stream stdout/stderr)  │    │
│  └─────────────────┬───────────────────────┘    │
│                    │                             │
│  ┌─────────────────▼───────────────────────┐    │
│  │              Router / Scheduler          │    │
│  │  (task analysis → agent selection)       │    │
│  └─────────────────┬───────────────────────┘    │
│                    │                             │
│  ┌─────────────────▼───────────────────────┐    │
│  │            TUI (Ink / Blessed)           │    │
│  │  [Claude Code] [Codex] [Agent 3]  ←/→   │    │
│  │  ┌─────────────────────────────────┐     │    │
│  │  │  > Активная сессия агента...    │     │    │
│  │  │  > Вывод в реальном времени     │     │    │
│  │  └─────────────────────────────────┘     │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

## Основные фичи

### 1. Мультиплексор агентов (TUI)

Навигация между агентами через клавиши:

| Клавиша | Действие |
|---------|----------|
| `←` / `→` | Переключение между агентами |
| `Tab` | Следующий агент |
| `Enter` | Фокус на активного агента (ввод команд) |
| `Esc` | Выход из фокуса, возврат в обзор |
| `Ctrl+N` | Запустить нового агента |
| `Ctrl+Q` | Завершить текущего агента |

Верхняя панель показывает табы всех активных агентов со статусами:

```
 [● Claude Code: рефакторинг] [○ Codex: idle] [○ Aider: тесты]
 ─────────────────────────────────────────────────────────────
 > Claude Code анализирует src/utils.ts...
 > Найдено 3 функции для рефакторинга
 > Применяю изменения...
```

### 2. Роутер задач

AgentMux анализирует задачу и автоматически выбирает подходящего агента:

```yaml
# .agentmux.yml — конфиг роутинга
router:
  default: claude-code    # агент по умолчанию

  rules:
    - match: "тесты|test|spec"
      agent: codex
      reason: "Codex хорош для генерации тестов"

    - match: "рефакторинг|refactor"
      agent: claude-code
      reason: "Claude Code лучше понимает контекст проекта"

    - match: "документация|docs|readme"
      agent: claude-code
      reason: "Сильные навыки генерации текста"

    - match: "баг|bug|fix|debug"
      agent: auto           # пусть решает AI-роутер
```

**Режим `auto`** — лёгкая LLM-модель (например, Claude Haiku) классифицирует задачу и выбирает агента на основе описания + текущего контекста проекта.

### 3. Провайдеры (адаптеры агентов)

Каждый агент подключается через адаптер с единым интерфейсом:

```typescript
interface AgentAdapter {
  name: string;
  spawn(task: string, cwd: string): AgentProcess;
  stream(): AsyncIterable<AgentOutput>;
  send(input: string): void;
  stop(): Promise<void>;
  status(): AgentStatus; // 'idle' | 'running' | 'error' | 'done'
}
```

**Встроенные адаптеры:**

| Агент | Команда | Примечания |
|-------|---------|------------|
| Claude Code | `claude` | Основной агент, глубокий контекст проекта |
| Codex CLI | `codex` | OpenAI агент, хорош для кодогенерации |
| Aider | `aider` | Git-интегрированный, хорош для пошаговых правок |
| Gemini CLI | `gemini` | Google агент |
| Custom | любая CLI | Любой CLI-инструмент через конфиг |

**Добавление кастомного агента:**

```yaml
# .agentmux.yml
agents:
  my-agent:
    command: "my-custom-agent"
    args: ["--mode", "code"]
    env:
      API_KEY: "${MY_AGENT_KEY}"
```

### 4. Параллельный запуск

Запуск одной задачи на нескольких агентах для сравнения:

```bash
# Запуск задачи на двух агентах параллельно
agentmux run --parallel claude-code,codex "напиши unit тесты для auth модуля"

# Результат: split-view с выводом обоих агентов
┌──────────────────────┬──────────────────────┐
│  Claude Code         │  Codex               │
│  > Анализирую...     │  > Генерирую...      │
│  > auth.test.ts      │  > auth.spec.ts      │
│  > 12 тестов         │  > 8 тестов          │
└──────────────────────┴──────────────────────┘
```

### 5. Pipeline-режим

Цепочка агентов — выход одного агента → вход следующего:

```bash
agentmux pipe \
  "claude-code: проанализируй код и найди проблемы" \
  "codex: исправь найденные проблемы" \
  "claude-code: напиши тесты для исправлений"
```

---

## Использование

### Установка

```bash
npm install -g agentmux
```

### Быстрый старт

```bash
# Интерактивный режим — TUI с выбором агента
agentmux

# Запуск задачи на дефолтном агенте
agentmux run "добавь валидацию в форму регистрации"

# Запуск конкретного агента
agentmux run --agent codex "напиши тесты для api/users.ts"

# Параллельный режим
agentmux run --parallel claude-code,codex "оптимизируй SQL запросы"

# Pipeline
agentmux pipe "claude-code: найди баги" "codex: исправь"
```

### Конфигурация

```yaml
# .agentmux.yml (в корне проекта)

# Провайдер по умолчанию
default_agent: claude-code

# Настройки агентов
agents:
  claude-code:
    command: claude
    enabled: true

  codex:
    command: codex
    enabled: true
    args: ["--model", "o4-mini"]

  aider:
    command: aider
    enabled: false

# Роутинг
router:
  mode: auto          # auto | rules | manual
  classifier: haiku   # модель для auto-режима

# UI
ui:
  theme: dark
  show_tokens: true    # показывать расход токенов
  show_cost: true      # показывать стоимость
  split_view: vertical # vertical | horizontal
```

---

## Технологии

| Компонент | Технология |
|-----------|-----------|
| Язык | TypeScript |
| Runtime | Node.js ≥ 20 |
| TUI Framework | Ink (React для терминала) |
| Process management | `node:child_process` + PTY (`node-pty`) |
| Конфигурация | cosmiconfig (YAML/JSON/JS) |
| CLI parsing | Commander.js |
| Роутер | Anthropic API (Haiku) / локальные правила |
| Логирование | pino |
| Тестирование | Vitest |

---

## Структура проекта

```
agentmux/
├── src/
│   ├── cli/                  # CLI entry point, команды
│   │   ├── index.ts
│   │   ├── commands/
│   │   │   ├── run.ts        # agentmux run
│   │   │   ├── pipe.ts       # agentmux pipe
│   │   │   └── config.ts     # agentmux config
│   │   └── args.ts
│   │
│   ├── adapters/             # Адаптеры агентов
│   │   ├── base.ts           # AgentAdapter interface
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   ├── aider.ts
│   │   └── custom.ts
│   │
│   ├── core/
│   │   ├── process-manager.ts  # Управление процессами
│   │   ├── router.ts           # Роутинг задач
│   │   ├── pipeline.ts         # Pipeline-режим
│   │   └── session.ts          # Управление сессиями
│   │
│   ├── tui/                  # Terminal UI (Ink)
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── AgentTabs.tsx
│   │   │   ├── AgentView.tsx
│   │   │   ├── SplitView.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   └── InputBar.tsx
│   │   └── hooks/
│   │       ├── useAgents.ts
│   │       └── useKeyboard.ts
│   │
│   └── config/
│       ├── loader.ts         # Загрузка .agentmux.yml
│       └── defaults.ts
│
├── .agentmux.yml             # Пример конфига
├── package.json
├── tsconfig.json
└── README.md
```

---

## Roadmap

- **v0.1** — MVP: запуск Claude Code и Codex из TUI, переключение стрелками
- **v0.2** — Роутинг задач (rules-based), конфиг `.agentmux.yml`
- **v0.3** — Параллельный режим, split-view
- **v0.4** — Pipeline-режим
- **v0.5** — AI-роутер (auto-выбор агента)
- **v0.6** — Кастомные агенты, плагины
- **v1.0** — Стабильный релиз, поддержка Gemini CLI, Aider, метрики стоимости

---

## Лицензия

MIT
