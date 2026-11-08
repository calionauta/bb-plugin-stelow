# Migração: `appetite` → run knobs no bb-plugin-stelow

## Contexto

O plugin `bb-plugin-stelow` (`~/Development/bb-plugin-stelow`) vendoriza as skills e o helper do repo `stelow` (`~/Development/stelow`). Ele está pinado em `stelow 0.85.0-alpha` (commit `1ed37f9c1eaa`), já sincronizado — as 38 skills estão vendoradas e os assets estão atualizados.

**A tarefa é uma migração de contrato**, não um sync de assets.

O upstream removeu a escada `appetite: Lean|Core|Complete` no commit `6152d7c` ("explicit run knobs replace appetite ladder, add architecture stage and skills") e substituiu por **três** knobs explícitos:

```yaml
config:
  quality: production          # production | experimental
  exploration_count: 3         # 1-5
  exploration_hybrid: true
  review_mode: Auto
  product_type: software
```

**Importante — não são quatro knobs.** Um quarto, `supervisor` (low/med/high), foi introduzido junto com os outros e **removido depois**, na `0.76.0-alpha` do stelow. O motivo está no CHANGELOG deles: nada nunca ramificava no valor, era prosa custosa sem enforcement. Não reintroduza `supervisor`. Um `supervisor:` pré-existente em states antigos deve ser **ignorado**, exatamente como era antes.

## Estado atual do repositório

Existe um commit de prep já feito, em branch `chore/sync-stelow-0.85.0` (não mergeado):

- 38 skills vendoradas (eram 30) — as 4 que faltavam entraram, 9 refs obsoletas podadas
- `CORE_SKILLS` corrigido de 15 → 17 (as 2 skills de arquitetura nunca eram concedidas a workers)
- `PHASE_ENTRY_STAGES` agora lê `routes.entry_stages` (o catálogo novo só tem lá)

**Dois testes estão intencionalmente vermelhos** e são o objeto desta migração:

- `npm run test:contracts` — falha em "Lean has no multi-option selection contract"
- `npm run test:helper-sync` — falha em "taskless done commits"

Todos os outros passam: `test:skills-sync`, `test:skills-verify`, `test:skills-tables`, `test:declaration-surface`, `test:source-shape`.

## O que já foi descoberto (não redescubra)

O "62 arquivos com appetite" é enganoso. O núcleo real:

| Arquivo | O que faz | Trabalho |
|---|---|---|
| `lib/workflow-config.mjs` | `parseWorkflowConfig()` — único ponto de parsing | adicionar `quality`, `explorationCount`, `explorationHybrid`; manter `appetite` como leitura legada para states antigos |
| `lib/state-template.mjs` | `STATE_TEMPLATE` — string literal | trocar `appetite: Core` pelos 3 knobs |
| `lib/question-contracts.mjs` | filtra contratos por `contract.appetite` | **filtro já morto** — nenhum contrato do catálogo tem mais `appetite`. Ver abaixo |
| `lib/execution-artifacts.mjs:10` | `taskIsActive()` ramifica em `appetite_supports_fanout` | **código morto** — ver abaixo |

Os outros ~50 arquivos apenas carregam um campo `appetite: string` de uma camada para outra (tipos, prompts, RPC). São propagação, não lógica — mas renomeá-los é parte do trabalho para o contrato não ficar meio migrado.

### Dois filtros mortos, não um

**1. `question-contracts.mjs`** filtra por `!contract.appetite || contract.appetite.includes(appetite)`. Verifiquei: **nenhum contrato no catálogo tem `appetite`** desde a remoção. O filtro sempre passa. `Lean` e `Core` retornam resultados idênticos.

Isso significa que o teste "Lean has no multi-option selection contract" está testando um comportamento que não existe mais — a assertiva precisa mudar junto com o modelo, não o filtro ser consertado para voltar a funcionar.

**2. `execution-artifacts.mjs`** ramifica em `taskIsActive()`:

```js
if (task.when === "appetite_supports_fanout") return ["Core", "Complete"].includes(context.appetite);
```

Também morto. Contei as condições realmente usadas nas 44 tasks das recipes vendoradas:

```
43 when: always
 1 when: ui_scope_present
```

**Nenhuma recipe usa `appetite_supports_fanout` nem `exploration_supports_fanout`.** Não troque uma pela outra — ambas estão obsoletas.

O CHANGELOG do upstream explica por quê: `exploration_supports_fanout` fazia a recipe inteira rodar **zero tasks** em breadth 1, porque a task produtora era pulada e tudo dependia dela em cascata. A correção foi `when: always` — breadth controla a **quantidade** de propostas, nunca se elas acontecem.

