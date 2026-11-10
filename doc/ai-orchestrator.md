# Architecture d'un orchestrateur IA multi-provider

## Objectif et statut

Ce document formalise une architecture cible pour mutualiser instructions,
skills, prompts, agents et workflows tout en prenant en charge plusieurs
runtimes IA. Il s'agit d'une proposition de conception, pas d'une description
complète du comportement actuellement livré par l'application.

L'application actuelle exécute des sessions de tickets avec Copilot. Son
interface [AgentProvider](../server/agents/provider.ts) et son adaptateur
[CopilotProvider](../server/agents/copilotProvider.ts) constituent un point de
départ, mais leur contrat et leur contexte restent liés aux tickets Kanban.
L'objectif est une extraction incrémentale, sans réécriture préalable.

Le premier slice du Core est implémenté dans
[server/agents/core](../server/agents/core/) : contrats, validation du
catalogue, snapshot, résolution d'instructions et permissions, workflow
séquentiel et provider fake. Le scénario d'analyse en lecture seule est
également implémenté et testé hors ligne. Des adaptateurs Copilot et Claude Code séparés et un
stockage Prisma sont disponibles, sans raccordement au service de sessions ni
aux routes d'analyse de l'application. Le moteur de tickets possède désormais
un orchestrateur multi-provider applicatif distinct, décrit en fin de document ;
il ne détourne pas ces adaptateurs d'analyse pour autoriser des écritures.
L'exécution réelle du runner d'analyse reste bloquée sans qualification
explicite du runtime ; les sondes natives Claude Code passent sans appel modèle,
et vérifient le refus de délégation via un serveur synthétique local. Des
réglages SDK documentés produisent désormais des inventaires skills/plugins
vides, sans exception au garde. La qualification de production par modèle
reste à établir. Codex n'est pas encore intégré.
L'isolation effective des fichiers, du réseau et des commandes doit être
démontrée avant l'activation en production.

## Décisions structurantes

1. Le Core définit les contrats et règles métier, sans importer de SDK IA.
2. Les définitions d'agents et workflows ne nomment pas de fournisseur.
3. Le provider est le runtime d'agent; le modèle est une sélection distincte
   effectuée pour ce runtime. Choisir un modèle Claude dans Copilot n'exécute
   pas Claude Code.
4. L'orchestrateur décide du workflow, des approbations, des budgets globaux
   et des transitions. Le runtime conserve sa boucle agentique locale.
5. Une capacité manquante n'est simulée que si l'alternative préserve la
   garantie demandée. Une instruction dans un prompt ne remplace pas un contrôle
   de permission.
6. Chaque exécution utilise un snapshot immuable des définitions et du contexte.
7. Le MVP utilise un processus et des workflows séquentiels. Pas de DSL
   arbitraire, de moteur distribué ou de parallélisme générique.

## Architecture en couches

```text
definitions (AGENTS.md, SKILL.md, JSON canonique)
                       |
                       v
catalogue -> context resolver -> policy/budget checks
                       |
                       v
application/orchestrator -> ports -> provider adapters
              |              |       ├── Copilot SDK
              |              |       ├── Claude Agent SDK
              |              |       └── Codex SDK
              |              |
              ├── durable execution store
              ├── workspace manager
              ├── approval gateway
              └── verifier/action handlers
```

Le Core contient les types, invariants et décisions pures. La couche
application charge les définitions, prépare une exécution et fait avancer un
workflow. Les adaptateurs implémentent les ports du Core. La persistance, les
workspaces et les approbations sont également derrière des ports.

Organisation indicative :

```text
src/
  core/          # types, règles de résolution, états et budgets
  application/   # préparation d'exécution et moteur de workflow
  ports/         # AIProvider, stockage, workspace, approbation
  adapters/      # chargeur, stockage, sandbox et providers
definitions/
  AGENTS.md
  instructions/
  skills/
  prompts/
  agents/
  policies/
  execution-profiles/
  workflows/
tests/
```

Ce découpage est logique, pas une obligation de créer un package ou service
par dossier.

## Contrats canoniques

Les définitions sur disque sont des données validées à l'exécution, pas des
instances TypeScript importées. Les exemples ci-dessous décrivent le contrat
cible. Chaque type sérialisable doit avoir un schéma runtime versionné. Les
callbacks et `AbortSignal` n'appartiennent pas aux fichiers de définition ni
aux données persistées.

### Types communs

```ts
type DefinitionId = string;
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface DefinitionSource {
  uri: string;
  sha256: string;
  trust: "managed" | "project";
}

interface DefinitionMetadata {
  schemaVersion: 1;
  id: DefinitionId;
  version: string;
  description: string;
  source: DefinitionSource; // attribuée par le chargeur
}

interface Conditions {
  paths?: string[];
  taskKinds?: string[];
  agentIds?: DefinitionId[];
}
```

Les identifiants sont uniques dans le catalogue. `version` est une version de
définition, distincte de `schemaVersion` et de la version d'un SDK.

### Instructions

```ts
interface InstructionDefinition extends DefinitionMetadata {
  scope: "global" | "project" | "agent";
  content: string;
  priority: number;
  appliesWhen?: Conditions;
  conflictKey?: string;
  replaces?: DefinitionId[];
}
```

`AGENTS.md` reste un document d'instructions humain et interopérable. Il ne
définit pas à lui seul un algorithme universel de priorité. Les conditions,
priorités et remplacements sont des métadonnées du catalogue interne, tenues
dans un manifeste séparé lorsqu'elles ne sont pas représentables par le
format du fichier.

### Skills

```ts
interface SkillResource {
  path: string; // relatif au répertoire de la skill
  kind: "reference" | "script" | "asset";
  sha256: string;
}

interface SkillDefinition extends DefinitionMetadata {
  name: string;
  entrypoint: string; // SKILL.md
  instructions: string;
  resources: SkillResource[];
  activation: {
    mode: "required" | "on-demand";
    taskKinds?: string[];
  };
  dependencies: DefinitionId[];
  requiredTools: string[];
}
```

Le répertoire suit le standard Agent Skills : `SKILL.md` avec frontmatter
`name` et `description`, et ressources optionnelles telles que `references/`,
`scripts/` et `assets/`. `activation`, `dependencies` et `requiredTools` sont
des extensions du catalogue, pas des champs garantis par le standard. La
découverte des métadonnées ne charge pas automatiquement les scripts ni tous
les documents de référence.

### Prompts, agents et profils d'exécution

```ts
type JsonSchemaSubset = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchemaSubset>;
  required?: string[];
  items?: JsonSchemaSubset;
  enum?: JsonValue[];
  additionalProperties?: boolean | JsonSchemaSubset;
};

type OutputContract =
  | { kind: "text" }
  | { kind: "json"; schema: JsonSchemaSubset };

interface PromptDefinition extends DefinitionMetadata {
  template: string;
  variablesSchema: JsonSchemaSubset;
  output: OutputContract;
}

interface BudgetLimits {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCost?: { currency: "USD"; micros: number };
  maxToolCalls: number;
  maxDurationMs: number;
  maxAgentTurns?: number;
  maxAttempts: number;
}

interface AgentDefinition extends DefinitionMetadata {
  name: string;
  role: string;
  instructionIds: DefinitionId[];
  skillIds: DefinitionId[];
  promptId: DefinitionId;
  tools: string[];
  autonomy: "manual" | "semi" | "autonomous";
  policyId: DefinitionId;
  executionProfileId: DefinitionId;
  budget: {
    limits: BudgetLimits;
    enforcement: "strict" | "best-effort";
  };
}

interface ExecutionTarget {
  providerId: string;
  modelId?: string; // opaque et propre au provider
}

interface ExecutionProfile extends DefinitionMetadata {
  targets: ExecutionTarget[]; // premier choix puis replis déclarés
  fallback: "disabled" | "before-side-effects";
}
```

