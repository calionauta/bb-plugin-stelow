# Recon — Decision routing em scope mapping e tech planning

## 1. Request (verbatim)

> ao mapear escopos e em tech planning onde pode ser útil usar decision routing
> em vez de usar LLM? será q coisas pra decidir oq é arriscado, oq merece Spike, a
> ordem dos escopos e a ordem das tarefas? procure a skill do typesafe jev na
> internet só pra ver se dá ideias de pontos do fluxo e skills q valeria usar
> decision routing api

Parsed into 5 questions:
1. **Q1 — Risco:** onde "o que é arriscado" é decidido no fluxo de scope mapping / tech planning, e a regra determinística já responde?
2. **Q2 — Spike:** onde "o que merece Spike" é decidido, e isso é classificável (choice/noul) ou é uma decisão de escopo com custo?
3. **Q3 — Ordem dos escopos:** onde a ordem é decidida, e ela já é determinística?
4. **Q4 — Ordem das tarefas:** idem, dentro do escopo.
5. **Q5 — Pesquisa externa:** o que a skill do TypeSafe Jev sugere como pontos de fluxo e como ela se conecta ao que já existe aqui.

Appetite: Complete. Intent: investigate. UI scope: yes. Stage: setup (recipe `setup-recon`, task `repository-recon`).

Reconstruindo a premissa do pedido antes de comecar: nada foi escrito no workspace — só leitura, grep e pesquisa web.

## 2. Repository map (fatia relevante)

```
bb-plugin-stelow/
  docs/decision-routing.md          <- A POLÍTICA (regras → api → preset; barra p/ ponto novo)
  docs/native-workflows.md          <- limite de fan-out; scope-batch fica sequencial
  lib/decision-api.mjs              <- cliente Jev-compatível (302 linhas): providers, request, normalizers
  lib/decision-points.mjs           <- REGISTRO dos pontos + question builders + resolvers (212 linhas)
  server/decision-api-seams.ts      <- as 4 seams montadas (route/seed/auto-continue/severity)
  server/decision-point-rpcs.ts     <- listDecisionPoints / setDecisionPoint (UI Manage)
  lib/scope-order.mjs               <- ordem topológica de escopos + STATUS_RANK de tarefas
  lib/scope-map.mjs, lib/scope-map-approval.mjs, lib/scope-map-freshness.mjs
  data/stelow-assets/schemas/scope-map.json      <- contrato do mapa (SYNC-OWNED, upstream)
  skills/stelow-product-scope-mapping/SKILL.md
  skills/stelow-workflow-tech-planning/
      SKILL.md (planning:10 scope generation)
      references/scope-generation.md      <- "risk analysis → spike identification → … → sequencing"
      references/scopes-and-sequencing.md <- tipos, tabela de risco 1-5, Principles 0-6
      references/tech-output.md           <- [TYPE]/[RISK SCORE] machine blocks, contrato scopes/{id}.json
  skills/stelow-workflow-scope-executor/SKILL.md <- routing [TYPE] → executor (spike → scout+researcher)
  skills/stelow-workflow-router/          <- sibling skill (roteamento de skills/prompts)
  data/.skills-sync-state.json + data/stelow-source.json  <- pin upstream calionauta/stelow
```

**Fronteira de ownership (crítico para qualquer proposta):** `skills/` e `data/stelow-assets/{schemas,recipes}/`
são sync-owned — `lib/workflow-skills-sync.mjs:328` (`EXECUTION_ASSET_PREFIXES = ["recipes/", "schemas/"]`).
Mudança de schema de artefato ou de metodologia de sequenciamento é **upstream-first** (repo `calionauta/stelow`,
release + `repository_dispatch stelow-release`), nunca edição local.

## 3. Onde cada decisão é tomada hoje (verificado por leitura)

### 3.1 "O que é arriscado" (Q1) — hoje é prosa dentro de um turno LLM inteiro

- `skills/stelow-workflow-tech-planning/references/scope-generation.md:8`: o **planner subagent** roda a cadeia
  `strategic stability check → codebase awareness → risk analysis → spike identification → scope definition → sequencing → DoD+ACs`.
  Tudo isso é **um subagent = um turno LLM completo**, com `context: "fresh"`.
- A rubrica existe e é tabular: `scopes-and-sequencing.md:213-236` (tabela risco 1-5 com colunas
  Complexity / Novelty / Legacy Risk / Action) e a regra `risk >= 4 → front-load`, `risk >= 5 → [spike] BEFORE implementation`.
