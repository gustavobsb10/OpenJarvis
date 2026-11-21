# OpenJarvis — assistente pessoal com voz e painel HUD

Projeto pessoal de um assistente que roda no próprio computador (Windows), com
voz, painel de informações e holograma 3D controlado por gestos. Este repositório
reúne os componentes que eu desenvolvi em cima do OpenJarvis.

## O que tem aqui

| Arquivo | Para que serve |
|---|---|
| `palmas.py` | Detecta duas palmas fortes pelo microfone e abre o app. Só uma instância roda por vez. |
| `jarvis-app/` | Casca em Electron que abre o painel como um app de desktop, com navegador embutido. |
| `server/static/briefing.html` | Painel principal (HUD): clima, agenda, notícias, e-mail, reconhecimento facial para destravar e sequência de boas-vindas. |
| `server/static/modelo.html` | Holograma 3D com gestos de mão (MediaPipe) e controle pelo mouse. |
| `server/static/voz-local.js` | Camada de voz: Kokoro (local), vozes online da Microsoft e reconhecimento de fala. |
| `server/static/navegador-painel.js` | Painel de navegador embutido na tela. |
| `server/voz_edge_routes.py` | Rota do servidor que gera a voz online da Microsoft, com conexão reserva para reduzir o atraso. |

## Como funciona

- Tudo roda localmente. Nenhuma chave ou dado pessoal está neste repositório.
- A voz online usa o serviço de leitura da Microsoft (sem chave de API).
- O reconhecimento facial guarda apenas a assinatura numérica do rosto, no próprio computador.
- Integrações com Google (agenda, contatos, Drive, Gmail e tarefas) usam credenciais criadas
  pelo próprio usuário no Google Cloud. Essas credenciais ficam fora do repositório.

## Observação

Este não é o repositório completo do OpenJarvis: são só os arquivos que criei ou alterei.
Para rodar, é preciso o restante do projeto original e as dependências dele.

## Status

Em desenvolvimento. Pendências: gestos do holograma com webcam real, reconexão com
acesso remoto e integração com Telegram e WhatsApp.
