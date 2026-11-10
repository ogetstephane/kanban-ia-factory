import { z } from 'zod';
import { stableJson } from './snapshot';

export interface JsonSchemaSubset {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchemaSubset>;
  required?: string[];
  items?: JsonSchemaSubset;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchemaSubset;
}

const schemaValidator: z.ZodType<JsonSchemaSubset> = z.lazy(() => z.object({
  type: z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']).optional(),
  properties: z.record(z.string(), schemaValidator).optional(),
  required: z.array(z.string()).optional(),
  items: schemaValidator.optional(),
  enum: z.array(z.json()).min(1).optional(),
  additionalProperties: z.union([z.boolean(), schemaValidator]).optional(),
}).strict());

export function validateJsonSchema(schema: unknown): void {
  schemaValidator.parse(schema);
}

export function validateJsonValue(schemaInput: unknown, value: unknown): void {
  const schema = schemaValidator.parse(schemaInput);
  const visit = (definition: JsonSchemaSubset, item: unknown, location: string) => {
    if (definition.enum && !definition.enum.some((choice) => stableJson(choice) === stableJson(item))) {
      throw new Error(`${location} is not an allowed enum value.`);
    }
    if (definition.type === 'object' || (item !== null && typeof item === 'object' && !Array.isArray(item)
      && (definition.properties || definition.required || definition.additionalProperties !== undefined))) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${location} must be an object.`);
      for (const required of definition.required ?? []) {
        if (!Object.hasOwn(item, required)) throw new Error(`${location}.${required} is required.`);
      }
      for (const [key, child] of Object.entries(item)) {
        const property = definition.properties && Object.hasOwn(definition.properties, key)
          ? definition.properties[key] : undefined;
        if (property) visit(property, child, `${location}.${key}`);
        else if (definition.additionalProperties === false) throw new Error(`${location}.${key} is not allowed.`);
        else if (typeof definition.additionalProperties === 'object') visit(definition.additionalProperties, child, `${location}.${key}`);
      }
    } else if (definition.type === 'array' || (Array.isArray(item) && definition.items)) {
      if (!Array.isArray(item)) throw new Error(`${location} must be an array.`);
      if (definition.items) item.forEach((child, index) => visit(definition.items!, child, `${location}[${index}]`));
    } else if (definition.type === 'null') {
      if (item !== null) throw new Error(`${location} must be null.`);
    } else if (definition.type === 'number' || definition.type === 'integer') {
      if (typeof item !== 'number' || !Number.isFinite(item)
        || (definition.type === 'integer' && !Number.isInteger(item))) throw new Error(`${location} must be ${definition.type}.`);
    } else if (definition.type && typeof item !== definition.type) throw new Error(`${location} must be ${definition.type}.`);
  };
  z.json().parse(value);
  visit(schema, value, '$');
}

export function renderPrompt(template: string, variables: Record<string, unknown>, schema: unknown): string {
  validateJsonValue(schema, variables);
  const placeholder = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  if (/\{\{|\}\}/.test(template.replace(placeholder, ''))) {
    throw new Error('Prompt templates only support {{variable}} placeholders.');
  }
  return template.replace(placeholder, (_match, name: string) => {
    if (!Object.hasOwn(variables, name)) throw new Error(`Prompt variable ${name} is missing.`);
    const value = variables[name];
    return typeof value === 'string' ? value : stableJson(value);
  });
}
