#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// UserPromptSubmit hook: holds the prompts that start with the hold prefix.
import { handlePrompt } from '../lib/capture.mjs';
import { runHook } from '../lib/hook-io.mjs';

runHook('prompt-capture', handlePrompt);