Ou seja: o branch de fanout condicional em `taskIsActive` pode ir embora inteiro. O schema `data/stelow-recipes.schema.json` ainda lista as duas condições no enum porque é uma cópia do `recipes.schema.json` do upstream, que também as mantém como legado aceito. Não edite o schema; apenas pare de depender delas no código.

## Mapeamento legado (use este, não invente)

O helper do upstream (`scripts/stelow`, já vendorado em `data/stelow`) contém o fallback canônico:

```
qualquer appetite → quality: production
Lean             → exploration_count: 2
Complete         → exploration_count: 5
Core / outro     → exploration_count: 3
exploration_hybrid → true
```

States antigos com `appetite:` precisam **continuar funcionando** — o helper já os lê e mapeia. O código do plugin deve fazer o mesmo para não regredir workflows em andamento.

## Critérios de aceite

1. `npm test` no plugin passa inteiro (ou as mesmas falhas pré-existentes de antes do commit de prep, se houver alguma não relacionada — confirme rodando `git stash && npm test` no commit `63c4ff9` para comparar)
2. Um `state.md` no formato antigo (`appetite: Lean`) continua sendo lido e resolve para `exploration_count: 2`
3. Um `state.md` novo (3 knobs) é lido corretamente
4. `appetite` não aparece mais como campo de config próprio — só como alias de leitura legada, e isso deve estar comentado no código
5. Nenhum `supervisor` é introduzido
6. `npm run test:skills-verify` continua passando (o sync não pode regredir)

## Restrições do repo

- **Sem trailer de co-autoria de IA** em nenhum commit (regra do `AGENTS.md` da máquina)
- O pre-commit hook roda lint + source shape. Há ~45 warnings de `no-unused-vars` pré-existentes — são ruído conhecido, não os conserte no meio desta migração
- O repo tem um sistema de "source budgets" (dívida de linhas por função). `lib/workflow-skills-sync.mjs:syncWorkflowSkills` está no baseline em 112 linhas; não infle
- Não force-push em `master`
- O plugin versiona independente do stelow. **Só bumpe a versão do plugin depois que `npm test` estiver verde** — bumpar agora publicaria contrato defasado

## Como verificar que não quebrou de verdade

O teste que mais importa não é o de contrato, é o comportamento real. Depois de migrar:

```bash
# state antigo ainda lê?
node --input-type=module -e '
import {parseWorkflowConfig} from "./lib/workflow-config.mjs";
console.log(parseWorkflowConfig("config:\n  appetite: Lean\n  review_mode: Auto"));
'

# state novo lê?
node --input-type=module -e '
import {parseWorkflowConfig} from "./lib/workflow-config.mjs";
console.log(parseWorkflowConfig("config:\n  quality: production\n  exploration_count: 2\n  exploration_hybrid: true"));
'
```

O primeiro devolve `{"appetite":"Lean",...}` e o segundo também devolve `{"appetite":"Lean",...}` — **os dois são indistinguíveis hoje**. O state novo cai no `DEFAULT_APPETITE` porque `parseWorkflowConfig` só conhece `appetite` e `reviewMode`; os knobs são ignorados em silêncio. Depois da migração, ambos devem resolver para o mesmo estado efetivo (`quality: production`, `explorationCount: 2`) partindo de entradas diferentes.

Esse é o bug de verdade, e ele é pior que um teste vermelho: **um workflow criado hoje pelo template novo já perde os knobs na leitura**. O default `Lean` é aplicado onde o usuário declarou `production` + breadth 2.

## Onde procurar se algo não fechar

- `~/Development/stelow/CHANGELOG.md` — entradas `[0.76.0-alpha]` (remoção do supervisor) e a que descreve a chegada dos knobs
- `git show 6152d7c` em `~/Development/stelow` — o commit da migração, com o diff completo do helper e do template
- `~/Development/stelow/scripts/stelow` — o fallback de leitura legada, referência canônica do mapeamento
- `~/Development/stelow/skills/stelow-workflow-orchestrator/references/run-knobs.md` — **pode não existir**; eu não consegui localizar um arquivo dedicado. Se não existir, os knobs estão documentados no `state-template.md` e no helper, não numa referência própria

## Fora de escopo

- Não mexa no repo `stelow` (upstream). Ele está correto; o plugin é que está defasado
- Não faça o bump de versão do plugin nem atualize `data/stelow-source.json` — isso é passo posterior, depois do verde
- Não reorganize as skills vendoradas
