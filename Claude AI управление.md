# AgentMux — Implementation Plan for Claude Code

## Обзор

AgentMux — CLI-мультиплексор для AI-кодинг агентов (Claude Code, Codex, Aider, Gemini CLI и др.) с TUI-интерфейсом. Переключение между агентами стрелками, автоматический роутинг задач, параллельный запуск.

---

## Техстек

- **Runtime:** Node.js ≥ 20
- **Язык:** TypeScript (strict mode)
- **TUI:** Ink 5 (React-компоненты для терминала)
- **PTY:** node-pty (для полноценного терминального взаимодействия с агентами)
- **CLI:** Commander.js
- **Конфиг:** cosmiconfig (поддержка .agentmux.yml / .agentmux.json / agentmux.config.js)
- **Логи:** pino
- **Тесты:** Vitest
- **Сборка:** tsup
- **Пакетный менеджер:** pnpm

---

## Порядок реализации

Реализовать поэтапно. Каждый этап — рабочий инкремент.

---

### Этап 1: Скаффолдинг проекта

Создай структуру проекта:

```
agentmux/
├── src/
│   ├── cli/
│   │   ├── index.ts          # entry point
│   │   └── commands/
│   │       ├── run.ts
│   │       ├── pipe.ts
│   │       └── interactive.ts
│   ├── adapters/
│   │   ├── types.ts          # интерфейсы
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   ├── aider.ts
│   │   └── custom.ts
│   ├── core/
│   │   ├── process-manager.ts
│   │   ├── router.ts
│   │   ├── pipeline.ts
│   │   └── session.ts
│   ├── tui/
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── AgentTabs.tsx
│   │       ├── AgentView.tsx
│   │       ├── SplitView.tsx
│   │       ├── StatusBar.tsx
│   │       └── InputBar.tsx
│   └── config/
│       ├── loader.ts
│       ├── defaults.ts
│       └── schema.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── .agentmux.example.yml
└── README.md
```

**package.json:**

```json
{
  "name": "agentmux",
  "version": "0.1.0",
  "description": "Multi-agent CLI orchestrator for AI coding agents",
  "type": "module",
  "bin": {
    "agentmux": "./dist/cli/index.js",
    "amux": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "start": "node dist/cli/index.js",
    "test": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "ink": "^5.1.0",
    "react": "^18.3.1",
    "node-pty": "^1.0.0",
    "commander": "^12.1.0",
    "cosmiconfig": "^9.0.0",
    "yaml": "^2.6.0",
    "zod": "^3.23.0",
    "pino": "^9.5.0",
    "chalk": "^5.3.0",
    "strip-ansi": "^7.1.0",
    "tree-kill": "^1.2.2"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "typescript": "^5.6.0",
    "tsup": "^8.3.0",
    "vitest": "^2.1.0",
    "ink-testing-library": "^4.0.0"
  }
}
```

**tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**tsup.config.ts:**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  // node-pty — нативный модуль, не бандлить
  external: ["node-pty"],
});
```

---

### Этап 2: Интерфейсы и типы адаптеров

**src/adapters/types.ts:**

```typescript
export type AgentStatus = "idle" | "spawning" | "running" | "error" | "done";

export interface AgentOutput {
  type: "stdout" | "stderr" | "system";
  data: string;
  timestamp: number;
}

export interface AgentInfo {
  name: string;
  displayName: string;
  description: string;
  command: string;
  isInstalled: boolean;
}

export interface AgentProcess {
  /** Отправить текст на stdin агента */
  send(input: string): void;

  /** Поток вывода агента */
  output: AsyncIterable<AgentOutput>;

  /** Текущий статус */
  status: AgentStatus;

  /** Весь накопленный вывод */
  buffer: AgentOutput[];

  /** Убить процесс */
  kill(): Promise<void>;

  /** Promise, который резолвится когда агент завершится */
  done: Promise<{ exitCode: number }>;
}

export interface AgentAdapter {
  readonly info: AgentInfo;

  /** Проверить, установлен ли агент в системе */
  checkInstalled(): Promise<boolean>;