Le schéma de sortie de ce contrat est volontairement un sous-ensemble
démarrant avec les besoins du MVP. Une extension vers JSON Schema complet
nécessitera un validateur compatible et une politique de compatibilité
explicite.

### Permissions et workflows

```ts
interface PermissionRule {
  id: string;
  tools: string[];
  effect: "allow" | "deny" | "approval";
  resources?: string[];
}

interface PolicyDefinition extends DefinitionMetadata {
  defaultEffect: "deny";
  rules: PermissionRule[];
  workspace: {
    readablePaths: string[];
    writablePaths: string[];
    network: "deny" | "allowlist";
    allowedHosts: string[];
  };
}

interface ArtifactBinding {
  stepId: string;
  artifactName: string;
}

type WorkflowStep =
  | {
      kind: "agent";
      id: string;
      agentId: DefinitionId;
      inputs: Record<string, ArtifactBinding>;
    }
  | {
      kind: "verification";
      id: string;
      verifierId: string;
      inputs: Record<string, ArtifactBinding>;
    }
  | {
      kind: "approval";
      id: string;
      actionId: string;
      inputs: Record<string, ArtifactBinding>;
    };

interface WorkflowDefinition extends DefinitionMetadata {
  steps: WorkflowStep[];
}
```

Le MVP ne permet que des séquences. Un vérificateur ou une action est un
handler enregistré et approuvé par l'application, jamais du code exécutable
contenu dans une définition. Les cycles, références et sorties obligatoires
sont validés avant le premier effet de bord. Les cycles de réparation restent
différés : ils ne sont ni déclarés dans le contrat MVP ni exécutés par son
moteur de workflow.

## Chargement et résolution

### Découverte déterministe

Le chargeur reçoit des racines autorisées et suit un pipeline unique :

1. Résoudre chaque chemin réel et rejeter tout chemin ou lien symbolique
   sortant des racines.
2. Découvrir les fichiers reconnus et analyser leur format, sans exécuter
   scripts ni suivre des références externes.
3. Valider les métadonnées et schémas.
4. Rejeter les identifiants dupliqués, références manquantes et cycles.
5. Vérifier les chemins de ressources, leurs tailles et empreintes.
6. Construire un catalogue immuable avec provenance et empreintes.
7. Créer un snapshot des définitions utilisées par chaque exécution.

Les racines et l'ordre de recherche sont configurés par l'hôte. Une définition
de projet ne peut ni remplacer silencieusement une définition gérée ni étendre
les racines autorisées.

Le chargeur initial est implémenté dans
[definitionLoader.ts](../server/agents/core/definitionLoader.ts) et reconnaît
`AGENTS.md` à la racine, `instructions/**/AGENTS.md`, les skills sous
`skills/<name>/SKILL.md` et les définitions JSON sous `instructions/`,
`prompts/`, `agents/`, `policies/`, `execution-profiles/` et `workflows/`.
Le YAML de `SKILL.md` est parsé par la bibliothèque `yaml`. Le nom de la skill
doit correspondre au répertoire parent. Les chemins de ressources sont
relatifs à la skill. Les définitions JSON contiennent les champs du contrat,
mais leur champ `source` est toujours remplacé : URI logique, empreinte des
octets lus et niveau de confiance proviennent de la racine déclarée, jamais
du contenu du fichier.

Les limites initiales sont de 500 définitions, 1 MB par fichier et 5 MB de
ressources par skill. Les liens symboliques dans les sous-répertoires parcourus
sont refusés. Les racines sont explicites ; aucun parcours implicite des
répertoires personnels ou des ancêtres du workspace n'est effectué.
`loadDefinitionContext` retourne aussi les octets base64 des ressources,
indexés par leur empreinte, dans une structure immuable. Le chemin historique
`loadDefinitionCatalog` reste disponible pour les clients qui ne demandent
que le catalogue.

### Résolution des instructions

1. Filtrer par portée et conditions applicables.
2. Appliquer seulement les remplacements explicitement autorisés.
3. Trier par priorité au sein d'un même niveau d'autorité.
4. Refuser les conflits déclarés non résolus ; ne pas arbitrer automatiquement
   les conflits sémantiques entre paragraphes arbitraires.

La résolution du texte n'accorde jamais de permissions. Pour les permissions,
l'effet effectif est l'intersection des autorisations système, projet, agent,
tâche et environnement : un `deny` l'emporte et une approbation obligatoire
ne peut être supprimée par une règle `allow`. Une skill ou instruction ne peut
pas élargir cette politique.

### Préparation du contexte et chargement des skills

Le résolveur construit les instructions effectives, valide les variables du
prompt, résout les skills autorisées et produit un bundle. Deux stratégies
sont admises par adaptateur :

- **contrôlée** : le résolveur injecte le contenu et l'adaptateur désactive la
  découverte ambiante ;
- **native contrôlée** : l'adaptateur expose au runtime uniquement le bundle
  autorisé, puis vérifie la configuration effective.

Une skill n'est jamais chargée deux fois via injection et découverte native.
Les fichiers de dépôt sont des données non fiables ; leur présence ne donne
pas permission de lancer un script, d'accéder au réseau ou de modifier des
fichiers.

## Contrat provider

Les événements sont canoniques et les identifiants de session native restent
opaques. Le runtime ne choisit pas les prochaines étapes du workflow.
Ce contrat est la cible de conception. Les types expérimentaux du Core ne
représentent pas encore tous les éléments ci-dessous.

