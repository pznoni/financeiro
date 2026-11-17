// util.js — utilidades de dinheiro, datas (sempre em horário local) e HTML.

// ---------- Dinheiro (sempre inteiros em centavos) ----------

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata centavos como "R$ 1.234,56". */
export function formatBRL(cents) {
  return brl.format((cents || 0) / 100);
}

/**
 * Converte o texto digitado em centavos (inteiro), sem passar por float.
 * Aceita "12", "12,5", "1.234,56", "1234.56", "R$ 10,00". Retorna NaN se inválido.
 */
export function parseMoney(input) {
  let s = String(input ?? '').trim().replace(/R\$|\s| /g, '');
  if (!s) return NaN;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return NaN;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart = s;
  let decPart = '';

  if (lastComma > -1 && lastComma > lastDot) {
    // Vírgula é o separador decimal (padrão brasileiro)
    intPart = s.slice(0, lastComma);
    decPart = s.slice(lastComma + 1);
  } else if (lastDot > -1 && lastComma === -1) {
    // Só pontos: é decimal se houver um único ponto seguido de 1–2 dígitos ("12.5")
    const after = s.length - lastDot - 1;
    if (s.indexOf('.') === lastDot && after > 0 && after <= 2) {
      intPart = s.slice(0, lastDot);
      decPart = s.slice(lastDot + 1);
    }
  } else if (lastDot > lastComma) {
    // Formato "1,234.56"
    intPart = s.slice(0, lastDot);
    decPart = s.slice(lastDot + 1);
  }

  intPart = intPart.replace(/[.,]/g, '') || '0';
  if (/[.,]/.test(decPart)) return NaN;
  // Arredonda pela 3ª casa decimal, se houver
  const roundUp = decPart.length > 2 && Number(decPart[2]) >= 5;
  decPart = (decPart + '00').slice(0, 2);

  let cents = Number(intPart) * 100 + Number(decPart) + (roundUp ? 1 : 0);
  if (!Number.isSafeInteger(cents)) return NaN;
  return neg ? -cents : cents;
}

/** Centavos → texto editável "1234,56" (para preencher inputs). */
export function centsToInput(cents) {
  if (cents == null || Number.isNaN(cents)) return '';
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${pad(abs % 100)}`;
}

/** Soma valores com sinal: receita positiva, despesa negativa. */
export function signed(t) {
  return t.tipo === 'receita' ? t.valor : -t.valor;
}

// ---------- Datas (strings "YYYY-MM-DD" e "YYYY-MM", sempre locais) ----------

export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function pad(n) {
  return String(n).padStart(2, '0');
}

/** Date → "YYYY-MM-DD" usando o fuso local (nunca toISOString, que usa UTC). */
export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function currentMonth() {
  return todayISO().slice(0, 7);
}

/** "YYYY-MM-DD" → Date local à meia-noite (new Date("2026-11-16") seria UTC!). */
export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Soma n meses a "YYYY-MM". */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Dia do mês limitado ao tamanho do mês (dia 31 em fevereiro vira 28/29). */
export function dateInMonth(ym, day) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(Math.min(Math.max(1, day), daysInMonth(y, m)))}`;
}

/** Soma n meses a uma data, preservando o dia quando possível. */
export function addMonthsToDate(iso, n) {
  return dateInMonth(addMonths(iso.slice(0, 7), n), Number(iso.slice(8, 10)));
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function endOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(daysInMonth(y, m))}`;
}

/** Diferença em dias inteiros (b − a), imune a horário de verão. */
export function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** "2026-11" → "novembro 2026" */
export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}

/** "2026-11" → "nov/26" */
export function monthShort(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1].slice(0, 3)}/${String(y).slice(2)}`;
}

/** "2026-11-16" → "16/11/2026" */
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** "2026-11-16" → "16/11" */
export function formatDateShort(iso) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';
}

const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Cabeçalho de dia: "Hoje", "Ontem" ou "segunda-feira, 16 de novembro". */
export function dayHeader(iso) {
  const diff = diffDays(todayISO(), iso);
  if (diff === 0) return 'Hoje';
  if (diff === -1) return 'Ontem';
  if (diff === 1) return 'Amanhã';
  const s = dayFmt.format(parseISO(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Texto relativo para vencimentos: "vence hoje", "em 3 dias", "atrasada há 2 dias". */
export function dueLabel(iso) {
  const diff = diffDays(todayISO(), iso);
  if (diff === 0) return 'vence hoje';
  if (diff === 1) return 'vence amanhã';
  if (diff > 1) return `vence em ${diff} dias`;
  if (diff === -1) return 'venceu ontem';
  return `venceu há ${-diff} dias`;
}

// ---------- Diversos ----------

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Remove acentos e caixa para buscas ("Alimentação" ≈ "alimentacao"). */
export function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Indexa um array de objetos pelo id. */
export function byId(list) {
  return new Map(list.map((x) => [x.id, x]));
}

export function sum(list, fn) {
  return list.reduce((acc, x) => acc + fn(x), 0);
}
