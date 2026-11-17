# Tema claro estilo iOS 26 (Liquid Glass) — design

**Tamanho:** mudança pequena (visual). Nenhuma regra de negócio ou dado muda.

## Intenção
O dono quer que o app pareça um app nativo da Apple no iPhone (iOS 26), com tema claro.
Ele usa o app como PWA na Tela de Início; precisa se sentir "do sistema", não um site.

## Objetivos
- Tema claro com a linguagem visual do iOS 26: fundo agrupado (#F2F2F7), listas brancas
  com cantos arredondados, separadores finos recuados, tipografia do sistema.
- Barra de abas flutuante de vidro (cápsula) e botão **+** em círculo de vidro ao lado.
- Cores do sistema: azul (#007AFF) para ações, verde (#34C759) e vermelho (#FF3B30) para dinheiro.
- Folhas (sheets) com animação de mola, botão fechar à esquerda, e fechamento por arrasto
  que respeita a velocidade (puxão rápido fecha; arrastar para cima tem resistência).
- Toque responde ao pressionar (destaque cinza nas linhas, leve redução nos botões).
- Ícone novo, claro.

## Não-objetivos
- Modo escuro automático (pode vir depois).
- Mudar telas, funções, textos ou estrutura de dados.

## Anti-objetivos
- Usar nome, logo ou cópia de ícone da Apple.
- Ficar ilegível: o vidro precisa de fallback sólido (`prefers-reduced-transparency`)
  e a animação precisa respeitar `prefers-reduced-motion`.

## Abordagens consideradas
1. **iOS 26 Liquid Glass** — barra flutuante de vidro, + em círculo ao lado, botões em cápsula. **Escolhida pelo dono.**
2. iOS 17/18 clássico — barra de abas de largura total, + no canto superior. Descartada: o dono quer o visual atual.

## Como (decisões)
- Reescrever `css/styles.css` mantendo todos os nomes de classe (as telas não mudam).
- `components.js`: arrasto da folha com velocidade e rubber-band; curva de mola via CSS `linear()`.
- `index.html`/`manifest`: `theme-color` #F2F2F7, barra de status `default` (texto escuro), `color-scheme: light`.
- Ícone: fundo claro com barras coloridas (verde, verde-água, azul), gerado pelo mesmo script.
- Publicação: subir versão (`CACHE_VERSION` v2, `APP_VERSION` 1.1.0), commit e push.

## Verificação
Rodar o teste automatizado no navegador headless (fluxos já usados) sem erros de console
e conferir screenshots de cada tela antes de publicar.
