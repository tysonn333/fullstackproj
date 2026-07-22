import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalRepository } from './localRepository.js';
import { SupabaseRepository } from './supabaseRepository.js';

export function createRepository(config, options = {}) {
  if (options.repository) return options.repository;
  if (config.supabaseConfigured) return new SupabaseRepository(config);

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return new LocalRepository({
    filePath: options.filePath ?? path.resolve(currentDir, '../../data/local-db.json'),
    email: config.localAdminEmail,
    password: config.localAdminPassword,
    initialData: options.initialData,
  });
}
