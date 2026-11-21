// cmc — test setup, loaded before every test file (package.json "test"). Author: Peterson Sena (r3v3rs3).
// Subagents' sessions close as soon as they answer, as before keep-open
// existed: tests that wait for an agent to finish would otherwise wait for
// the keep-open time. Tests of keep-open set it themselves.
process.env.CMC_KEEP_OPEN_MS ??= '0';
