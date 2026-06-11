# DESIGN.md — Mail Digest UI System (Briefing Colorido)

## Identidade visual

Estilo: **briefing editorial matinal, tema claro quente ("Confetti Cream")**
Princípio: a app lê o correio por ti e apresenta um documento único, de cima para baixo —
hierarquia imediata, cor com significado funcional, zero cromo de "email client".

Referência visual canónica: `mockups/colorful-sample.html`. Em caso de dúvida, abrir lado a lado e igualar.

---

## Tipografia

| Função | Fonte | Uso |
|---|---|---|
| Display / títulos | `Fraunces` (variável) | Hero h1, h2 de secção, h3 dos cards, números das stats |
| UI / corpo | `Inter Tight` | Tudo o resto — lede, resumos, botões, labels |
| Metadata / mono | `JetBrains Mono` | Datas, badges, section-meta, categorias, kbd |

Import — fontes **self-hosted** (woff2 variáveis em `src/renderer/fonts/`, declaradas em `fonts/fonts.css`; sem CDN externo, CSP `font-src 'self'`):
```html
<link rel="stylesheet" href="fonts/fonts.css" />
```
Eixos disponíveis: Fraunces `opsz 9..144, wght 300..900, SOFT 0..100`; Inter Tight `wght 100..900`; JetBrains Mono `wght 100..800`.

`font-variation-settings` da Fraunces por contexto:
- Hero h1: `'opsz' 144, 'SOFT' 50` (em itálico no nome: `'opsz' 144, 'SOFT' 80`)
- h2 de secção / stats / brand-name: `'opsz' 72, 'SOFT' 30`
- h3 de card / convo-hint: `'opsz' 36, 'SOFT' 30`
- news-summary (itálico): `'opsz' 20, 'SOFT' 30`

Corpo: `Inter Tight`, base weight **450**, `line-height: 1.55`–`1.65`.

---

## Paleta de cores

```css
:root {
  /* Foundation — warm editorial cream */
  --bg:       #faf6ee;   --bg2:      #ffffff;   --bg3:      #f3ede0;
  --bg-rail:  #f6f1e6;
  --border:   rgba(20,17,13,0.10);
  --border2:  rgba(20,17,13,0.16);
  --border3:  rgba(20,17,13,0.28);
  --ink:      #14110d;   --text:     #14110d;
  --text2:    #4a4540;   --text3:    #7a7068;

  /* Brand — iris violet */
  --brand: #6c5cf0;  --brand-2: #5546d4;  --brand-on: #ffffff;
  --brand-bg: #efeaff;  --brand-tint: #f5f1ff;

  /* Category palette — cada cor é dona de uma parte do digest */
  --urgent:  #e0444c;  --urgent-2:  #c2353d;  --urgent-bg: #fde7e9;  /* needs you / urgente */
  --sunset:  #f59e0b;  --sunset-2:  #d48409;  --sunset-bg: #fff0d0;  /* hoje / tarefas */
  --emerald: #10b981;  --emerald-2: #099268;  --emerald-bg:#d6f4e8;  /* esta semana / feito */
  --sky:     #4f7ce5;  --sky-2:     #3961c6;  --sky-bg:    #e0eaff;  /* newsletters / arquivado */
  --grape:   #a855f7;  --grape-2:   #8636d3;  --grape-bg:  #f1e3ff;  /* eventos de calendário */
  --rose:    #f43f5e;  --rose-2:    #d12e4d;  --rose-bg:   #ffe1e6;  /* follow-ups (futuro) */
  --slate:   #6b88a0;  --slate-bg:  #e7eef4;                          /* fyi / metadata */
}
```

Mapeamento de prioridades → cores: `urgent`→urgent, `today`→sunset, `this_week`→emerald, `fyi`→slate.

---

## Layout

```
┌──────────────────────────────────────────────┐
│ TOPBAR sticky (blur, border-bottom)          │
│ brand-dot+name      select·refresh·gear·avatar│
├──────────────────────────────────────────────┤
│            .page  (max-width 800px)          │
│  ┌────────────────────────────────────────┐  │
│  │ HERO  (stripe arco-íris 6px)           │  │
│  │ data · Bom dia, <em>Nome</em>.         │  │
│  │ lede · 4 stat pills coloridos          │  │
│  └────────────────────────────────────────┘  │
│  ● O que precisa de ti   (cards c/ stripe)   │
│  ● O que eu proponho     (event/task cards)  │
│  ● O que eu tratei       (news-card + trans) │
│  convo-hint                                  │
├──────────────────────────────────────────────┤
│        ask-bar flutuante (pill escura)       │
└──────────────────────────────────────────────┘
```

