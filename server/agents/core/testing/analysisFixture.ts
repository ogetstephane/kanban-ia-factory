import { buildDefinitionCatalog } from '../index';
import type { AnalysisTask, AnalysisWorkspace } from '../analysis';
import { contentHash } from '../snapshot';

export const fixtureTask: AnalysisTask = {
  id: 'analysis-fixture', agentId: 'analyst', executionProfileId: 'analysis',
  paths: ['src'], variables: {},
};
export const fixtureWorkspace: AnalysisWorkspace = {
  id: 'fixture', root: 'memory://fixture', baseRevision: 'fixture-revision',
  files: { 'src/service.ts': 'export class Service {}', '.env': 'EXCLUDED' },
};
export const fixtureReport = {
  summary: 'A service exists.',
  observations: [{ description: 'Service declaration.', evidence: [{ path: 'src/service.ts', line: 1 }] }],
  limitations: ['Fixture, not a live runtime qualification.'],
};
export function analysisFixtureCatalog(providerId = 'fake', modelId = 'fake-model') {
  const base = { schemaVersion: 1 as const, version: '1', source: {
    uri: 'fixture', sha256: contentHash('fixture'), trust: 'managed' as const,
  } };
  return buildDefinitionCatalog({
    instructions: [], skills: [], workflows: [],
    prompts: [{
      ...base, id: 'prompt', description: 'Analyze fixture', template: 'Analyze the service with repository.read.',
      variablesSchema: { type: 'object', additionalProperties: false },
      output: { kind: 'json', schema: { type: 'object' } },
    }],
    agents: [{
      ...base, id: 'analyst', description: 'Fixture analyst', name: 'Analyst', role: 'Analysis',
      instructionIds: [], skillIds: [], promptId: 'prompt', tools: ['repository.read', 'repository.search'],
      autonomy: 'semi', policyId: 'readonly', executionProfileId: 'analysis',
      budget: { enforcement: 'strict', limits: { maxToolCalls: 5, maxDurationMs: 5000, maxAttempts: 1 } },
    }],
    policies: [{
      ...base, id: 'readonly', description: 'Read only', defaultEffect: 'deny',
      rules: [{ id: 'read', effect: 'allow', tools: ['repository.read', 'repository.search'] }],
      workspace: { readablePaths: ['src'], writablePaths: [], network: 'deny', allowedHosts: [] },
    }],
    executionProfiles: [{
      ...base, id: 'analysis', description: 'Fixture runtime', fallback: 'disabled', targets: [{ providerId, modelId }],
    }],
  });
}
