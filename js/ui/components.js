// components.js — peças de interface reutilizáveis: toast, bottom sheet, diálogos,
// seletor de mês, linhas de lançamento e ícones.
import {
  addMonths, currentMonth, escapeHTML, formatBRL, formatDateShort, monthLabel, monthShort,
} from '../util.js';
import { setMonth, state } from '../state.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Ícones (SVG inline, herdam a cor do texto) ----------

const svg = (path) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;

export const icons = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>'),
  right: svg('<path d="M9 5l7 7-7 7"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  alert: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>'),
};

// ---------- Toast ----------

/** Mensagem curta no rodapé. type: info | success | error. */
export function toast(message, { type = 'info', duration = 3200, actionLabel, onAction } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span>${escapeHTML(message)}</span>`;
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { onAction?.(); dismiss(); });
    el.append(btn);
  }
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const timer = setTimeout(dismiss, duration);
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }
  return dismiss;
}

/** Mostra o erro de forma amigável (e registra no console para depuração). */
export function showError(err) {
  console.error(err);
  toast(err?.message || 'Algo deu errado. Tente novamente.', { type: 'error', duration: 5000 });
}

// ---------- Bottom sheet ----------

let sheetCount = 0;

/**
 * Abre um painel deslizante de baixo para cima.
 * `content` pode ser string HTML ou um nó. Retorna { el, body, close }.
 */
export function openSheet({ title, content = '', onClose } = {}) {
  const id = `sheet-title-${++sheetCount}`;
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', id);
  sheet.innerHTML = `
    <div class="sheet-grab" aria-hidden="true"><span></span></div>
    <header class="sheet-header">
      <h2 id="${id}">${escapeHTML(title)}</h2>
      <button type="button" class="icon-btn" data-sheet-close aria-label="Fechar">${icons.close}</button>
    </header>
    <div class="sheet-body"></div>`;
  const body = $('.sheet-body', sheet);
  if (typeof content === 'string') body.innerHTML = content;
  else body.append(content);

  const previousFocus = document.activeElement;
  document.body.append(backdrop, sheet);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => {
    backdrop.classList.add('show');
    sheet.classList.add('show');
  });

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    sheet.classList.remove('show');
    backdrop.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      sheet.remove();
      backdrop.remove();
      if (!document.querySelector('.sheet')) document.body.classList.remove('has-sheet');
    }, 280);
    previousFocus?.focus?.({ preventScroll: true });
    onClose?.(result);
  }
  function onKey(ev) {
    if (ev.key === 'Escape' && sheet === [...document.querySelectorAll('.sheet')].pop()) close();
  }

  backdrop.addEventListener('click', () => close());
  $('[data-sheet-close]', sheet).addEventListener('click', () => close());
  document.addEventListener('keydown', onKey);
  enableDragToClose(sheet, close);
  setTimeout(() => $('h2', sheet).focus?.(), 50);
  $('h2', sheet).tabIndex = -1;

  return { el: sheet, body, close };
}

/** Resistência progressiva além do limite (quanto mais longe, menos acompanha o dedo). */
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Arrastar a alça/cabeçalho move o painel 1:1 com o dedo. Fecha se passar de 120px
 * ou se o gesto terminar com velocidade para baixo (puxão rápido), como no iOS.
 * Para cima, o painel resiste em vez de travar.
 */
function enableDragToClose(sheet, close) {
  const handles = [$('.sheet-grab', sheet), $('.sheet-header', sheet)];
  let startY = null;
  let dy = 0;
  let samples = [];
  const onStart = (ev) => {
    if (ev.target.closest('button')) return;
    startY = ev.touches[0].clientY;
    dy = 0;
    samples = [{ y: startY, t: performance.now() }];
    sheet.style.transition = 'none';
  };
  const onMove = (ev) => {
    if (startY == null) return;
    const y = ev.touches[0].clientY;
    const raw = y - startY;
    dy = raw >= 0 ? raw : rubberband(raw, sheet.offsetHeight || 600) * 0.25;
    sheet.style.transform = `translateY(${dy}px)`;
    samples.push({ y, t: performance.now() });
    if (samples.length > 5) samples.shift();
  };
  const onEnd = () => {
    if (startY == null) return;
    startY = null;
    // Velocidade (px/ms) das últimas amostras; positiva = para baixo.
    const first = samples[0];
    const last = samples[samples.length - 1];
    const velocity = last && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    // A transição parte da posição atual (o transform inline), sem salto.
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 120 || (velocity > 0.5 && dy > 10)) close();
  };
  handles.forEach((h) => {
    h.addEventListener('touchstart', onStart, { passive: true });
    h.addEventListener('touchmove', onMove, { passive: true });
    h.addEventListener('touchend', onEnd);
    h.addEventListener('touchcancel', onEnd);
  });
}

// ---------- Diálogos ----------

/** Pergunta com opções. options: [{ label, value, danger, primary }]. Resolve com o value ou null. */
export function choiceDialog({ title, message = '', options }) {
  return new Promise((resolve) => {
    let answer = null;
    const html = `
      ${message ? `<p class="dialog-text">${escapeHTML(message)}</p>` : ''}
      <div class="stack">
        ${options.map((o, i) => `<button type="button" class="btn ${o.danger ? 'btn-danger' : o.primary ? 'btn-primary' : 'btn-secondary'}" data-i="${i}">${escapeHTML(o.label)}</button>`).join('')}
        <button type="button" class="btn btn-ghost" data-cancel>Cancelar</button>
      </div>`;
    const sheet = openSheet({ title, content: html, onClose: () => resolve(answer) });
    sheet.body.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.i != null) answer = options[Number(btn.dataset.i)].value;
      sheet.close();
    });
  });
}

/** Confirmação simples. Resolve true/false. */
export async function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  const r = await choiceDialog({ title, message, options: [{ label: confirmLabel, value: true, danger, primary: !danger }] });
  return r === true;
}

// ---------- Seletor de mês ----------

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function monthSwitcher(ym = state.month) {
  const isCurrent = ym === currentMonth();
  return `
    <div class="month-switcher">
      <button type="button" class="icon-btn" data-month-nav="-1" aria-label="Mês anterior">${icons.left}</button>
      <button type="button" class="month-label" data-month-today aria-label="${escapeHTML(monthLabel(ym))}${isCurrent ? '' : ', toque para voltar ao mês atual'}">
        ${escapeHTML(cap(monthLabel(ym)))}${isCurrent ? '' : '<small>voltar a hoje</small>'}
      </button>
      <button type="button" class="icon-btn" data-month-nav="1" aria-label="Próximo mês">${icons.right}</button>
    </div>`;
}

export function bindMonthSwitcher(root) {
  root.addEventListener('click', (ev) => {
    const nav = ev.target.closest('[data-month-nav]');
    if (nav) setMonth(addMonths(state.month, Number(nav.dataset.monthNav)));
    else if (ev.target.closest('[data-month-today]')) setMonth(currentMonth());
  });
}

// ---------- Peças de lista ----------

const HEX = /^#[0-9a-f]{6}$/i;
export const safeColor = (c, fallback = '#64748b') => (HEX.test(c || '') ? c : fallback);

export function catIcon(cat, { emoji, color } = {}) {
  const e = emoji || cat?.icone || '❔';
  const c = safeColor(color || cat?.cor);
  return `<span class="cat-icon" style="--c:${c}" aria-hidden="true">${escapeHTML(e)}</span>`;
}

export function emptyState(text, emoji = '🗂️') {
  return `<div class="empty"><span aria-hidden="true">${emoji}</span><p>${escapeHTML(text)}</p></div>`;
}

export const moneyClass = (cents) => (cents > 0 ? 'pos' : cents < 0 ? 'neg' : '');

/** Valor com sinal: "+ R$ 10,00" / "− R$ 10,00". */
export function signedMoney(t) {
  return `${t.tipo === 'receita' ? '+' : '−'} ${formatBRL(t.valor)}`;
}

/** Linha de lançamento. Botões usam data-action="edit" | "toggle-paid" com data-id. */
export function transactionRow(t, d, { toggle = true, showDate = false } = {}) {
  const pay = t.faturaPagamento;
  const cat = d.catMap.get(t.categoryId);
  const card = t.cardId ? d.cardMap.get(t.cardId) : null;
  const where = card ? card.nome : d.accMap.get(t.accountId)?.nome;

  const meta = [];
  if (showDate) meta.push(formatDateShort(t.data));
  if (pay) meta.push(`Pagamento · ${d.cardMap.get(pay.cardId)?.nome || 'cartão excluído'}`);
  else meta.push(cat?.nome || 'Sem categoria');
  if (where) meta.push(where);
  if (t.parcela) meta.push(`${t.parcela.n}/${t.parcela.total}`);
  if (card) meta.push(`fatura ${monthShort(t.fatura)}`);
  if (t.recurringId) meta.push('fixa');

  const canToggle = toggle && !t.cardId;
  const label = t.tipo === 'receita' ? 'recebido' : 'pago';
  const pending = !t.cardId && !t.pago;

  return `
    <li class="tx${pending ? ' is-pending' : ''}">
      <button type="button" class="tx-main" data-action="edit" data-id="${escapeHTML(t.id)}">
        ${pay ? catIcon(null, { emoji: '💳', color: '#64748b' }) : catIcon(cat)}
        <span class="tx-text">
          <span class="tx-desc">${escapeHTML(t.descricao || cat?.nome || 'Lançamento')}</span>
          <span class="tx-meta">${meta.map(escapeHTML).join(' · ')}</span>
        </span>
        <span class="tx-value ${t.tipo === 'receita' ? 'pos' : 'neg'}">${signedMoney(t)}</span>
      </button>
      ${canToggle ? `
        <button type="button" class="check${t.pago ? ' on' : ''}" data-action="toggle-paid" data-id="${escapeHTML(t.id)}"
          aria-pressed="${t.pago}" aria-label="${t.pago ? `Marcado como ${label}. Toque para desmarcar` : `Marcar como ${label}`}">${icons.check}</button>` : ''}
    </li>`;
}

// ---------- Opções de formulário ----------

export function categoryOptions(categories, tipo, selected) {
  const list = categories.filter((c) => c.tipo === tipo || c.id === selected);
  return list.map((c) => `<option value="${escapeHTML(c.id)}"${c.id === selected ? ' selected' : ''}>${escapeHTML(`${c.icone} ${c.nome}`)}</option>`).join('');
}

/** <option>s "acc:<id>" e "card:<id>". Cartões só aparecem se allowCards. */
export function originOptions(d, selected, { allowCards = true } = {}) {
  const opt = (value, text) => `<option value="${escapeHTML(value)}"${value === selected ? ' selected' : ''}>${escapeHTML(text)}</option>`;
  const accs = d.accounts.map((a) => opt(`acc:${a.id}`, a.nome)).join('');
  const cards = allowCards && d.cards.length
    ? `<optgroup label="Cartões de crédito">${d.cards.map((c) => opt(`card:${c.id}`, `💳 ${c.nome}`)).join('')}</optgroup>`
    : '';
  return `<optgroup label="Contas">${accs}</optgroup>${cards}`;
}

export function parseOrigin(value) {
  const [kind, ...rest] = String(value || '').split(':');
  const id = rest.join(':');
  return { accountId: kind === 'acc' ? id : null, cardId: kind === 'card' ? id : null };
}

export const COLORS = ['#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#ef4444', '#f97316', '#eab308', '#94a3b8', '#64748b'];

export function colorPicker(name, selected) {
  const sel = COLORS.includes(selected) ? selected : COLORS[0];
  return `
    <fieldset class="field colors">
      <legend>Cor</legend>
      <div class="swatches">
        ${COLORS.map((c) => `
          <label class="swatch" style="--c:${c}">
            <input type="radio" name="${name}" value="${c}"${c === sel ? ' checked' : ''}>
            <span class="visually-hidden">${c}</span>
          </label>`).join('')}
      </div>
    </fieldset>`;
}

/** Barra de progresso simples (0–100%). */
export function progressBar(value, max, { label = '', danger = false } = {}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return `<div class="progress${danger ? ' danger' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="${escapeHTML(label)}"><span style="width:${pct.toFixed(1)}%"></span></div>`;
}
