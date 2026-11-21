#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// SessionStart and SessionEnd hook: keeps the registry the command line uses
// to find the session running in a folder.
import { runHook } from '../lib/hook-io.ts';
import { handleSessionEnd, handleSessionStart } from '../lib/sessions.ts';

runHook('session-register', (input, context) =>
  input.hook_event_name === 'SessionEnd' ? handleSessionEnd(input, context) : handleSessionStart(input, context),
);