  /** Запустить агента с задачей */
  spawn(task: string, options?: SpawnOptions): AgentProcess;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  args?: string[];
}
```

---

### Этап 3: Адаптер Claude Code

**src/adapters/claude-code.ts:**

Реализация адаптера для Claude Code. Ключевые моменты:

- Claude Code запускается командой `claude` 
- Для неинтерактивного режима: `claude -p "задача"` (print mode — выполняет задачу и выводит результат)
- Для интерактивного режима: запускаем `claude` через PTY и работаем как с обычным терминалом
- Нужно стримить вывод через node-pty
- При обнаружении промпта "yes/no" — прокидывать в TUI для подтверждения пользователем

```typescript
import * as pty from "node-pty";
import { AgentAdapter, AgentProcess, AgentOutput, AgentInfo, SpawnOptions, AgentStatus } from "./types.js";
import { EventEmitter } from "events";

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly info: AgentInfo = {
    name: "claude-code",
    displayName: "Claude Code",
    description: "Anthropic's AI coding agent",
    command: "claude",
    isInstalled: false,
  };

  async checkInstalled(): Promise<boolean> {
    // проверить наличие `claude` в PATH через which/where
    // вернуть true/false и обновить info.isInstalled
  }

  spawn(task: string, options?: SpawnOptions): AgentProcess {
    // 1. Запустить PTY: pty.spawn("claude", ["-p", task], { cwd, env, ... })
    // 2. Обернуть в AgentProcess
    // 3. Парсить вывод, стримить через AsyncIterable
    // 4. Обрабатывать exit
  }
}
```

Важно при реализации:

- Использовать `node-pty` для spawn, чтобы сохранить ANSI-цвета и интерактивность
- Буферизировать вывод в массив `AgentOutput[]`
- При ошибке spawn (агент не найден) — выбрасывать понятную ошибку
- Для `send()` — писать в `ptyProcess.write(input)`
- Для `kill()` — использовать `tree-kill` чтобы убить все дочерние процессы

---

### Этап 4: Адаптер Codex

**src/adapters/codex.ts:**

- Codex CLI запускается командой `codex`
- Неинтерактивный режим: `codex "задача"`
- Аналогичная реализация через PTY
- Поддержка флага `--model` для выбора модели

---

### Этап 5: Process Manager

**src/core/process-manager.ts:**

Центральный менеджер процессов:

```typescript
export class ProcessManager {
  private sessions: Map<string, AgentProcess> = new Map();

  /** Запустить агента и вернуть session ID */
  async start(adapter: AgentAdapter, task: string, opts?: SpawnOptions): Promise<string>;

  /** Получить процесс по ID */
  get(sessionId: string): AgentProcess | undefined;

  /** Список всех активных сессий */
  list(): Array<{ id: string; agent: string; status: AgentStatus; task: string }>;

  /** Отправить ввод в конкретную сессию */
  send(sessionId: string, input: string): void;

  /** Остановить сессию */
  stop(sessionId: string): Promise<void>;

  /** Остановить все */
  stopAll(): Promise<void>;
}
```

---

### Этап 6: TUI (Terminal UI)

Главный компонент приложения. Используем Ink (React для терминала).

**src/tui/App.tsx — главный компонент:**

```tsx
// Основная структура:
// ┌─────────────────────────────────────────┐
// │  [● Claude Code] [○ Codex] [○ Aider]   │  ← AgentTabs
// ├─────────────────────────────────────────┤
// │                                         │
// │  Вывод активного агента                 │  ← AgentView
// │  стримится в реальном времени           │
// │                                         │
// ├─────────────────────────────────────────┤
// │  Status: running | Tokens: 1.2k | $0.03 │  ← StatusBar
// ├─────────────────────────────────────────┤
// │  > ввод команды...                      │  ← InputBar
// └─────────────────────────────────────────┘

import React, { useState, useEffect } from "react";
import { Box, useInput, useApp } from "ink";
import { AgentTabs } from "./components/AgentTabs.js";
import { AgentView } from "./components/AgentView.js";
import { StatusBar } from "./components/StatusBar.js";
import { InputBar } from "./components/InputBar.js";

