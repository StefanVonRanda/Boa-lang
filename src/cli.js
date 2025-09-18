#!/usr/bin/env bun

import { watch as fsWatch } from 'fs';
import { resolve } from 'path';
import { compile } from './compiler.js';

async function readInput(path) {
  if (!path || path === '-') {
    return Bun.stdin.text();
  }

  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Input file not found: ${path}`);
  }
  return file.text();
}

async function writeOutput(css, path) {
  if (!path || path === '-') {
    await Bun.write(Bun.stdout, css);
    return;
  }

  await Bun.write(path, css);
}

async function compileOnce(inputPath, outputPath, options) {
  const source = await readInput(inputPath);
  const css = compile(source, options);
  await writeOutput(css, outputPath);
}

async function runWatch(inputPath, outputPath, options) {
  const absInput = inputPath && inputPath !== '-' ? resolve(process.cwd(), inputPath) : null;
  if (!absInput) {
    throw new Error('Watch mode requires a real input file path.');
  }

  const initial = await readInput(inputPath);
  let previous = initial;
  try {
    const css = compile(initial, options);
    await writeOutput(css, outputPath);
    console.log(`[boa] compiled ${inputPath}${options.minify ? ' (minified)' : ''}`);
  } catch (error) {
    reportError(error, 'initial compile');
  }

  let timer = null;
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(async () => {
      timer = null;
      try {
        const next = await readInput(inputPath);
        if (next === previous) {
          return;
        }
        const css = compile(next, options);
        await writeOutput(css, outputPath);
        previous = next;
        console.log(`[boa] compiled ${inputPath}${options.minify ? ' (minified)' : ''}`);
      } catch (error) {
        reportError(error, 'watch');
      }
    }, 30);
  };

  const watcher = fsWatch(absInput, { persistent: true }, (eventType) => {
    if (eventType !== 'change' && eventType !== 'rename') {
      return;
    }
    schedule();
  });

  const shutdown = () => {
    watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[boa] watching ${inputPath}… (Ctrl+C to exit)`);
  await new Promise(() => {});
}

function reportError(error, phase) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[boa] ${phase} failed: ${message}`);
}

async function main() {
  const [, , ...args] = Bun.argv;
  let minify = false;
  let hoverGuard = true;
  let watch = false;
  const paths = [];

  for (const arg of args) {
    if (arg === '-m' || arg === '--minify') {
      minify = true;
      continue;
    }
    if (arg === '--no-hover-guard') {
      hoverGuard = false;
      continue;
    }
    if (arg === '-w' || arg === '--watch') {
      watch = true;
      continue;
    }
    paths.push(arg);
  }

  const [inputArg, outputArg] = paths;

  try {
    const options = { minify, hoverGuard };
    if (watch) {
      await runWatch(inputArg, outputArg, options);
    } else {
      await compileOnce(inputArg, outputArg, options);
    }
  } catch (error) {
    reportError(error, 'run');
    process.exit(1);
  }
}

main();
