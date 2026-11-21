#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Entry point of every command hook:  node run.js <hook name>
//
// This is the one plain-JavaScript file of the plugin, and it holds no logic.
// Node removes the types of each TypeScript module every time it starts, which
// more than doubled the time of a hook (about 95 ms against 42 ms, measured).
// With Node's compile cache that work is done once and reused, but the cache
// has to be switched on before the TypeScript modules are loaded, and from a
// file that needs no type removal itself. Hence this launcher and the dynamic
// import below.
import { enableCompileCache } from 'node:module';

enableCompileCache();

const { runNamedHook } = await import('../lib/hooks.ts');
await runNamedHook(process.argv[2]);