export function App({ processManager, adapters }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [sessions, setSessions] = useState([]);
  const { exit } = useApp();

  // Навигация стрелками
  useInput((input, key) => {
    if (key.leftArrow) {
      setActiveIndex((i) => Math.max(0, i - 1));
    }
    if (key.rightArrow) {
      setActiveIndex((i) => Math.min(sessions.length - 1, i + 1));
    }
    if (key.escape) {
      // выход из фокуса
    }
    if (input === "q" && key.ctrl) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <AgentTabs sessions={sessions} activeIndex={activeIndex} />
      <AgentView session={sessions[activeIndex]} />
      <StatusBar session={sessions[activeIndex]} />
      <InputBar onSubmit={(text) => { /* send to active agent */ }} />
    </Box>
  );
}
```

**src/tui/components/AgentTabs.tsx:**

```tsx
// Рендерит табы: [● Claude Code: рефакторинг] [○ Codex: idle]
// Активный таб выделен цветом/жирным
// Статус отображается цветной точкой:
//   ● зелёный = running
//   ○ серый = idle
//   ● красный = error
//   ✓ = done
```

**src/tui/components/AgentView.tsx:**

```tsx
// Основная область — отображает буфер вывода активного агента
// Авто-скролл вниз при новом выводе
// Поддержка ANSI-цветов (strip-ansi НЕ нужен для отображения, только для логов)
// При пустом буфере — показать "Ожидание вывода..."
```

**src/tui/components/StatusBar.tsx:**

```tsx
// Нижняя строка:
// Agent: Claude Code | Status: running | Uptime: 2m 13s
// Подсказки по клавишам: ←/→ switch | Enter focus | Ctrl+Q quit
```

**src/tui/components/InputBar.tsx:**

```tsx
// Текстовое поле для ввода
// Enter → отправить текст в stdin активного агента через processManager.send()
// Показывает, какому агенту уходит ввод: "Claude Code > "
```

---

### Этап 7: CLI Entry Point

**src/cli/index.ts:**

```typescript
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { App } from "../tui/App.js";
import { ProcessManager } from "../core/process-manager.js";
import { loadConfig } from "../config/loader.js";

const program = new Command();

program
  .name("agentmux")
  .description("Multi-agent CLI orchestrator")
  .version("0.1.0");

// Интерактивный режим (по умолчанию)
program
  .command("interactive", { isDefault: true })
  .description("Launch interactive TUI")
  .action(async () => {
    const config = await loadConfig();
    const pm = new ProcessManager();
    render(React.createElement(App, { processManager: pm, config }));
  });

// Запуск задачи
program
  .command("run <task>")
  .description("Run a task with an agent")
  .option("-a, --agent <name>", "Agent to use", "auto")
  .option("-p, --parallel <agents>", "Run on multiple agents in parallel")
  .action(async (task, opts) => {
    // если --parallel: запустить несколько агентов, показать SplitView
    // если --agent: запустить конкретного
    // если auto: использовать роутер
  });

// Pipeline
program
  .command("pipe <steps...>")
  .description("Run agents in a pipeline")
  .action(async (steps) => {
    // парсить "agent: task" из каждого шага
    // запускать последовательно, передавая output → input
  });

program.parse();
```

---

### Этап 8: Конфигурация

**src/config/schema.ts — Zod-схема конфига:**

```typescript
import { z } from "zod";

export const AgentConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  enabled: z.boolean().default(true),
});

export const RouterRuleSchema = z.object({
  match: z.string(), // regex-паттерн
  agent: z.string(),
  reason: z.string().optional(),
});

