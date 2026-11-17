// app.js — inicialização: banco, rotas (hash), barra de abas, botão "+", service worker.
import { ensureSeed, openDB } from './db.js';
import { generateRecurring } from './finance.js';
import { state } from './state.js';
import { currentMonth } from './util.js';
import { $, $$, showError, toast } from './ui/components.js';
import { openTransactionForm } from './ui/form-lancamento.js';
import * as inicio from './ui/inicio.js';
import * as lancamentos from './ui/lancamentos.js';
import * as cartoes from './ui/cartoes.js';
import * as fixas from './ui/fixas.js';
import * as ajustes from './ui/ajustes.js';
import * as historico from './ui/historico.js';

/** rota → { tela, aba destacada na barra inferior, título da página } */
const ROUTES = {
  inicio: { view: inicio, tab: 'inicio', title: 'Início' },
  lancamentos: { view: lancamentos, tab: 'lancamentos', title: 'Lançamentos' },
  cartoes: { view: cartoes, tab: 'cartoes', title: 'Cartões' },
  fixas: { view: fixas, tab: 'fixas', title: 'Contas fixas' },
  ajustes: { view: ajustes, tab: 'ajustes', title: 'Ajustes' },
  historico: { view: historico, tab: 'inicio', title: 'Histórico' },
};

const main = document.getElementById('main');

/** "#cartoes/abc/2026-11" → { name: 'cartoes', params: ['abc', '2026-11'] } */
function parseHash() {
  const [name, ...params] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return ROUTES[name] ? { name, params } : { name: 'inicio', params: [] };
}

const go = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};

// ---------- Renderização ----------

let renderToken = 0;
let lastRoute = '';

/**
 * Desenha a tela atual num elemento novo (os listeners da tela anterior somem junto)
 * e só troca quando terminar. Se outra renderização começar no meio, esta é descartada.
 */
async function render() {
  const token = ++renderToken;
  const route = parseHash();
  const { view, tab, title } = ROUTES[route.name];
  const routeKey = `${route.name}/${route.params.join('/')}`;
  const sameRoute = routeKey === lastRoute;
  const scrollY = window.scrollY;

  const el = document.createElement('div');
  el.className = 'view';
  try {
    await view.render(el, { params: route.params, go });
  } catch (err) {
    if (token !== renderToken) return;
    showError(err);
    return;
  }
  if (token !== renderToken) return;

  main.replaceChildren(el);
  lastRoute = routeKey;
  document.title = `${title} · Financeiro`;
  $$('.tabbar a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  // Ao trocar de tela, volta ao topo; ao redesenhar a mesma tela, mantém a rolagem.
  window.scrollTo(0, sameRoute ? scrollY : 0);
  if (!sameRoute) main.focus({ preventScroll: true });
}

// ---------- Botão "+" ----------

$('#fab').addEventListener('click', () => {
  const route = parseHash();
  // Dentro da fatura de um cartão, a compra já sugere esse cartão.
  const cardId = route.name === 'cartoes' && route.params[0] ? decodeURIComponent(route.params[0]) : null;
  openTransactionForm({ defaults: cardId ? { cardId } : {} });
});

// ---------- Service worker e aviso de nova versão ----------

function showUpdateBanner(worker) {
  toast('Nova versão disponível — toque para atualizar', {
    duration: 600000,
    actionLabel: 'Atualizar',
    onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        // Só avisa se já havia uma versão controlando a página (não na 1ª instalação).
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
      });
    });
    // Na 1ª instalação o SW assume a página sem precisar recarregar.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
    // Procura atualização ao voltar para o app.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (err) {
    console.warn('Service worker não registrado:', err);
  }
}

// ---------- Eventos globais ----------

document.addEventListener('data-changed', () => render());

document.addEventListener('month-changed', async () => {
  try {
    await generateRecurring(state.month);
  } catch (err) {
    showError(err);
  }
  render();
});

document.addEventListener('db-versionchange', () => {
  toast('O app foi atualizado em outra janela. Recarregando…');
  setTimeout(() => location.reload(), 1500);
});
document.addEventListener('db-blocked', () => {
  toast('Feche outras abas do app para concluir a atualização.', { type: 'error', duration: 6000 });
});

// Se o app ficou aberto de um dia para o outro, redesenha (datas relativas, vencimentos).
let lastDay = new Date().toDateString();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const today = new Date().toDateString();
  if (today === lastDay) return;
  lastDay = today;
  generateRecurring(currentMonth()).catch(() => {}).finally(render);
});

window.addEventListener('hashchange', render);

// ---------- Início ----------

async function start() {
  try {
    await openDB();
    await ensureSeed();
    // Recorrências do mês atual (para "próximas contas") e do mês em exibição.
    await generateRecurring(currentMonth());
    if (state.month !== currentMonth()) await generateRecurring(state.month);
  } catch (err) {
    showError(err);
  }
  // Pede ao navegador para não apagar os dados quando faltar espaço.
  navigator.storage?.persist?.().catch(() => {});
  await render();
  document.body.classList.remove('is-loading');
  registerServiceWorker();
}

start();
