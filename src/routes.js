import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function mountRoutes(app) {
  const modulesDir = join(__dirname, 'modules');
  const dirs = readdirSync(modulesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dir of dirs) {
    const routeFiles = readdirSync(join(modulesDir, dir))
      .filter(f => f.endsWith('.routes.js'));

    for (const file of routeFiles) {
      const mod = await import(`./modules/${dir}/${file}`);
      app.use('/api', mod.default);
    }
  }
}