```ts
type FeatureSupport = "native" | "unsupported" | "unknown";

type ProviderFeature =
  | "nativeAgents"
  | "nativeSkills"
  | "delegation"
  | "structuredOutput"
  | "textStreaming"
  | "sessionResume"
  | "blockingToolPermissions"
  | "toolHooks"
  | "parallelSessions";

interface ProviderCapabilities {
  providerId: string;
  modelId?: string;
  sdkVersion: string;
  runtimeVersion?: string;
  observedAt: string;
  features: Record<ProviderFeature, FeatureSupport>;
  customTools: "direct" | "mcp" | "unsupported" | "unknown";
  usageReporting: "reported" | "estimated" | "unavailable";
  maxConcurrentSessions?: number;
}

interface ModelDescriptor {
  id: string;
  name: string;
}

interface PreparedExecutionRequest {
  executionId: string;
  workflowRunId: string;
  attempt: number;
  agent: { id: DefinitionId; version: string };
  target: ExecutionTarget;
  workspace: { id: string; root: string; baseRevision: string };
  instructionBlocks: {
    id: DefinitionId;
    content: string;
    source: DefinitionSource;
  }[];
  contextBundle: ContextBundle;
  capabilityPlan: CapabilityPlan;
  prompt: string;
  output: OutputContract;
  tools: string[];
  policy: PolicyDefinition;
  budget: AgentDefinition["budget"];
  snapshotId: string;
  nativeSessionId?: string;
}

interface UsageMeasurement {
  inputTokens?: number;
  outputTokens?: number;
  cost?: { currency: "USD"; micros: number };
  basis: "reported" | "estimated" | "unavailable";
}

interface Artifact {
  id: string;
  name: string;
  kind: "plan" | "patch" | "report" | "verification";
  uri: string;
  sha256: string;
}

type ExecutionErrorCode =
  | "AUTHENTICATION"
  | "CAPABILITY_UNSUPPORTED"
  | "POLICY_DENIED"
  | "INVALID_OUTPUT"
  | "RATE_LIMITED"
  | "RUNTIME_FAILURE";

interface ExecutionError {
  code: ExecutionErrorCode;
  message: string;
  retryable: boolean;
}

type AgentExecutionResult = {
  artifacts: Artifact[];
  usage: UsageMeasurement;
  nativeSessionId?: string;
} & (
  | { status: "succeeded"; output: JsonValue }
  | { status: "failed"; error: ExecutionError }
  | { status: "cancelled"; reason: string }
  | { status: "interrupted"; reason: string }
  | { status: "budget_exceeded"; limit: keyof BudgetLimits }
);

interface ExecutionEvent {
  executionId: string;
  sequence: number;
  occurredAt: string;
  payload:
    | { type: "started"; nativeSessionId?: string }
    | { type: "text_delta"; text: string }
    | { type: "tool_requested"; callId: string; toolId: string }
    | { type: "tool_completed"; callId: string; succeeded: boolean }
    | { type: "usage"; usage: UsageMeasurement }
    | { type: "artifact"; artifact: Artifact };
}

interface ActionRequest {
  executionId: string;
  callId: string;
  toolId: string;
  arguments: Record<string, JsonValue>;
  resources: string[];
}

type AuthorizationDecision =
  | { decision: "allow"; authorizationId: string }
  | { decision: "deny"; reason: string };

interface ExecutionControls {
  signal: AbortSignal;
  onEvent(event: ExecutionEvent): Promise<void>;
  authorize(action: ActionRequest): Promise<AuthorizationDecision>;
}

interface AIProvider {
  readonly id: string;
  getCapabilities(target: ExecutionTarget): Promise<ProviderCapabilities>;
  listModels(): Promise<ModelDescriptor[]>;
  health(): Promise<{
    available: boolean;
    authenticated: boolean;
    issue?: string;
  }>;
  execute(
    request: PreparedExecutionRequest,
    controls: ExecutionControls
  ): Promise<AgentExecutionResult>;
}
```

Les capacités dépendent du runtime, de ses versions, du compte, du modèle et de
la configuration ; `unknown` n'est pas assimilé à `native`. L'orchestrateur
refuse de démarrer si une garantie demandée ne peut être assurée. Le contrôle
des outils est rendu effectif par un broker ou une sandbox, pas par du texte
dans le prompt.

Les événements persistés ont un ordre monotone par exécution. Le consommateur
peut regrouper les deltas de texte, mais doit traiter les erreurs d'écriture
et la backpressure. Les exceptions de programmation ou d'invariant peuvent
être rejetées ; les erreurs runtime prévues sont normalisées dans le résultat.

## Scénario de référence : analyse en lecture seule

### Périmètre et résultat attendu

Une tâche demande à l'agent `repository-analyst` d'analyser une zone du dépôt
et de retourner un rapport JSON avec des observations sourcées. Le même agent,
prompt et workflow doivent fonctionner avec un fake provider, puis Copilot et
un second runtime, en ne changeant que le profil d'exécution.

L'agent ne peut ni écrire, ni lancer de commande, ni accéder à un secret.
Le stockage du rapport est une opération de l'hôte hors du workspace ; ce
n'est pas un outil accordé à l'agent. Le transport IA est autorisé par l'hôte
vers le provider sélectionné, mais l'accès réseau depuis les outils reste
interdit.

La lecture seule doit être appliquée pendant toute l'exécution : outils
contrôlés et/ou environnement techniquement confiné, configuration ambiante
désactivée ou qualifiée. Un diff vide à la fin ne prouve pas l'absence d'une
écriture temporaire et ne remplace pas ce contrôle.
Si le broker est utilisé, tous les accès de l'agent passent par ses outils :
les outils natifs non contrôlés sont désactivés. Un broker limité à certains
outils n'est pas une preuve de confinement du runtime entier.

### Entrée et bundle préparé

```ts
interface AnalysisTask {
  id: string;
  agentId: DefinitionId;
  executionProfileId: DefinitionId;
  workspaceId: string;
  paths: string[]; // chemins relatifs autorisés
  variables: Record<string, JsonValue>;
}

interface ContextBundle {
  id: string; // empreinte du manifeste canonique et de ses contenus
  instructions: {
    id: DefinitionId;
    content: string;
    source: DefinitionSource;
  }[];
  skills: {
    id: DefinitionId;
    entrypoint: "SKILL.md";
    content: string;
    resources: SkillResource[];
  }[];
  workspaceSnapshotId: string;
}

type CapabilityStrategy =
  | "native"
  | "controlled-skill-injection"
  | "validated-json"
  | "host-tool-broker"
  | "sandbox-read-only";

interface CapabilityRequirement {
  id: string;
  acceptableStrategies: CapabilityStrategy[];
}

interface CapabilityPlan {
  target: ExecutionTarget;
  capabilities: ProviderCapabilities;
  resolutions: {
    requirementId: string;
    strategy: CapabilityStrategy;
    evidenceId: string; // qualification du runtime ou de l'environnement
  }[];
}

interface CanonicalToolDefinition {
  id: string;
  description: string;
  inputSchema: JsonSchemaSubset;
  outputSchema: JsonSchemaSubset;
  effect: "read";
}
```

Les exigences sont fixées par la politique de l'hôte et les besoins de
l'agent, pas inventées ou diminuées par le provider. Le registre d'outils
injecté dans l'adaptateur associe chaque ID de la requête à une définition
canonique immuable ; un ID inconnu bloque la préparation.

L'agent référence des IDs canoniques tels que `repository.list`,
`repository.read` et `repository.search`. L'adaptateur les traduit vers des
outils directs ou MCP lorsqu'il sait les exposer. Il ne remplace pas ces outils
par un shell généraliste. Les arguments, résultats, chemins et limites de
lecture sont vérifiés par l'hôte ; la politique est réévaluée à chaque appel.

Le bundle est accessible à l'adaptateur par son ID via un stockage de contenus
immuables injecté par l'hôte. Les ressources sont récupérées depuis ce stockage,
pas relues depuis un fichier ayant pu changer après approbation. Son empreinte
couvre les instructions effectives, skills et empreintes des ressources.
Le snapshot de requête couvre aussi les variables, prompt rendu, outils,
politique, budget, cible et plan de capacités. Il ne contient aucun secret
d'authentification.

`instructionBlocks` dans la requête est la projection des instructions du
bundle, pas une seconde source mutable. Une divergence doit être refusée.

### Préparation et exécution

1. Valider la tâche, les variables et les chemins contre les racines autorisées.
2. Charger le catalogue, sélectionner l'agent et résoudre ses instructions.
   Inclure les conventions globales et celles des zones demandées ; ne pas
   appliquer les instructions d'un autre agent.
3. Résoudre les dépendances des skills, figer leurs contenus et ressources.
   Les skills requises sont préparées avant lancement ; les autres ne sont
   accessibles qu'à la demande parmi le catalogue autorisé.
4. Rendre le template avec les variables validées. Le MVP accepte uniquement
   `{{variable}}` au premier niveau, sans expressions ni exécution de code.
   Une variable ou un placeholder manquant est une erreur de préparation.
   Les valeurs de tâche restent des données, jamais des règles de permission.
5. Pour chaque cible déclarée, vérifier santé, modèle et capacités effectives.
   Vérifier également les garanties du broker et de l'environnement de l'hôte.
   Une capacité native déclarée sans qualification n'est pas suffisante.
