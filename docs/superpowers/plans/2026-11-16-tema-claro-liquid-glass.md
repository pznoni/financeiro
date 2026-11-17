# Tema claro Liquid Glass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o tema escuro por um tema claro com a linguagem visual do iOS 26 (Liquid Glass), sem mudar funções.

**Architecture:** Reescrita de `css/styles.css` mantendo todos os nomes de classe usados pelas telas; ajuste do gesto de arrastar a folha em `js/ui/components.js`; metadados de cor em `index.html`/`manifest.webmanifest`; ícone regenerado.

**Tech Stack:** HTML/CSS/JS puros, sem dependências. Testes: driver CDP (`scratchpad/cdp.mjs`) no Chrome headless em 390×844.

**Spec:** `docs/superpowers/specs/2026-11-16-tema-claro-liquid-glass-design.md`

## Global Constraints
- Fundo agrupado `#F2F2F7`; superfícies `#FFFFFF`; azul `#007AFF`; verde `#34C759`; vermelho `#FF3B30`; laranja `#FF9500`.
- Inputs com `font-size >= 16px`; alvos de toque `>= 44px`.
- Sem nome, logo ou cópia de ícone da Apple.
- `prefers-reduced-motion` e `prefers-reduced-transparency` respeitados.
- Nenhuma mudança em `db.js`, `finance.js`, `backup.js` ou no texto das telas.

## Review Focus
- Elemento com atributo `hidden` dentro de componente com `display` próprio deve continuar oculto (toggle "Pago" em compra no cartão). → teste na Task 1.
- Toque em qualquer botão de dentro do cabeçalho da folha (ex.: ✕) não pode iniciar arrasto. → teste na Task 2.
- Rolar o conteúdo da folha não pode fechá-la (o arrasto só vale na alça/cabeçalho). → coberto pelo desenho da Task 2 (handlers só na alça/cabeçalho).
- Barra de abas + botão + não podem cobrir o último item da lista. → screenshot rolado até o fim na Task 1.
- Textos sobre o vidro precisam continuar legíveis com "Reduzir transparência". → regra CSS na Task 1.

---

### Task 1: Tema claro (CSS + metadados + ícone)

**Files:**
- Modify: `css/styles.css` (reescrita completa, mesmas classes)
- Modify: `index.html` (`theme-color` `#F2F2F7`, `color-scheme` `light`, `apple-mobile-web-app-status-bar-style` `default`)
- Modify: `manifest.webmanifest` (`theme_color`/`background_color` `#F2F2F7`)
- Modify: `scratchpad/icons.js` → regenerar `icons/icon-{180,192,512}.png` (fundo claro, barras verde/verde-água/azul)

- [ ] **Step 1: Teste (falha antes):** `steps-theme.json` verifica `getComputedStyle(body).backgroundColor === 'rgb(242, 242, 247)'`, `.tabbar` com `backdrop-filter` contendo `blur`, `.fab` fora da `.tabbar` à direita dela, e toggle `.account-only` com `display: none` ao escolher cartão.
- [ ] **Step 2:** Rodar; esperado FAIL no fundo (hoje `rgb(11, 11, 12)`).
- [ ] **Step 3:** Implementar CSS/metadados/ícone.
- [ ] **Step 4:** Rodar; esperado PASS e zero erros de console; conferir screenshots de Início, Lançamentos, Cartões, Fatura, Fixas, Ajustes, Histórico e formulário.
- [ ] **Step 5:** Commit.

### Task 2: Folha com gesto de mola

**Files:**
- Modify: `js/ui/components.js` — `enableDragToClose(sheet, close)`

**Interfaces:** mesma assinatura; `openSheet` inalterado.

- [ ] **Step 1: Teste:** em `steps-sheet.json`, simulando `TouchEvent` na `.sheet-grab`: (a) arrasto de 40px em 50ms → folha fecha; (b) arrasto de 40px em 600ms → folha continua aberta; (c) arrasto de −100px → `translateY` aplicado entre −1 e −40px (resistência); (d) `touchstart` no ✕ não move a folha.
- [ ] **Step 2:** Rodar; esperado FAIL em (a) e (c).
- [ ] **Step 3:** Implementar: velocidade das últimas amostras (px/ms); fecha se `dy > 120` ou (`velocidade > 0.5` e `dy > 10`); para cima aplica `rubberband(overshoot, altura, 0.55)`.
- [ ] **Step 4:** Rodar; esperado PASS.
- [ ] **Step 5:** Commit.

### Task 3: Versão, regressão e publicação

**Files:**
- Modify: `sw.js` (`CACHE_VERSION = 'financeiro-v2'`), `js/version.js` (`APP_VERSION = '1.1.0'`)

- [ ] **Step 1:** Rodar `steps1.json` (fluxo completo existente) em perfil limpo; esperado: mesmos resultados de antes e zero erros de console.
- [ ] **Step 2:** Commit e `git push`.
- [ ] **Step 3:** Esperar Pages publicar; conferir `sw.js` publicado contém `financeiro-v2` e smoke test no endereço publicado sem erros.