- Onde o score é gravado: `tech-output.md:120` (`**Risk Score:** 1-5`) e na tabela de tarefas (`| # | Task | Components | Risk | … |`,
  `scopes-and-sequencing.md:190-195`). O `Order Rationale` é texto livre referencing `P3: Risk score 4`.
- **Achado crítico:** o score de risco **não é campo de máquina em lugar nenhum**.
  `grep -rn "Risk Score\|RISK" lib/ server/` → **zero hits**. `data/stelow-assets/schemas/scope-map.json`
  tem `additionalProperties: false` e **nenhum** campo `risk`, `type`, `sequence` ou `priority` por escopo
  (só `id,title,outcome,capabilities,inScope,outOfScope,dependsOn,status`).
  O contrato por escopo `scopes/{scope-id}.json` (`tech-output.md:73-80`) tem só
  `acceptance_criteria`, `verify_commands`, `target_files`.
  → Hoje o único consumidor do risco é o leitor humano do `spec-tech_{v}.md`, e a regra `>=4 / >=5` **não é executada por ninguém**.

### 3.2 "O que merece Spike" (Q2) — hoje é uma escolha de escopo com custo de execução

- O spike é um **tipo de escopo**, não uma anotação: `scopes-and-sequencing.md:61` (`spike` → scout + researcher, DoD
  "research/prototype to reduce uncertainty") e o executor faz routing por tipo
  (`skills/stelow-workflow-scope-executor/SKILL.md:113-114`: `[TYPE] spike` sem `[EXECUTOR]` → **scout + researcher**;
  com `[EXECUTOR] research` → research loop, "override, rare").
- `goals.md:22` registra `spike` como goal kind ("delegate recon + research") e `goals.md:170` "Pattern for spike goals".
- O que a skill pede ao modelo hoje: "Introduce `[spike]` tasks before implementation **when uncertainty is fundamental**"
  (`scopes-and-sequencing.md:223`) e a step-list "risk analysis → **spike identification**" (`scope-generation.md:8`).
  "Uncertainty is fundamental" é exatamente um predicado semântico — mas hoje ele é decidido dentro do mesmo
  turno que escreve o plano inteiro.
- Custo real: cada spike troca o executor (worker+loop → scout+researcher), muda o DoD e **consome um goal slot**.

### 3.3 "Ordem dos escopos" (Q3) — **já é determinística**, e a skill também diz que é

- `lib/scope-order.mjs:30-56` faz ordenação **topológica** por `dependsOn`/`blockedBy` (dependência viva antes do
  dependente; ciclos preservam posição original em vez de travar; empates mantêm a ordem do `state.md`).
- O mapa tem `dependsOn` como campo de máquina, e `scope-map.json` exige aciclicidade por contrato
  (`stelow-product-scope-mapping/SKILL.md:76`: "Check that the graph is acyclic").
