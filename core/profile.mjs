/** Profile/model loading is kept in contract.mjs; this module is the stable
 * public entry point used by CLI and downstream adapters. */
export {
  PROFILE_SCHEMA,
  MODEL_SCHEMA,
  HOSTS,
  TARGET_KINDS,
  SCOPES,
  SUPPORT_LEVELS,
  ACTIVATION_EVIDENCE,
  ACTIVATION_RESTART,
  TARGET_CONFLICTS,
  PLATFORM_OS,
  validateProfile,
  normalizeProfile,
  validateModel,
  loadProfile,
  loadModel,
  listProfiles,
  listModels,
  profilesDir,
  modelsDir,
} from "./contract.mjs";
