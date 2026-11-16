export const ACTIVATION_STATES = ["missing", "installed", "configured", "active", "drifted", "unobservable", "blocked"];

function runtimeEvidence(evidence = []) {
  return evidence.some((item) => item && ["session", "runtime"].includes(item.kind));
}

export function normalizeActivation(raw = {}, { id = null } = {}) {
  const source = raw.activation && typeof raw.activation === "object" ? { ...raw, ...raw.activation } : raw;
  const evidence = Array.isArray(source.evidence) ? source.evidence : [];
  const warnings = Array.isArray(source.warnings) ? [...source.warnings] : [];
  let status = ACTIVATION_STATES.includes(source.status) ? source.status : null;
  if (!status) {
    if (source.ok === false) status = "missing";
    else if (id === "generic") status = "unobservable";
    else if (source.configured === true || source.ok === true) status = "configured";
    else status = "unknown";
  }
  if (status === "active" && !runtimeEvidence(evidence)) {
    warnings.push("active status requires session or runtime evidence");
    status = source.configured === false ? "unobservable" : "configured";
  }
  if (source.active === true && !runtimeEvidence(evidence)) {
    warnings.push("active flag ignored without session or runtime evidence");
  }
  return { status, evidence, warnings, runtimeObserved: runtimeEvidence(evidence) };
}

export function activationSummary({ configured = false, runtimeReady = false, sessionLoaded = false, evidence = [], warnings = [] } = {}) {
  const observed = runtimeEvidence(evidence) || sessionLoaded;
  const state = runtimeReady && observed ? "active" : configured ? "configured" : "inactive";
  return {
    state,
    configured: Boolean(configured),
    runtimeReady: Boolean(runtimeReady),
    sessionLoaded: Boolean(sessionLoaded),
    evidence,
    warnings,
    requiresRestart: Boolean(configured) && !(runtimeReady && observed),
  };
}