- A skill prescreve a mesma coisa em prosa (`tech-output.md:98` "High-Level Sequence of Identified Scopes … justified by
  sequencing strategy", `scopes-and-sequencing.md:258-262`: primeiro escopo = fundações de domínio, depois coerência vertical).
- **Achado:** "riskiest-first" em nível de **escopo** é advice de prosa que compete com a topologia real.
  A regra determinística já vence porque é a única que o host consegue reconstruir do `state.md`.

### 3.4 "Ordem das tarefas" (Q4) — prosa no plano, re-ordenação determinística na UI

- A tabela de tarefas do `spec-tech_{v}.md` carrega `#` hierárquico + coluna `Order Rationale` (`P0`…`P6`),
  com marcação `[suggested]` quando o planner inferiu (`scopes-and-sequencing.md:204`).
- Em runtime o host **reordena** por status, não pela ordem do plano: `lib/scope-order.mjs:15-27`
  (`STATUS_RANK`: in-progress 0 → draft/planning/pending 1 → blocked/failed 2 → skipped 3 → done/completed 4).
- As Principles 0-6 (`scopes-and-sequencing.md:208-256`) são todas ** ordenação por dependência/enabler/risk/polish** —
  ou seja, cada uma delas é ou um predicado verificável em código ou um score. Nenhuma exige geração de texto.

## 4. O contrato de decision routing que já existe neste repo

Estado atual (`lib/decision-points.mjs`, `docs/decision-routing.md`), para saber o custo de um ponto novo:

- **4 pontos registrados**, todos nas **bordas** (criação de card, resume de worker ocioso, tick da inbox, chamadas CLI explícitas):
  `triage-intent` (choice), `artifact-criteria` (score por critério, via `verify-tasks`/`gap-triage`),
  `auto-continue` (noul, único ponto invertido), `inbox-severity` (noul).
- **Modos** por ponto: `rules` → `api` → `preset`. `PRESET_JUDGE_POINTS` só 2 pontos de baixa frequência
  (`decision-points.mjs:26`) — hot paths nunca queimam worker turn.
- **Transporte** (`lib/decision-api.mjs`): 4 providers (`jev`, `classifier`, `simplejev`, `openjev`), schemas
  `jev` (state+questions) e `labels` (Choice only); `buildDecisionRequest` **corta o state em 8000 chars**
  (`DECISION_STATE_MAX_CHARS`, linha 14); timeout 8s; kill switch `STELOW_DECISION_API=0`;
  `normalizeDecisionAnswer` (linhas 141-164) **já normaliza `score`** — porém **nenhum ponto registrado usa `score`**
  (os builders só emitem `choice` e `noul`; `lib/decision-points.mjs:154-211`).
- **A barra da política** (`docs/decision-routing.md:99-109`), 6 passos: provar que regra determinística não responde →
  registrar ponto nomeado + schema de pergunta → usar a Decision API configurada → preset só se low-frequency →
  senão regras/pausa → gravar rota, confiança e fallback no trail do card.
- **Dívida já registrada** (`docs/decision-routing.md:60-97`):
  - *"No router point sits at a stage transition or artifact acceptance"* — apontado como **o maior ganho não reivindicated**, deliberadamente não migrado;
  - **3 candidatos medidos e rejeitados em 2026-09-28** contra o corpus vivo: *ask necessity* (corpopo Wrong:
    um cluster, duas respostas corretas opostas), *scope-map challenge* (nenhum consumidor host → teatro advisesivo),
    *interface selection support* (duplicação determinística, resolvível do receipt em disco).
- **Restrição prática:** `investigate` termina em `audit` (`stages.yaml:42`) — sem `planning`/`execution`. Então este
  cartão entrega **recomendação**, não código; qualquer proposta vira card novo.

## 5. Pesquisa: a skill do TypeSafe Jev (Q5)

Fontes lidas (2026-09-30):
- **Oficial:** `https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md`
  (instalável via `npx skills add typesafe-ai/skills --skill typesafe-ai`).
- **Comunitária mais densa:** skill `building-with-typesafe-jev` (114★, 15 arquivos, `prior-art/INDEX.md` com 12
  intents mapeados: control loop, gate, rerank, stream filter, incremental, agent memory, LLM pairing, **ranking-and-matching**,
  select-from-candidates, judges-and-evals, research-and-features).
- **Página do próprio repo:** `docs/decision-routing.md` já implementa um subconjunto disso (providers + regras + thresholds).

O que ela ensina que **muda** a leitura deste fluxo:

| Regra da skill | Aplicação direta aqui |
|---|---|
| **Escolha a primitiva pelo que o código faz com a resposta**: Choice = um de um conjunto; **Score = posição numa dimensão descritiva (use Scores comparáveis por item para *graded ranking*)**; Noul = P(condição) | Q1 (risco) e Q4 (ordem) são **ranking** → `score`, que este repo **transporta mas nunca emite**. Q2 (spike) é condição → `noul`. |
| **"Decompose ruthlessly"**: trocar `is_spam?` por 6 Nouls atômicos e combinar em código. Risco 1-5 já é 3 colunas separáveis (complexity / novelty / legacy risk) | O `Risk Score: 1-5` monolítico vira 2-3 **scores** independentes por escopo, combináveis em código com pesos — e a tabela 1-5 do `scopes-and-sequencing.md` vira literalmente os `criteria` ordenados do Score. |
| **"Select, don't generate"**: ache candidatos em código, deixe o julgamento escolher entre eles | `dependsOn` já é o gerador de candidatos. O host pode montar as ordens topologicamente válidas e deixar o modelo
  **escolher/semear** em vez de escrever prosa de sequenciamento. |
| **"Keep policy in code"** (pesos/thresholds/routing no código, answers crus reutilizáveis) | Casa 1:1 com `docs/decision-routing.md` e com `routeAt` por ponto. |
| **"Gate on confidence, scaled to risk"**: 3 bandas — agir / confirmar-revisar / escalar | É literalmente o modelo de `auto-continue` (ponto invertido) generalized. Para "vale um spike?" a banda do meio = **perguntar ao usuário**, que é o comportamento de "phantom wait" que AGENTS.md já proíbe sem pergunta viva. |
| **"A second request only when the first answer is needed to pick the next options"** (shortlist → texto completo) | Resolve o cap de 8000 chars: **score por escopo com state compacto**, não o plano inteiro numa chamada. |
| **"Never let a Jev answer alone authorize a side effect"** + hostile state vai em campo nomeado | Requisito de segurança para plugpoints em execução: o planner escreve num artifact, e `spec-tech` é gerado por LLM — um `state` com texto não confiável precisa de campo isolado. |
| **"Pin jev-1.13.0 when thresholds were tuned against it"**, log `response.model` | `lib/decision-api.mjs` já parseia `body.model` (`parseDecisionResponse:173`) mas não persiste por ponto. Gap para qualquer threshold novo. |
| **"Tune thresholds on labeled data; plot confidence vs accuracy"** | `docs/decision-routing.md:94` já exige isso ("tests against real artifacts") — a skill só confirma que a barra é a mesma. |
| **Primitivos explicitamente fora do lane**: contagem, aritmética, datas, lookups exatos | Isso **descarta** metade das ideias: "ordenar escopos" (contagem/topologia) e "ordenar tarefas" (dependências) são **código**, não julgamento. |

## 6. Achados que reorganizam a resposta (o que o recon realmente provou)

1. **A pergunta "o que é arriscado" não é uma lacuna de modelo — é uma lacuna de schema.** O host tem a rubrica
   (1-5), tem a regra (`>=4 front-load`, `>=5 spike`) e **não tem o campo**. Enquanto `risk` não entrar no
   `scope-map.json` / `scopes/{id}.json` (upstream), um ponto de decisão teria que parsear prosa de markdown — que
   é exatamente o padrão que `docs/decision-routing.md:85` já reprovou uma vez (corpus não calibrável).
2. **A ordem dos escopos já é determinística** (`lib/scope-order.mjs`) e a skill concorda. O valor de um router ali
   seria **advisory no artifact**, não decisão — a mesma razão pela qual *scope-map challenge* foi rejeitado.
3. **A ordem das tarefas é o melhor candidato**, porque (a) a entrada é uma tabela estruturada que o host já
   renderiza (`Order Rationale`), (b) `STATUS_RANK` já provou que o host reordenatasks de forma determinística depois,
   (c) um score por task cabe em state compacto. Mas o **ganho é de leitura/orientação, não de execução** — a
   ordem real já é imposta por dependência.
4. **"O que merece spike" é o único dos quatro que tem consequência de execução real** (troca de executor +
   DoD + goal). É também o único que é um **gate irreversível barato de errar**: um spike desnecessário custa um
   scout+researcher; um spike faltante vira retrabalho. Isso argues for a banda do meio (perguntar) em zona cinza.
5. **O transporte já suporta `score`** e nenhum ponto usa → o primeiro ponto de *ranking* é o menor incremento
   técnico de toda a lista (normalizer pronto, providers prontos, UI de threshold pronta via `thresholdLabel`).
6. **O desbloqueio de quase tudo é upstream** (`calionauta/stelow`), não deste repo: schema de escopo +.fields
   `risk`/`type`/`sequence`. AGENTS.md: mudança de `skills/` ou `data/stelow-assets/` local é revertida no
   próximo sync.

## 7. Superfície candidata (para o stage `context`, não implementado aqui)

Rotas possíveis, em ordem de custo crescente — a escolha é do stage de context, não deste recon:

- **R0 (upstream, sem router):** adicionar `risk` (1-5) e `type` aos contratos de escopo e **executar** a regra
  `>=5 → spike obrigatório`, `>=4 → front-load` como validação de ingest. Sem LLM, sem API, sem ponto novo.
- **R1 (menor incremento com router):** ponto `scope-risk` — `score` por escopo (criteria = os 5 níveis da
  tabela 1-5, reescritos como *situações*, não graus), state compacto (título + outcome + IN/OUT +Touched files +
  contagem de dependências), usado como **evidência obrigatória** na coluna Risk do plano e como sinal para R0.
- **R2 (gate):** ponto `spike-worthy` — `noul` por candidato a spike, com 3 bandas: `noul >= a` marca `[spike]`,
  faixa intermediária vira **pergunta viva** na planning (nunca spike silencioso), abaixo de `b` fica feature.
- **R3 (advisory):** ponto `task-order` — `score` por task dentro de um escopo, ordena por score **depois** do
  `dependsOn` topológico; grava o score no artifact, e `lib/scope-order.mjs` continua sendo a autoridade.

Contra-indicadores honestos (para o context não herdar entusiasmo):
- R1/R2 sem R0 é **teatro advisesivo**: um score que ninguém valida contra o plano escrito não muda comportamento.
- **Q3 (ordem de escopos) deve ser descartado** até que exista evidência de que a topologia erra — a regra da casa
  é "prove que regras determinísticas não respondem primeiro", e aqui elas respondem.
- Todo ponto novo exige: schema de pergunta limitado, política de confiança, fallback, testes contra artefatos reais,
  e `thresholdLabel` próprio (o doc exige chave própria para direção de threshold diferente — `decision-routing.md:40-58`).

## 8. Perguntas abertas (para o stage `context`)

1. **O risco pode virar campo upstream?** `scope-map.json` é sync-owned e `additionalProperties:false`; sem isso,
   qualquer ponto de risco lê prosa. Verificar se `calionauta/stelow` aceita o campo ou se o plugin precisa de um
   contrato paralelo próprio (não-editável) em `data/`.
2. **Onde está a corpus para calibrar?** `docs/decision-routing.md` mediu ask/inbox/interface contra cards reais;
   o corpus de `spec-tech` com `Risk Score` preenchido é grande o bastante para um threshold? (search needed no corpus vivo)
3. **Spike errado é reversível?** Se o `[spike]` errado só custa um goal de research, a banda pode ser generosa;
   se ele muda o DoD/verification do escopo, a banda tem de ser conservadora. Precisa ler `goals.md`/`scope-batch`
   para saber o custo real de um scope re-tipado.
4. **Escopo de edição:** isto é recomendação para card novo (`feature`), ou um patch upstream em `calionauta/stelow`?
   O pin está em `data/stelow-source.json` (`0.71.8-alpha`, `3eff9d3`).
5. **A skill da community substitui algo aqui?** `building-with-typesafe-jev` e `typesafe-ai` oficial são
   documentação, não código. Não devem entrar em `skills/` (sync-owned). Se algo for adotado, a forma correta é
   incorporar as regras a `docs/decision-routing.md` upstream, não vendorizar a skill.

## 9. Evidências

**Lido:**
`docs/decision-routing.md` (110), `docs/native-workflows.md` (66), `lib/decision-points.mjs` (212),
`lib/decision-api.mjs` (trechos: 1-120, 120-180, 251-302), `server/decision-api-seams.ts` (1-60),
`lib/scope-order.mjs` (1-80), `data/stelow-assets/schemas/scope-map.json`,
`skills/stelow-workflow-tech-planning/{SKILL.md,references/scope-generation.md,references/scopes-and-sequencing.md,references/tech-output.md}`,
`skills/stelow-workflow-scope-executor/SKILL.md` (100-135), `skills/stelow-product-scope-mapping/SKILL.md` (45-80),
`skills/stelow-workflow-orchestrator/recipe-catalog.json` (setup-recon), `stages.yaml` (38-150),
`FEATURES.md` (1195-1270), `lib/workflow-skills-sync.mjs` (310-360), `scripts/sync-stelow-assets.mjs`,
`data/stelow-source.json`, `.stelow/2026-09-30/sw-card_hh2nwqs4/state.md` + `context/recon-receipt.json`.

**Buscado:**
`decision-routing|decisionRouting|decision_routing` (só `AGENTS.md` + `README.md` → política é o único registro canônico);
`spike` em `skills/stelow-workflow-orchestrator/` e `tests/` (**zero** testes mencionam spike);
`Risk Score|RISK` em `lib/` + `server/` (**zero hits** — confirma que risco é prosa);
`risk` em `lib/`/`server/` → só `ripwire-lanes`, `stage-catalog`, `ask-gate`, `lock-blocked` (não relacionados);
`git log docs/decision-routing.md` → 3 commits (`#157`, `#97`, `#89`).

**Pesquisado (web, 2026-09-30):** skill oficial `typesafe-ai` (raw GitHub), skill comunitária
`building-with-typesafe-jev` (SKILL.md + índice de prior-art), `jevtypesafeai.com/agent-skill`,
`jevwiki.ai` (referência da skill agent), `thejevai.com/docs`, blog TypeSafe "Introducing System One Models & Jev",
páginas de demo/ecosystem (model routing, MCP). Nenhuma fonte oficial foi instalada nem executada — leitura apenas.

**Nenhum arquivo do workspace foi alterado** (read-only conforme o task boundary); `state.md`, gates e completion
state intactos.