export const ConfigSchema = z.object({
  default_agent: z.string().default("claude-code"),
  agents: z.record(AgentConfigSchema).default({
    "claude-code": { command: "claude", args: [], env: {}, enabled: true },
    codex: { command: "codex", args: [], env: {}, enabled: true },
  }),
  router: z
    .object({
      mode: z.enum(["auto", "rules", "manual"]).default("manual"),
      rules: z.array(RouterRuleSchema).default([]),
    })
    .default({}),
  ui: z
    .object({
      theme: z.enum(["dark", "light"]).default("dark"),
      show_tokens: z.boolean().default(false),
      show_cost: z.boolean().default(false),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
```

**src/config/loader.ts:**

```typescript
import { cosmiconfig } from "cosmiconfig";
import { ConfigSchema } from "./schema.js";

export async function loadConfig() {
  const explorer = cosmiconfig("agentmux");
  const result = await explorer.search();
  const raw = result?.config ?? {};
  return ConfigSchema.parse(raw);
}
```

---

### Этап 9: Роутер

**src/core/router.ts:**

```typescript
import type { Config } from "../config/schema.js";

export class Router {
  constructor(private config: Config) {}

  /** Определить агента для задачи */
  async route(task: string): Promise<string> {
    const mode = this.config.router.mode;

    if (mode === "manual") {
      return this.config.default_agent;
    }

    if (mode === "rules") {
      for (const rule of this.config.router.rules) {
        const regex = new RegExp(rule.match, "i");
        if (regex.test(task)) {
          return rule.agent;
        }
      }
      return this.config.default_agent;
    }

    if (mode === "auto") {
      // Вызвать лёгкую LLM для классификации задачи
      // На будущее — пока fallback на rules → default
      return this.config.default_agent;
    }

    return this.config.default_agent;
  }
}
```

---

### Этап 10: Pipeline

**src/core/pipeline.ts:**

```typescript
export interface PipelineStep {
  agent: string;
  task: string;
}

export class Pipeline {
  constructor(
    private steps: PipelineStep[],
    private processManager: ProcessManager,
    private adapters: Map<string, AgentAdapter>
  ) {}

  async execute(): AsyncIterable<{ step: number; agent: string; output: AgentOutput }> {
    let previousOutput = "";

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const adapter = this.adapters.get(step.agent);
      
      // Комбинируем задачу с выводом предыдущего шага
      const fullTask = previousOutput
        ? `${step.task}\n\nКонтекст от предыдущего агента:\n${previousOutput}`
        : step.task;

      const sessionId = await this.processManager.start(adapter, fullTask);
      const process = this.processManager.get(sessionId);

      let stepOutput = "";
      for await (const chunk of process.output) {
        stepOutput += chunk.data;
        yield { step: i, agent: step.agent, output: chunk };
      }

      previousOutput = stepOutput;
    }
  }
}
```

---

## Пример конфига (.agentmux.example.yml)

```yaml
# AgentMux Configuration
# Скопируй как .agentmux.yml в корень проекта

default_agent: claude-code

agents:
  claude-code:
    command: claude
    enabled: true

  codex:
    command: codex
    args: ["--model", "o4-mini"]
    enabled: true

  aider:
    command: aider
    args: ["--model", "sonnet"]
    enabled: false

router:
  mode: rules   # auto | rules | manual
  rules:
    - match: "тест|test|spec|coverage"
      agent: codex
      reason: "Codex хорош для генерации тестов"

    - match: "рефакторинг|refactor|clean"
      agent: claude-code

    - match: "документация|docs|readme|comment"
      agent: claude-code

ui:
  theme: dark
  show_tokens: false
  show_cost: false
```

---

## Критические требования

1. **PTY обязателен.** Агенты — интерактивные CLI-приложения с ANSI-выводом. Простой `child_process.spawn` не подойдёт — нужен `node-pty` для полноценного терминального взаимодействия.

2. **Graceful shutdown.** При выходе из AgentMux — корректно завершать все дочерние процессы через `tree-kill`. Обработать SIGINT, SIGTERM.

3. **Буферизация вывода.** Каждый агент должен хранить весь свой вывод в буфере, чтобы при переключении табов пользователь видел полную историю.

4. **Обработка ошибок при spawn.** Если агент не установлен — показать понятное сообщение: "Claude Code не найден. Установите: npm i -g @anthropic-ai/claude-code"

5. **Не блокировать event loop.** Стриминг вывода от агентов должен быть асинхронным. Использовать AsyncIterable или EventEmitter.

6. **ANSI passthrough.** Вывод агентов содержит ANSI escape-коды (цвета, курсор). TUI должен их корректно отображать.

---

## Команды для тестирования

```bash
# После сборки:
pnpm build

# Запуск TUI
node dist/cli/index.js

# Или через npm link:
pnpm link --global
agentmux

# Запуск задачи
agentmux run "создай файл hello.ts с функцией hello world"
agentmux run --agent codex "напиши тесты для utils.ts"

# Параллельный
agentmux run --parallel claude-code,codex "оптимизируй эту функцию"

# Pipeline
agentmux pipe "claude-code: найди баги в src/" "codex: исправь найденные баги"
```

---

## Начни с этого

1. Инициализируй проект: `pnpm init`, установи зависимости
2. Создай структуру папок
3. Реализуй `adapters/types.ts` → `adapters/claude-code.ts`
4. Реализуй `core/process-manager.ts`
5. Реализуй TUI: `App.tsx` с `AgentTabs` и `AgentView`
6. Свяжи всё в `cli/index.ts`
7. Протестируй: `agentmux` → должен открыться TUI → стрелками переключай табы
