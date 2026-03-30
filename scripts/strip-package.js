import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packagePath = join(__dirname, '..', 'package.json');

const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));

// Удаляем mock-скрипты
const mockScripts = ['mock:install', 'mock:start', 'mock:dev'];
mockScripts.forEach(script => delete pkg.scripts[script]);

// Упрощаем скрипт build (убираем копирование конфигов)
if (pkg.scripts.build) {
  pkg.scripts.build = 'tsc';
}

// Перезаписываем файл
writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

console.log('✓ package.json очищен для деплоя:');
console.log('  - Mock-скрипты удалены');
console.log('  - Build упрощён до "tsc"');
console.log('  Теперь выполните: git add package.json && git commit -m "..."');
