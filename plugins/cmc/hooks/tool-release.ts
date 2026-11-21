#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// PostToolUse hook: delivers a release armed from outside the session
// (`cmc release --now`) at the agent's next step.
import { runHook } from '../lib/hook-io.ts';
import { handlePostToolUse } from '../lib/release.ts';

runHook('tool-release', handlePostToolUse);
