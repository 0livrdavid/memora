// Legacy environment names remain accepted for existing launch configurations.
// New configurations should use MEMORA_*; explicit new values take precedence.
const legacyEnvironment = Object.freeze({
  MEMORA_ELECTRON: 'SONORA_ELECTRON',
  MEMORA_DATA: 'SONORA_DATA',
  MEMORA_SMOKE: 'SONORA_SMOKE',
  MEMORA_RECORD_TEST: 'SONORA_RECORD_TEST',
});
function environmentValue(name, env = process.env) {
  return env[name] ?? env[legacyEnvironment[name]];
}
module.exports = { environmentValue };