6. Résoudre chaque exigence vers une stratégie acceptable. Pour ce scénario :
   skills natives contrôlées ou injection ; JSON natif ou validation ; lecture
   seule qualifiée via broker ou confinement. Streaming et agents natifs sont
   optionnels. Si une exigence n'est pas satisfaite, refuser avant lancement.
7. Réserver le budget, persister la tentative et son snapshot, puis lancer
   le provider. Le provider reçoit une requête déjà préparée, pas une tâche
   dont il doit choisir la stratégie globale.
8. Valider chaque demande d'outil, enregistrer les événements, consommation et
   artefacts. Une erreur de persistance bloque la progression et déclenche
   une demande d'arrêt ; elle ne doit pas être masquée.
9. Valider la sortie et les preuves indépendamment du provider. Stocker le
   rapport vérifié et terminer l'exécution logique.

La session native et la tentative ont des identifiants distincts. Le résultat
`succeeded` du provider signifie que son tour s'est terminé avec une sortie ;
seul le résultat de vérification fait réussir l'exécution logique.

### Rapport et vérification

```ts
interface AnalysisReport {
  summary: string;
  observations: {
    description: string;
    evidence: {
      path: string;
      line: number; // entier positif, ligne du snapshot du workspace
    }[];
  }[];
  limitations: string[];
}

type VerificationResult =
  | { status: "passed"; report: AnalysisReport; checks: string[] }
  | { status: "failed"; errors: { code: string; message: string }[] };
```

Le schéma runtime impose les champs ci-dessus, refuse les propriétés inconnues
et valide les types. Chaque observation doit avoir au moins une référence.
Le vérificateur contrôle que chemins et lignes existent dans le snapshot
autorisé. Il vérifie également les résultats d'outils et la conservation du
workspace. Il ne prétend pas prouver la justesse sémantique de chaque
observation : une référence valide peut rester une interprétation incorrecte.

Le parsing JSON hors mode natif n'accepte pas une réponse textuelle arbitraire
comme résultat valide. Au premier incrément, une sortie invalide échoue :
pas de correction automatique ni changement silencieux de provider.

### Hooks, approbations et budgets

- **Observation** : début/fin d'exécution, usage et artefacts. Les abonnés ne
  donnent aucun droit et ne peuvent pas transformer un échec en succès.
- **Interception** : autorisation des outils avant tout effet. Seules les
  surfaces natives ou le broker qualifiés peuvent assurer le caractère
  bloquant ; un événement reçu après exécution ne suffit pas.
- **Actions métier** : vérification et publication du rapport par l'hôte.
  Aucun script de hook provenant d'une définition n'est exécuté.

Ce scénario ne nécessite pas d'approbation d'écriture. L'autorisation initiale
de transmettre les données au provider relève de l'hôte. Une demande dépassant
le périmètre est refusée ; l'agent ne peut pas élargir ses droits en demandant
une approbation en cours de tour. Questions interactives, approbations de plan,
expiration et reprise restent un incrément séparé, avant toute écriture.

Le budget initial fixe une tentative, une durée, un nombre d'appels d'outils
et une taille de contexte. Les limites tokens/coût sont facultatives.
Si elles sont configurées en mode strict sans contrôle qualifié, la
préparation échoue. Le mode best-effort annonce ses estimations et les
consommations inconnues. Annuler le runtime ne garantit pas un arrêt immédiat
de la facturation ; le bilan final conserve les données disponibles.

### Critères d'acceptation hors ligne

| Cas | Résultat exigé |
|---|---|
| Catalogue et tâche valides | Requête préparée déterministe, rapport vérifié |
| Variable manquante ou template invalide | Échec avant appel du provider |
| Ressource modifiée après chargement | Bundle figé inchangé ; nouveau chargement produit un autre snapshot |
| Lecture hors périmètre, écriture ou commande | Refus avant effet, événement et raison conservés |
| Exigence sans stratégie qualifiée | Échec avant lancement, pas de dégradation silencieuse |
| Sortie JSON invalide ou référence inexistante | Échec de vérification, pas de succès logique |
| Annulation avant lancement | Aucun appel au provider |
| Annulation pendant le tour | Arrêt demandé, artefacts conservés ; état interrompu si arrêt non confirmé |
| Budget strict non applicable | Refus de préparation |
| Échec de stockage | Échec explicite, demande d'arrêt et pas de publication |
| Changement de profil | Même agent, prompt, outils et workflow ; nouvelle cible et nouveau snapshot |

Le fake du Core actuel restitue des résultats préprogrammés. Il doit être
utilisé avec ses scripts de test pour simuler demandes d'outils, usages,
annulations et erreurs ; il ne constitue pas lui-même une preuve de
qualification d'un runtime. Ensuite, un test d'intégration opt-in vérifie
le même contrat sur Copilot puis un second runtime. Comparer les garanties
et formes de sortie, pas l'égalité textuelle des réponses des modèles.

### API implémentée et limites du palier hors ligne

Les points d'entrée [prepareAnalysis et runAnalysis](../server/agents/core/analysis.ts)
consomment un catalogue, une tâche, un snapshot textuel du workspace et les
dépendances explicitement injectées par l'hôte.

