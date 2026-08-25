import fs from 'node:fs';
import path from 'node:path';

const exists = (p) => fs.existsSync(p);

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

/**
 * Decide how to build a source directory. Order matters: an explicit Dockerfile
 * always wins, then a front-end build that produces static files, then Nixpacks
 * auto-detection, then a plain folder of HTML.
 */
export function detect(dir) {
  if (exists(path.join(dir, 'Dockerfile'))) {
    return { strategy: 'dockerfile', kind: 'container', label: 'Dockerfile' };
  }

  const pkg = readJson(path.join(dir, 'package.json'));
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts ?? {};

    // A front-end framework with a build script and no server entrypoint compiles
    // to static assets, which Caddy can serve directly. No container needed.
    const frontend = ['react-scripts', 'vite', 'next', '@angular/core', 'vue', 'svelte']
      .find((d) => d in deps);
    const hasServer = ['express', 'fastify', 'koa', 'hapi', '@nestjs/core']
      .some((d) => d in deps);

    if (frontend && scripts.build && !hasServer) {
      // Next.js only emits static output when explicitly configured to.
      if (frontend === 'next') {
        return { strategy: 'nixpacks', kind: 'container', label: 'Next.js (SSR)' };
      }
      const outDir = frontend === 'vite' ? 'dist' : 'build';
      // Prefer an explicit production build script when the project has one;
      // real projects often make plain `build` mean something else.
      const buildScript = ['build:prod', 'build'].find((n) => n in scripts) ?? 'build';
      return {
        strategy: 'static-build', kind: 'static', outDir, buildScript,
        label: `${frontend} (static, npm run ${buildScript})`,
      };
    }
    return { strategy: 'nixpacks', kind: 'container', label: 'Node.js' };
  }

  const pythonMarkers = ['requirements.txt', 'pyproject.toml', 'Pipfile'];
  if (pythonMarkers.some((f) => exists(path.join(dir, f)))) {
    return { strategy: 'nixpacks', kind: 'container', label: 'Python' };
  }

  // Nixpacks covers Go, Ruby, Rust, PHP, Java and more beyond the cases above.
  const otherMarkers = ['go.mod', 'Gemfile', 'Cargo.toml', 'composer.json', 'pom.xml'];
  if (otherMarkers.some((f) => exists(path.join(dir, f)))) {
    return { strategy: 'nixpacks', kind: 'container', label: 'auto-detected' };
  }

  if (exists(path.join(dir, 'index.html'))) {
    return { strategy: 'static', kind: 'static', outDir: '.', label: 'static HTML' };
  }

  throw new Error(
    `could not work out how to build ${dir} — add a Dockerfile, a package.json, or an index.html`,
  );
}
