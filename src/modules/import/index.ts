import type { ModuleDef } from '../../core/module';
import type { Env } from '../../env';
import { boiRateSource } from '../fx';
import { createImportRoutes } from './routes';
import { AnthropicExternalDocExtractor } from './upload-extractor';
import type { UploadDeps } from './upload-service';

export * as importService from './service';
export * from './types';
export * as uploadService from './upload-service';
export * from './upload-types';
export type { ExternalDocExtractor, ExternalDocExtractInput } from './upload-extractor';
export type { UploadDeps } from './upload-service';

function defaultUploadDeps(env: Env): UploadDeps {
  return {
    extractor: new AnthropicExternalDocExtractor(env),
    fx: boiRateSource(env.DB),
    files: env.FILES,
  };
}

/** Builds the import module. Tests pass `resolveUploadDeps` returning fakes (runs/_common.md). */
export function createImportModule(resolveUploadDeps: (env: Env) => UploadDeps = defaultUploadDeps): ModuleDef {
  return {
    name: 'import',
    basePath: '/import',
    routes: createImportRoutes(resolveUploadDeps),
  };
}

export const importModule: ModuleDef = createImportModule();