- `AnalysisHost` fournit les providers, leur qualification (identité, modèle,
  versions et preuve d'exclusivité du broker) et les ressources figées.
- `AnalysisWorkspace.files` est un snapshot fourni par l'hôte : ce palier ne
  parcourt pas le dépôt vivant. L'hôte doit approuver ces fichiers et exclure
  les secrets avant de fournir le snapshot.
- La préparation filtre les fichiers selon les chemins de la tâche et la
  politique. Les conventions incompatibles entre zones imposent des analyses
  distinctes. Les dépendances d'une skill requise sont requises elles aussi.
- `repository.list`, `repository.read`, `repository.search` et `skill.load`
  sont les seuls outils reconnus. Leur exposition exige une autorisation
  dans l'agent et la politique. Les arguments sont validés strictement.
  Les références d'un rapport doivent exister dans le snapshot et avoir été
  effectivement renvoyées par une lecture ou une recherche autorisée.
- Une lecture est limitée à 500 lignes, un résultat d'outil à 100 KB et une
  recherche littérale à 100 correspondances (lignes tronquées à 1 000
  caractères). Le contexte préparé et la sortie sont limités à 1 MB ;
  le snapshot textuel à 5 MB.
- `AnalysisStore` acquitte la requête préparée avant tout lancement, puis les
  événements et le résultat vérifié. Les tests du Core utilisent un stockage
  en mémoire ; [PrismaAnalysisStore](../server/db/analysisStore.ts) fournit
  maintenant la persistance SQLite avec une migration dédiée.
  L'identifiant de tâche doit identifier une exécution logique unique dans ce
  stockage ; retries et reprise durable restent différés.
- Les mesures d'usage sont cumulatives par tentative, jamais additionnées
  comme des deltas. Les limites tokens/coût/tours natifs strictes sont refusées
  faute d'un mécanisme d'application. En best-effort, l'hôte journalise cette
  limite et contrôle les mesures disponibles sans inventer une consommation.
- La durée limite déclenche une demande d'arrêt. Après 100 ms sans résultat
  terminal, l'état devient `interrupted`, même si un budget a déclenché
  l'arrêt. Ce délai est une convention du palier fake, pas une garantie de
  destruction d'un processus ou d'arrêt de facturation.
- Le provider reçoit une requête immuable contenant le bundle et le plan de
  capacités. Le snapshot du workspace ne peut pas être modifié via les outils
  fournis. Cela ne qualifie pas une sandbox réelle : tout futur adaptateur
  devra démontrer que ses outils natifs, configurations et accès annexes ne
  contournent pas le broker.

Les schémas de prompt supportent uniquement le sous-ensemble documenté.
Un mot-clé non supporté est refusé. Les variables ne sont pas réinterprétées
comme un deuxième template. Une sortie, un événement ou une mesure invalide
ne peut pas être transformé en succès par un provider qui ignore l'erreur.
Une erreur de publication du résultat rejette l'appel sans répétition implicite.

Le test [coreAnalysis.test.ts](../server/agents/coreAnalysis.test.ts) couvre le
parcours depuis des définitions sur disque jusqu'au rapport vérifié, ainsi
que les refus, l'annulation, les profils et les erreurs de stockage.

### Adaptateur Copilot et persistance SQLite

[CopilotAnalysisProvider](../server/agents/adapters/copilotAnalysisProvider.ts)
implémente le contrat canonique `AIProvider`, sans modifier le provider des
tickets. Il crée un client SDK en mode `empty` avec `workingDirectory` et
`baseDirectory` temporaires : le chemin du dépôt vivant n'est jamais utilisé
comme répertoire de travail du runtime. Les outils utilisent les mêmes schémas
d'arguments que le broker du Core et leurs résultats proviennent exclusivement
du snapshot fourni par l'hôte.

La configuration désactive découverte d'instructions, skills natives, hooks
sur disque, plugins, git hôte, mémoire, récupération par embeddings et stockage
inter-session. L'allowlist expose uniquement les outils canoniques demandés.
Les noms natifs utilisent des alias explicites (`repository.read` devient
`analysis_repository_read`) car le runtime refuse les points dans les noms
d'outils externes. Le broker continue de recevoir les identifiants canoniques ;
la traduction est confinée à l'adaptateur.
Avant tout envoi au modèle, l'adaptateur initialise les outils et vérifie leur
inventaire exact ainsi que l'absence d'instructions ambiantes, d'agents
personnalisés et de skills actives. Un inventaire absent, inattendu ou une
erreur RPC bloque l'exécution ; les options de configuration seules ne
constituent pas une preuve d'exclusivité.
Le callback de permissions et le hook pré-outil refusent tout accès hors
broker ; une restriction gérée demandant une approbation n'est pas contournée.
Un refus reste un échec même si le modèle continue avec une sortie valide.
La sortie JSON est validée côté Core, sans prétendre disposer d'une contrainte
native ; consommation et coût sont déclarés indisponibles.

**Activation refusée par défaut.** Les `qualifications` injectées dans
l'adaptateur et dans `AnalysisHost` doivent identifier exactement le provider,
le modèle, la version SDK installée et la version effective du runtime, avec
un `evidenceId` et `exclusiveToolBroker: true`. La version est revérifiée
avant la création de session. Ne pas utiliser les preuves simulées des tests
pour qualifier un runtime réel : ces tests contrôlent la traduction du contrat,
pas le confinement du processus. Les sondes natives ci-dessous exercent
maintenant les outils RPC dans un environnement isolé ; elles ne suffisent
pas à autoriser une combinaison de versions et de modèle pour la production.

L'annulation appelle `session.abort()` ; le résultat n'est rendu qu'après
l'arrêt du client. Un arrêt non confirmé produit `interrupted` et conserve le
répertoire temporaire indiqué dans l'erreur pour diagnostic, plutôt que de
prétendre que le processus a disparu. Le délai de grâce de 100 ms du Core peut
également interrompre l'attente avant que le SDK ait fini son nettoyage.

Le stockage [PrismaAnalysisStore](../server/db/analysisStore.ts) et la
[migration](../prisma/migrations/20261109105732_analysis_executions/migration.sql)
ajoutent `AnalysisExecution` et `AnalysisExecutionEvent`. La préparation est
créée sans upsert ; chaque événement doit avoir la prochaine séquence attendue
et son insertion est atomique avec l'avancement du compteur. Le résultat
terminal ne peut pas être réécrit. Un échec de préparation ne peut pas écraser
une autre exécution portant le même identifiant. `get(executionId)` restitue
le snapshot, les événements ordonnés et le résultat après reconnexion.
La reprise automatique d'un runtime après redémarrage reste hors périmètre.

Appliquer la migration par `make db-migrate` avant d'utiliser ce stockage.
Sa génération et ses tests utilisent des bases temporaires ; la base locale
existante n'est pas modifiée automatiquement par ce palier.

Exemple de composition côté serveur, avec un catalogue et un snapshot déjà
approuvés, et des qualifications réellement établies :

```typescript
const provider = new CopilotAnalysisProvider({ qualifications });
const store = new PrismaAnalysisStore(db);
const result = await runAnalysis(task, catalog, workspace, {
  providers: [provider],
  qualifications,
  resourceContents,
}, store, signal);
```

Les [tests d'adaptateur](../server/agents/copilotAnalysisProvider.test.ts) sont
hors ligne et simulent le SDK ; les [tests de stockage](../server/db/analysisStore.test.ts)
appliquent les migrations à SQLite et vérifient la persistance après reconnexion.
Aucun appel IA live ni consommation de quota n'est lancé par ces tests.

### Sondes du runtime natif sans appel au modèle

`make test-analysis-native` lance les [sondes natives](../server/agents/copilotAnalysisNative.test.ts)
avec le [lanceur bubblewrap](../scripts/test-analysis-native.mjs), sur Linux.
Node 22 est sélectionné comme pour les autres cibles Copilot. La commande
échoue si bubblewrap ou le runtime n'est pas disponible : aucun repli sur
l'environnement hôte n'est autorisé.

Le lanceur monte en lecture seule les binaires système, `node_modules` et les
sources d'analyse explicitement sélectionnées. Il ne monte ni le dépôt complet,
ni `.env`, ni le dossier personnel de l'utilisateur, ni un socket Docker.
L'environnement est vidé ; HOME et `/tmp` sont jetables. Les espaces de noms
processus et réseau sont séparés, sans accès réseau. Les marqueurs et faux
secrets utilisés appartiennent uniquement aux fixtures.

Les contrôles utilisent **le même constructeur de configuration de session que
l'adaptateur**. Ils vérifient :

- l'inventaire exact des alias d'outils et les inventaires ambiants vides ;
- une lecture du snapshot, différente du fichier vivant de la fixture ;
- le refus indépendant du shell, des lectures et écritures natives, du réseau,
  des skills natives et de la délégation ;
- le refus des lectures `.env` et `../outside` via le broker ;
- l'intégrité des fichiers factices et l'absence d'exécution du hook marqueur ;
- le rejet d'une session dont le répertoire contient des instructions hostiles ;
- l'arrêt du client et la disparition des PID enfants observés du runtime.

Exécution observée le 2026-11-09 : SDK `1.0.27`, runtime `1.0.104`, protocole `3`.
Les sondes ont révélé deux points corrigés : les identifiants contenant des
points sont invalides côté runtime, et `instructions.getSources()` retrouve
les instructions d'un répertoire contaminé malgré les options de désactivation.
Ce dernier constat porte sur l'inventaire ; il ne prouve pas à lui seul une
injection dans le prompt. Il justifie le répertoire vide et le contrôle
bloquant avant envoi.

**Limite importante :** aucune requête au modèle ni authentification de
l'utilisateur n'est utilisée. Les appels RPC sont pilotés déterministement
depuis un harness fake du Core, pas par un modèle. `session.abort()` est exercé
hors tour actif ; l'annulation d'un véritable tour, les attaques pilotées par
modèle, le comportement réseau nécessaire au provider et l'arrêt de facturation
restent à qualifier explicitement. Les sondes n'écrivent donc aucune
qualification de production et ne débloquent pas l'adaptateur.

### Annulation live sur un tour actif

Le [test live](../server/agents/copilotAnalysisLive.test.ts), exécuté via
`COPILOT_ANALYSIS_MODEL=<id> make test-analysis-live`, est distinct des sondes
sans réseau. Il exige une approbation explicite de la consommation de quota,
une authentification `gh` et un choix explicite de modèle disponible. Le
[lanceur](../scripts/test-analysis-live.mjs) conserve l'isolation du système de
fichiers et des processus, mais partage le réseau hôte pour joindre Copilot.
Il n'établit donc pas de garantie de confinement réseau.

Le jeton est capturé sans affichage via `gh auth token`, transmis sur stdin,
puis fourni au SDK sans monter le dossier personnel de l'utilisateur.
Le test utilise une qualification provisoire limitée à son processus et ne
l'enregistre nulle part. Aucun fichier du dépôt n'est envoyé au modèle :
le prompt demande une longue sortie JSON synthétique sans appel d'outil.

Le test exerce `CopilotAnalysisProvider` et `runAnalysis` avec les vrais
`sendAndWait`, `session.abort` et `client.stop`. Seul le streaming est activé
dans la session de test pour observer un fragment de sortie du modèle avant
d'annuler. Il refuse de conclure si aucune activité réelle n'est observée.
Il vérifie un résultat terminal non réussi, une seule publication, la
disparition du PID du runtime et le nettoyage des répertoires temporaires.
Le délai de grâce du Core peut donner `interrupted` plutôt que `cancelled` ;
la vérification séparée d'arrêt attend au plus 10 secondes.

Résultat observé le 2026-11-09, après autorisation : SDK `1.0.27`, runtime
`1.0.104`, modèle `claude-haiku-4.5`, résultat `cancelled`, disparition du
processus vérifiée 29 ms après la demande d'arrêt. Un seul tour synthétique
a été demandé. Ce résultat ne démontre ni l'arrêt de facturation côté
fournisseur, ni les attaques pilotées par modèle, ni une qualification
générale pour la production. L'activation par défaut reste refusée.

### Second adaptateur : Claude Code, validation hors ligne

[ClaudeAnalysisProvider](../server/agents/adapters/claudeAnalysisProvider.ts)
implémente le même `AIProvider`, avec l'identifiant `claude-code`, sans modifier
le Core ni les définitions métier. Il utilise le Claude Agent SDK, pas un modèle
Claude sélectionné dans Copilot. La version installée est `0.3.319`, avec le
runtime embarqué `2.1.319` ; ces versions viennent des métadonnées du package,
et la version du binaire a ensuite été vérifiée dans la sonde isolée décrite
ci-dessous, pas sur un déploiement de production.

Les quatre outils canoniques sont traduits en outils MCP du serveur en mémoire
`analysis`, par exemple `repository.read` devient
`mcp__analysis__repository_read`. Leurs schémas et leur exécution proviennent du
broker du Core. Instructions et skills restent injectées depuis le snapshot.
La sortie JSON textuelle est vérifiée par le Core ; le mode structured output
natif n'est pas activé, pour ne pas ajouter d'outil natif de formatage.

L'adaptateur demande la désactivation des outils intégrés, agents personnalisés,
skills, plugins, sources de settings utilisateur/projet et reprise de session.
Attention : `agents: {}` n'efface pas le registre des agents intégrés du runtime.
De même, `skills: []` et `plugins: []` ne suffisent pas à retirer les éléments
intégrés. L'adaptateur combine `disableBundledSkills`, les overrides de skills
`doctor`/`plugin-authoring` à `off` et `enabledPlugins: false` pour les trois
plugins intégrés observés. Ces réglages documentés sont vérifiés dans la sonde
native ; tout élément résiduel ou nouveau reste refusé par le garde strict.
Le répertoire de travail,
le HOME, la configuration et les fichiers temporaires sont éphémères.
L'environnement du processus est remplacé, sans héritage du shell.
Seule une clé API Anthropic explicitement fournie via `apiKey` est acceptée :
aucune lecture automatique de `.env`, du login Claude ou des credentials hôte.
`health()` vérifie la source de clé déclarée par le runtime, pas la validité
de cette clé auprès du service ; un refus serveur reste une erreur d'exécution.
Les modèles proposés utilisent les identifiants résolus lorsqu'ils sont disponibles.

Les hooks `PreToolUse` bloquent tout outil hors broker et vérifient la provenance
MCP `sdk`, pas seulement son nom. Les demandes de permission restantes sont
refusées, notamment lorsqu'une politique d'organisation demande une approbation :
l'adaptateur ne remplace pas cette approbation par une autorisation automatique.
Il exige la confirmation d'enregistrement des hooks avec échec bloquant avant
d'envoyer le prompt, puis vérifie l'inventaire exact des outils MCP et leur
provenance `sdk`. Le registre descriptif des agents peut être non vide : ce sont
les outils exécutables qui sont contrôlés, pas une liste blanche de noms d'agents.
Les outils intégrés sont explicitement interdits ; les appels assistant hors
broker, les réponses de sous-agents et les événements de démarrage de tâches
déclenchent un refus persistant, même si le SDK n'a pas appelé le hook.
L'inventaire `system/init` est ensuite vérifié : outils,
runtime, modèle, répertoire, skills, plugins et serveurs MCP.
**Cet inventaire ne prouve pas qu'aucune inférence ne l'a précédé.**
Les settings administrés et les hooks de machine nécessitent encore une
qualification dans un environnement isolé ; ces options SDK ne sont pas une sandbox.

L'annulation est transmise à l'`AbortController` du SDK. Après `close()`,
l'adaptateur attend la sortie du processus enfant observé. Un arrêt non confirmé
devient `interrupted`, avec conservation du répertoire de diagnostic.
Le délai de grâce de 100 ms du Core peut lui aussi produire `interrupted`.
La consommation reste explicitement indisponible dans ce slice : les mesures
du SDK ne sont pas encore normalisées et aucune limite stricte de tokens/coût
n'est annoncée.

Les [tests hors ligne](../server/agents/claudeAnalysisProvider.test.ts) exécutent
le même scénario `runAnalysis` que Copilot, avec un transport de runtime simulé,
le véritable serveur MCP SDK en mémoire et un enfant Node inerte pour vérifier
son arrêt. Ils couvrent preuves du rapport, refus persistants, inventaires
contaminés, erreurs terminales, annulation et nettoyage.
Ils ne démarrent pas Claude Code et ne font aucun appel modèle ou réseau.
Ils ne qualifient donc ni le confinement natif ni l'annulation d'un tour Claude réel.
Sans preuve injectée pour le triplet SDK/runtime/modèle, l'exécution reste refusée.
L'adaptateur n'est branché ni à l'API ni aux sessions Kanban.

### Sondes natives Claude Code sans appel modèle

`make test-analysis-claude-native` lance les
[sondes natives](../server/agents/claudeAnalysisNative.test.ts) via un
[lanceur bubblewrap](../scripts/test-analysis-claude-native.mjs) utilisant les
mêmes montages explicites et espaces de noms que les sondes Copilot.
Le réseau externe, le HOME personnel, les identifiants, `.env`, les settings
administrés de l'hôte et le dépôt complet ne sont pas exposés.
Les sondes de handshake, de garde MCP préalable et d'arrêt inactif ne libèrent
aucun message utilisateur. Une sonde de protocole envoie des tours synthétiques
à un serveur HTTP/SSE compatible Anthropic, uniquement sur le loopback de
l'espace réseau isolé. Aucun service IA externe ni modèle réel n'est sollicité.

Résultats observés le 2026-11-09 : SDK `0.3.319`, binaire Claude Code
`2.1.319` vérifié avec `--version`, quatre sondes réussies :

1. Dans un répertoire propre puis dans une fixture hostile, le runtime confirme
   l'enregistrement des hooks avec échec bloquant et connecte seulement le serveur
   MCP `analysis`, avec `repository_read` et `repository_search`. L'agent, la skill,
   le serveur MCP et le hook de la fixture hostile ne sont pas chargés/exécutés.
   Les fichiers restent inchangés. Cela ne prouve pas l'absence de toute instruction
   dans un contexte modèle : aucun contexte d'inférence n'est inspecté.
2. Malgré `agents: {}`, l'initialisation annonce cinq agents intégrés : `claude`,
   `Explore`, `general-purpose`, `Plan`, `statusline-setup`. Le mode `--bare`
   essayé pendant l'investigation ne les retire pas non plus.
   Une réponse SSE synthétique demande une lecture MCP et une délégation à chacun
   de ces cinq agents, ainsi que `Task` et `Workflow`. La lecture réussit une fois ;
   chaque délégation reçoit un `tool_result` en erreur. Seuls les deux outils MCP
   sont envoyés au serveur ; aucun événement de tâche enfant ni réponse de
   sous-agent n'apparaît, et exactement deux requêtes HTTP sont observées.
   Le runtime rejette ces outils indisponibles avant même les hooks ; l'adaptateur
   observe donc aussi directement les blocs assistant `tool_use`.
3. Un inventaire MCP altéré est refusé par le véritable adaptateur **avant de
   libérer le prompt**, avec qualification provisoire propre au test. Zéro message
   envoyé, disparition de l'enfant et nettoyage du répertoire sont vérifiés.
4. L'`AbortController` du vrai SDK arrête un runtime initialisé mais inactif.
   La disparition du processus est vérifiée ; ce n'est pas une annulation de
   génération active et aucun résultat de facturation n'en est déduit.

**Qualification de production par modèle non accordée par ces tests.**
La contrainte « registre vide » a été remplacée par le contrôle du broker et
des outils exécutables, après démonstration native des refus de délégation.
Le blocage des skills/plugins intégrés est résolu sans contourner le garde.
Avec seulement `skills: []`, `plugins: []` et `disableBundledSkills: true`,
`system/init` annonçait encore `doctor`, `plugin-authoring` et les plugins
`cc-plugin-agents-md`, `cc-plugin-privacy`, `cc-plugin-plugin-authoring`.
Les réglages documentés `enabledPlugins` désactivent ces trois identifiants
suffixés `@builtin`, et `skillOverrides` masque les deux skills avec `off`.
Le vrai runtime annonce alors des inventaires skills/plugins vides. Cela
vérifie l'inventaire, pas l'absence de toute contribution interne au prompt.
Le véritable adaptateur accomplit un tour synthétique avec lecture broker et
restitue le JSON attendu. Le scénario canonique `runAnalysis` passe aussi via ce
SDK/runtime réel : le Core vérifie le rapport et les preuves observées du broker.
Il utilise un identifiant modèle résolu annoncé localement, pas une preuve de
disponibilité ou de qualité du service distant. Un tour demandant `Agent` échoue avec
`tool_denied`, même après annulation par l'hôte. Aucun élément intégré n'est
accepté par une exception : les inventaires non vides restent refusés.
L'essai `--bare` n'est pas conservé et aucun `allowedTools` n'auto-approuve les
outils à la place du callback.
Les attaques pilotées par un vrai modèle,
l'annulation active et la qualification SDK/runtime/**modèle** restent à établir.

### Préparation sans appel payant

`make test-analysis-claude-prepare` lance la même suite native isolée, sans lire
la clé API de l'hôte ni ouvrir le réseau externe. Le lanceur n'accepte que
`--prepare` ; `--run` et les arguments supplémentaires échouent avant tout
démarrage de runtime ou accès aux identifiants.

La répétition d'annulation utilise un flux SSE synthétique volontairement
inachevé : après réception d'un delta texte par le vrai SDK, l'adaptateur est
annulé. Le test exige `cancelled`, un seul appel HTTP, aucune réponse terminée
avant l'annulation, la fermeture du flux, la disparition du PID et le nettoyage
du répertoire en moins de cinq secondes après l'annulation.
Cela valide l'instrumentation et le cycle d'arrêt, pas une génération distante
ni l'arrêt de facturation.

Le budget strict demandé pour cette préparation est zéro. `maxBudgetUsd` du SDK
arrête une requête après dépassement ; le coût remonté est une estimation, pas
un relevé de facturation. Ce mécanisme n'établit donc pas de plafond facturé
strict. Aucun lancement payant n'est exposé par ce lanceur. Un test live reste
à implémenter et autoriser une fois cette contrainte budgétaire résolue.

## Cycle de vie d'une exécution

```text
queued -> preparing -> [awaiting_approval] -> running
                                      running -> awaiting_input -> running
                                      running -> verifying
                                      verifying -> succeeded
                                      verifying -> running (cycle de réparation borné)
                                      * -> failed | cancelled | interrupted | budget_exceeded
```

Chaque transition est persistée. Chaque tentative a un identifiant distinct,
des événements ordonnés et des références vers ses artefacts.

1. **Queued** : persister la commande, le workflow et l'identité de la tâche.
2. **Preparing** : charger/résoudre définitions, contexte, politiques, budget
   et capacités ; créer le workspace isolé et figer le snapshot.
3. **Awaiting approval** : demander l'accord sur une action, un plan et un
   snapshot précis. Toute modification matérielle invalide l'approbation.
4. **Running** : créer ou reprendre une session native ; convertir événements,
   permissions, questions, outils et consommation.
5. **Verifying** : valider la sortie, les artefacts et les vérifications
   requises indépendamment de la déclaration de l'agent.
6. **Terminal** : enregistrer succès, échec, annulation, interruption ou
   dépassement de budget. Un résultat absent n'est jamais un succès.

`AbortSignal` demande une annulation, mais n'en prouve pas l'achèvement.
Si le runtime ne confirme pas son arrêt, l'état devient `interrupted`. Les
artefacts et modifications déjà produits sont conservés.

Un fallback de provider est permis avant le premier effet de bord seulement.
Après écriture, il faut inspecter et checkpoint le workspace avant de démarrer
une nouvelle tentative ; aucune reprise aveugle ni migration de session native
n'est permise. Les budgets enfants consomment le budget du workflow parent.
Une mesure inconnue n'est jamais traitée comme zéro ; une limite stricte
nécessite un moyen d'application strict.

## Adaptateurs prévus

Les trois adaptateurs implémentent le même contrat Core, avec des
configurations privées ; ils ne créent pas trois contrats métier concurrents.

| Provider | Runtime natif | Responsabilités principales de l'adaptateur |
|---|---|---|
| `copilot` | GitHub Copilot SDK / Copilot CLI | Sessions, outils, événements, permissions et contexte/skills contrôlés |
| `claude-code` | Claude Agent SDK / Claude Code | Sources de settings autorisées, permissions, hooks, skills et sessions |
| `codex` | Codex SDK / Codex CLI | Threads, événements streamés, schéma de sortie et configuration du workspace |

Chaque adaptateur documente ses versions qualifiées, capacités garanties,
limitations, stratégie de cancellation et méthode de permission. En
particulier, ne pas annoncer un contrôle bloquant des outils si l'API native
ne peut pas l'assurer ; utiliser un broker/sandbox ou refuser le profil.

## Sécurité et limites de confiance

- L'autonomie (`manual`, `semi`, `autonomous`) ne neutralise jamais une
  politique ni une approbation obligatoire.
- Les permissions sont restrictives par composition : un refus l'emporte et
  une approbation ne peut être supprimée par une règle plus permissive.
- Le worktree protège le checkout principal, mais n'est pas une sandbox.
- Les commandes de tests exécutent du code du dépôt. Elles nécessitent un
  environnement confiné, sans secrets ambiants et avec accès réseau limité.
- Les chemins sont résolus et vérifiés contre les racines autorisées avant
  chaque lecture ou écriture.
- Le merge, le push, la suppression sensible et les opérations irréversibles
  restent des actions explicites séparées.
- Le contenu de dépôt, ticket et pièce jointe est une donnée non fiable, pas
  une source d'autorité.

## Workflow Symfony TDD

Workflow séquentiel initial :

| Étape | Agent / opération | Sortie requise | Gate |
|---|---|---|---|
| 1 | Architect | Plan et décisions proposées | Approbation pour changement majeur |
| 2 | Tester | Tests qui expriment le comportement | RED pertinent observé |
| 3 | Developer | Implémentation | GREEN observé |
| 4 | Reviewer | Rapport de défauts actionnables | Résolution des défauts bloquants |
| 5 | Verifier | Résultats des tests/lint et état du diff | Toutes les preuves requises présentes |
| 6 | Humain | Acceptation et livraison | Action séparée |

RED signifie que le test échoue pour le comportement attendu, pas qu'une
dépendance ou l'environnement est absent. GREEN est observé par un vérificateur
autorisé ; l'agent ne peut pas déclarer lui-même la gate satisfaite. Une
correction relance une boucle bornée et vérifie que les tests n'ont pas été
affaiblis. Le reviewer IA est consultatif ; le vérificateur et les politiques
déterminent l'avancement.

## Tests

### Core, sans IA

Utiliser un provider fake déterministe, une horloge contrôlée et un stockage
temporaire. Couvrir :

- validation, doublons, références manquantes, cycles et snapshots ;
- conditions et résolution d'instructions, conflits et remplacements ;
- refus prioritaire, demandes d'approbation et invalidation d'approbation ;
- capacités `unknown`/absentes et exigences non satisfaites ;
- validation de sortie et absence de gate sans preuve ;
- budgets cumulés, consommation inconnue et réservations concurrentes ;
- transitions, événements, annulation, interruption, reprise et retries ;
- fallback avant effet de bord et refus de replay après modification.

### Contrats provider

Une suite partagée vérifie normalisation du résultat et des erreurs, ordre des
événements, propagation de l'annulation, respect des permissions, absence de
succès sans résultat et remontée honnête de la consommation. Les tests de
capacités optionnelles sont conditionnels : le Core n'exige pas l'équivalence
des SDK.

### Intégration et tests live

Les tests d'intégration sans génération valident démarrage, configuration
contrôlée, enregistrement des outils et refus des sources non approuvées.
Des tests live opt-in sur dépôt jetable vérifient une tâche en lecture seule,
une modification bornée, une vérification réelle et l'annulation. Ils ne
doivent pas être requis par la CI standard s'ils dépendent d'une authentification
ou de quotas IA.

## MVP progressif

| Palier | Livrable | Critère de sortie |
|---|---|---|
| 0. Contrats | Schémas, états, règles et document de conception | Définitions métier sans référence à un SDK |
| 1. Core + fake | Chargeur, snapshots, politiques et workflow séquentiel | Suite Core complète hors ligne |
| 1 bis. Analyse en lecture seule | Préparation, bundle, négociation, outils et vérification | Tous les critères du scénario de référence satisfaits avec le fake |
| 2. Copilot | Adaptateur du runtime existant derrière les ports cibles | Exécution contrôlée avec événements et preuves |
| 3. Second runtime | Claude Code : tour synthétique natif réussi, inventaires skills/plugins vides et refus de délégation vérifiés ; qualification réelle par modèle restante | Même définitions et workflow sans changement Core |
| 4. Durabilité | Approbations, reprise et budgets globaux | Reprise sans replay aveugle |
| 5. Extensions | Troisième runtime, parallélisme ou agents natifs | Capacités ajoutées sans réduire les garanties |

Reporter marketplace, DAG générique, exécution distribuée, routage intelligent,
migration de conversations et DSL arbitraire. Le test d'extensibilité est
l'ajout du deuxième runtime sans modifier les définitions métier ni le Core.
Le palier 1 bis fonctionne hors ligne avec le fake et des snapshots fournis
par l'hôte. Les adaptateurs Copilot et Claude Code passent ce scénario avec
leurs transports simulés, sans changement du Core. Le vrai runtime Claude
passe aussi un tour synthétique local via son adaptateur, sans inférence.
Le prochain incrément est un test réel Claude opt-in en lecture seule et
d'annulation active, avec autorisation explicite des appels et de leur coût,
sans remplacement préalable du service de sessions Kanban.

## Migration depuis l'application actuelle

### Intégration Kanbanflow réalisée

Le moteur de dispatch des tickets passe désormais par `TicketOrchestrator`,
composé dans `server.ts`, avec Copilot par défaut et un adaptateur Claude
distinct pour planification, exécution et revue. La file persistante, les
questions, approbations, tentatives, empreintes de revue, worktrees et livraison
restent sous contrôle de `SessionService`. Les outils et instructions métier
ont été extraits de Copilot dans des définitions de session partagées, adaptées
en outils natifs Copilot ou MCP Claude. Aucun repli implicite entre fournisseurs.

L'activation Claude est **expérimentale et volontaire**, via
`KANBAN_EXPERIMENTAL_CLAUDE_TICKETS=true` et `KANBAN_CLAUDE_API_KEY`, avec modèle
du ticket ou `KANBAN_CLAUDE_MODEL`. Elle ne constitue pas une qualification du
runner d'analyse ni une garantie de coût. Elle ne doit pas être activée sous
une contrainte de zéro dollar. Aucun appel payant n'a été exécuté pour cette
intégration. Les tests de tickets utilisent un transport simulé, un vrai serveur
MCP en mémoire et des enfants inertes ; le parcours persistant est aussi testé
avec deux runtimes simulés.

Les contrats génériques `AIProvider`, le chargement du catalogue de définitions
et `runWorkflow` du Core ne sont pas encore utilisés pour piloter les écritures
des tickets. La façade applicative `AgentProvider` préserve les callbacks
interactifs et les transitions durables existantes plutôt que d'inventer une
équivalence avec le slice en lecture seule. La migration complète vers ces
contrats reste un incrément distinct. Les limites, permissions, activation et
formats supportés sont dans [les sessions de tickets](./agent-sessions.md).

### Cible de migration du Core

1. Garder le contrat ticket actuel comme façade d'application.
2. Extraire les politiques, événements et types réellement génériques vers des
   contrats neutres dans `shared/types/` ou un package Core dédié.
3. Déplacer progressivement résolution du contexte et orchestration hors de
   `CopilotProvider`; l'adaptateur reste responsable de traduire le contrat
   canonique vers le SDK.
4. Introduire le provider fake et les tests de contrat avant le second runtime.
5. Qualifier Claude Code, choisi comme second runtime, avant d'ajouter Codex
   ou de raccorder ces adaptateurs aux sessions Kanban.

Les sessions Kanban, snapshots de ticket et transitions de board restent des
responsabilités de l'application. Le Core ne dépend pas de leurs modèles de
données. Cette migration ne doit pas modifier l'expérience Copilot existante
avant que les tests de contrat confirment l'équivalence de ses garanties.
