import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const configDir = join(rootDir, 'dist', 'config');
const configs = ['marketplaces.json', 'rate_limits.json'];

// Создаём директорию, если не существует
if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

// Копируем конфиги
configs.forEach(file => {
  const src = join(rootDir, 'src', 'config', file);
  const dest = join(configDir, file);
  copyFileSync(src, dest);
  console.log(`✓ Скопирован: ${file}`);
});

console.log('✓ Конфиги скопированы в dist/config/');
