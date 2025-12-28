#!/usr/bin/env node
/* Cross-platform build script for obsidian-img_upload-plugin */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

async function readJson(filePath) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function ensureBuildNumber(versionFile) {
  try {
    const raw = await fs.promises.readFile(versionFile, 'utf8');
    const num = parseInt(String(raw).trim(), 10);
    if (Number.isFinite(num)) return num + 1;
  } catch (e) {
    // ignore missing or invalid file
  }
  return 1;
}

async function writeBuildInfo(tsPath, version, buildNumber, buildTime) {
  const content = [
    '// Auto-generated at build time. Do not edit by hand.',
    'export const BUILD_INFO = {',
    `  version: '${version}',`,
    `  buildNumber: ${buildNumber},`,
    `  buildTime: '${buildTime}',`,
    '};',
    '',
  ].join('\n');
  await fs.promises.writeFile(tsPath, content, 'utf8');
}

async function main() {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const versionFile = path.join(__dirname, '..', 'VERSION');
  const buildInfoPath = path.join(__dirname, '..', 'src', 'generated-build-info.ts');

  const manifest = await readJson(manifestPath);
  const version = manifest.version;
  const buildTime = new Date().toISOString();

  const buildNumber = await ensureBuildNumber(versionFile);
  await fs.promises.writeFile(versionFile, String(buildNumber), 'utf8');

  console.log('Building obsidian-img_upload-plugin');
  console.log(`   Version: v${version}`);
  console.log(`   Build #: ${buildNumber}`);
  console.log('');

  await writeBuildInfo(buildInfoPath, version, buildNumber, buildTime);

  console.log('Running esbuild...');
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'main.ts')],
    bundle: true,
    outfile: path.join(__dirname, '..', 'main.js'),
    platform: 'browser',
    format: 'cjs',
    external: ['obsidian'],
  });

  console.log('');
  console.log('Build complete!');
  console.log('   Output: main.js');
  console.log(`   Info: ${path.relative(process.cwd(), buildInfoPath)}`);
  console.log('');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
