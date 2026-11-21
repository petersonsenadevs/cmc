#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Stop hook: delivers the held messages at the end of the turn when asked to.
import { runHook } from '../lib/hook-io.ts';
import { handleStop } from '../lib/release.ts';

runHook('stop-release', handleStop);