Sem sidebar, sem painel de detalhe — o briefing é o único ecrã. Login gate (Gmail/Outlook)
ocupa o lugar da page quando não há sessão.

---

## Componentes principais

### Hero
- `.hero-stripe`: gradiente arco-íris em 7 blocos duros (urgent→sunset→emerald→sky→grape→rose→brand).
- h1 com saudação por hora (`Bom dia/Boa tarde/Boa noite`) e nome em `<em>` com gradiente brand→rose.
- `.stats`: grid 4 colunas; pill = fundo `*-bg` + texto `*-2`; número em Fraunces 32px tabular.

### Cards "O que precisa de ti"
- `.card` com `.card-stripe` 4px no topo, cor = prioridade.
- `.card-meta`: badge preenchido (pill mono uppercase branca) + sender 600 + addr/time mono.
- h3 Fraunces 21px; `.card-summary` 14px com `<strong>` para valores/datas.
- `.card-actions`: `.btn-urgent`/`.btn-primary` para acção primária; `.btn` para o resto.
- Rascunho sugerido: `.card-draft` colapsado, toggle via "Ver rascunho sugerido".

### O que eu proponho
- `.event-card`: grid 60px/1fr/auto, border-left 4px grape, data em bloco `--grape-bg`.
- `.task-card`: border-left 4px sunset; `.done` = emerald + line-through + check preenchido.

### O que eu tratei
- `.news-card`: stripe sky, badge "Newsletters", `.news-summary` em Fraunces itálico 16px,
  `.news-sources` grid 2 colunas.
- `.trans-list`: linhas com dot colorido + categoria mono uppercase + texto truncado + status emerald.

### Ask bar (flutuante)
- Pill escura (`--ink`) fixa em baixo, centrada (full-width <640px); única excepção com `box-shadow`.
- Botão circular `--brand`. Abre o placeholder do modo conversa (`⌘K` também).

### Badges
`.badge` = pill mono 10px uppercase, texto branco, fundo da categoria
(`.urgent .today .week .fyi .news .event .followup .ai`).

### Botões
Base 34px, radius 8px, Inter Tight 12.5px/500. Variantes: `.btn-primary` (ink),
`.btn-brand` (iris), `.btn-urgent`, `.btn-grape` (fundo `--grape-bg`). SVG inline 13px.

---

## Regras de implementação

1. **Fontes**: apenas Fraunces / Inter Tight / JetBrains Mono. Nunca DM Serif Display, Syne, DM Mono, Inter, system-ui.
2. **Gradientes**: proibidos, com **duas excepções deliberadas** — a `hero-stripe` arco-íris (e a sua réplica no login-card) e o gradiente de texto no `<em>` do hero. O `convo-hint` usa um wash brand-tint→bg ténue (vem do mockup).
3. **Sombras**: proibidas excepto `ask-bar` e `toast`/modal (flutuantes por natureza).
4. **Borders**: `1px` com os tokens `--border/--border2/--border3`; stripes de card `4px`; border-left de event/task `4px`.
5. **Cores de categoria são funcionais** — urgente nunca decora, grape é sempre calendário, sky é sempre newsletter/arquivo.
6. **Ícones**: SVG inline 16×16 `stroke="currentColor"`. Nunca emoji como ícone estrutural.
7. **Scrollbars** ocultas; **transições** ≤ 0.12s.
8. **Conteúdo dinâmico** (emails, LLM) montado com `createElement`/`textContent` — nunca `innerHTML`. O único markup permitido vindo do LLM é `**bold**`, convertido para `<strong>` de forma segura (`appendWithBold`).
9. **Secções condicionais**: "O que precisa de ti" / "proponho" / "tratei" só renderizam com conteúdo.
10. **Contraste**: todo o texto ≥ 4.5:1 sobre fundos claros (usar `*-2` das categorias para texto sobre `*-bg`).

---

## Schema do briefing (fonte de verdade)

O renderer consome o objecto `briefing` devolvido por `llm:analyse`
(ver `REFACTOR.md` §3 e `src/providers/llm/index.js#assembleBriefing`):
`briefing.{summary,stats}` · `needs_you[]` · `proposed.{events[],tasks[]}` ·
`handled.{newsletter_synthesis,transactional[]}`.
Arrays no formato antigo (`items[]`) são migrados no renderer (`migrateLegacyItems`).

---

## Ficheiros de referência

- `mockups/colorful-sample.html` — mockup canónico (pixel reference)
- `src/renderer/` (`index.html`, `styles.css`, `renderer.js`) — implementação
- Não alterar fontes, cores ou bordas sem actualizar este DESIGN.md.
