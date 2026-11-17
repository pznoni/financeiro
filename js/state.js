// state.js — estado de navegação compartilhado entre as telas (mês selecionado).
import { currentMonth, isMonth } from './util.js';

const KEY = 'financeiro.mes';

function readMonth() {
  try {
    const saved = sessionStorage.getItem(KEY);
    if (isMonth(saved)) return saved;
  } catch { /* armazenamento indisponível: usa o mês atual */ }
  return currentMonth();
}

export const state = { month: readMonth() };

/** Troca o mês selecionado e avisa o app (que gera recorrências e redesenha). */
export function setMonth(ym) {
  if (!isMonth(ym) || ym === state.month) return;
  state.month = ym;
  try { sessionStorage.setItem(KEY, ym); } catch { /* ignora */ }
  document.dispatchEvent(new CustomEvent('month-changed', { detail: ym }));
}
