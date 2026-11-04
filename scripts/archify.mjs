#!/usr/bin/env node
// Analyses the committed application sources and renders both generated and
// hand-authored Archify diagrams through the validated `finalize` pipeline.
// Usage: node scripts/archify.mjs [name ...]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyzeProject, AUTOMATIC_DIAGRAMS, readCommittedSources } from './archify-analysis.mjs';

const root = process.cwd();
const sourceDir = path.resolve(root, process.env.ARCHIFY_DIR || 'doc/archify');
const outputDir = path.join(sourceDir, 'generated');
const automaticSourceDir = path.join(outputDir, 'sources');
const cli = path.resolve(root, process.env.ARCHIFY_CLI || '.agents/skills/archify/bin/archify.mjs');
const NAME = /^[a-z0-9][a-z0-9-]*$/;

if (!existsSync(cli)) {
  console.error(`Archify CLI not found at ${path.relative(root, cli)}. Run \`make archify-install\` first.`);
  process.exit(1);
}
if (!existsSync(sourceDir)) {
  console.error(`No diagram sources: ${path.relative(root, sourceDir)} does not exist.`);
  process.exit(1);
}

const manual = readdirSync(sourceDir).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5));
const collisions = manual.filter((name) => AUTOMATIC_DIAGRAMS.includes(name));
if (collisions.length) {
  console.error(`Automatic diagram names are reserved; rename these hand-authored sources: ${collisions.join(', ')}`);
  process.exit(1);
}
const available = [...manual, ...AUTOMATIC_DIAGRAMS].sort();
const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !available.includes(name));
if (unknown.length) {
  console.error(`Unknown diagram(s): ${unknown.join(', ')}. Available: ${available.join(', ') || 'none'}`);
  process.exit(1);
}
const names = requested.length ? requested : available;
if (!names.length) {
  console.error(`No *.json diagram source in ${path.relative(root, sourceDir)}.`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
const automatic = names.filter((name) => AUTOMATIC_DIAGRAMS.includes(name));
if (automatic.length) {
  try {
    const relativeOutput = path.relative(root, outputDir).split(path.sep).join('/');
    if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith('../') || path.isAbsolute(relativeOutput)) {
      throw new Error('ARCHIFY_DIR must place generated diagrams inside the project directory.');
    }
    const snapshot = readCommittedSources(root);
    if (snapshot.dirty) {
      console.warn('Uncommitted application changes are not analyzed; diagrams use the committed Git revision.');
    }
    const locale = path.resolve(path.dirname(cli), '../examples/locales/fr.json');
    const translations = {
      ...JSON.parse(readFileSync(locale, 'utf8')),
      'viewer.export.svg.auto': 'SVG · Automatique',
      'viewer.export.svg.auto.hint': 'Suit le thème de la page',
      'viewer.export.svg.light': 'SVG · Clair',
      'viewer.export.svg.light.hint': 'Toujours clair',
      'viewer.export.svg.dark': 'SVG · Sombre',
      'viewer.export.svg.dark.hint': 'Toujours sombre',
      'viewer.guide.title': 'Explorer ce système',
      'viewer.focus.selectedNodes': '{count} nœuds sélectionnés',
      'viewer.guide.credit': 'Archify vous est utile ? Une étoile sur GitHub peut aider',
      'viewer.guide.star': 'Étoile',
      'viewer.passport.move': 'Déplacer la fiche. Glisser, utiliser les flèches ou appuyer sur Home pour réinitialiser.',
      'viewer.outline.title': 'Index des éléments',
      'viewer.rail.show': 'Notes et index',
      'viewer.rail.controls': 'Panneau latéral',
      'viewer.rail.collapse': 'Réduire le panneau latéral',
      'viewer.rail.bottom': 'Déplacer le panneau sous le diagramme',
      'viewer.rail.right': 'Déplacer le panneau à côté du diagramme',
      'diagram.description.erd': 'Un diagramme entité-association généré par Archify.',
      'node.context.erd': 'Entité',
      'legend.erd.pk': 'Clé primaire',
      'legend.erd.fk': 'Clé étrangère',
      'legend.erd.uk': 'Clé unique',
      'legend.erd.one': 'Un',
      'legend.erd.many': 'Plusieurs',
      'legend.erd.optional': 'Facultatif',
    };
    const diagrams = analyzeProject(snapshot.files, snapshot.repository, translations, relativeOutput, automatic);
    mkdirSync(automaticSourceDir, { recursive: true });
    for (const [name, { spec, unresolved }] of Object.entries(diagrams)) {
      writeFileSync(path.join(automaticSourceDir, `${name}.json`), `${JSON.stringify(spec, null, 2)}\n`);
      if (unresolved.length) console.warn(`${name}: ${unresolved.length} unresolved local references; see the diagram for examples.`);
    }
    console.log(`Analyzed ${snapshot.files.size} committed sources at ${snapshot.revision.slice(0, 7)}.`);
  } catch (error) {
    console.error(`Archify source analysis failed: ${error.message}`);
    process.exit(1);
  }
}
const failures = [];
for (const name of names) {
  if (!NAME.test(name)) { failures.push(`${name}: file names must be lowercase kebab-case`); continue; }
  const source = path.join(AUTOMATIC_DIAGRAMS.includes(name) ? automaticSourceDir : sourceDir, `${name}.json`);
  let spec;
  let sourceText;
  try { sourceText = readFileSync(source, 'utf8'); spec = JSON.parse(sourceText); }
  catch (error) { failures.push(`${name}: invalid JSON (${error.message})`); continue; }
  if (typeof spec.diagram_type !== 'string') { failures.push(`${name}: missing diagram_type`); continue; }
  const quality = spec.meta?.quality_profile ?? 'showcase';
  const output = path.join(outputDir, `${name}.html`);
  process.stdout.write(`archify ${spec.diagram_type.padEnd(12)} ${path.relative(root, source)} -> ${path.relative(root, output)} … `);
  const args = [cli, 'finalize', spec.diagram_type, source, output];
  if (spec.meta?.repository) args.push('--repo-root', root);
  const hash = createHash('sha256').update(sourceText).digest('hex').slice(0, 16);
  args.push('--quality', quality, '--out-dir', path.join(outputDir, 'receipts', `${name}-${hash}`), '--json');
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  let receipt;
  try { receipt = JSON.parse(run.stdout); } catch { receipt = undefined; }
  if (run.status === 0 && receipt?.ok) { console.log('ok'); continue; }
  console.log('FAILED');
  const details = receipt?.diagnostics?.map((diagnostic) => `  - ${diagnostic.message}`).join('\n')
    || (run.stderr || run.stdout || run.error?.message || '').trim();
  failures.push(`${name}${receipt?.failedStage ? ` (${receipt.failedStage})` : ''}:\n${details}`);
}

if (failures.length) {
  console.error(`\n${failures.length} diagram(s) failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`\n${names.length} diagram(s) generated in ${path.relative(root, outputDir)}/`);
