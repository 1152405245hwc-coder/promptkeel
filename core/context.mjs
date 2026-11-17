/** Normalize CLI, compiler, and executor context without changing legacy defaults. */
export function normalizeContext(input = {}) {
  const nested = input.env && typeof input.env === "object" ? input.env : {};
  const pick = (key) => input[key] ?? nested[key];
  const home = input.home ?? process.env.HOME ?? process.env.USERPROFILE;
  return {
    hostId: input.hostId ?? input.host ?? null,
    profileId: input.profileId ?? null,
    projectRoot: input.projectRoot ?? process.cwd(),
    home,
    stateRoot: pick("stateRoot") ?? process.env.DSH_FORGE_STATE ?? undefined,
    hostRoot: pick("hostRoot") ?? process.env.DSH_FORGE_HOST_ROOT ?? undefined,
    dshHome: pick("dshHome") ?? (home ? `${home.replace(/[\\/]$/, "")}/.dsh` : undefined),
    mode: input.mode ?? null,
    persona: input.persona ?? pick("persona") ?? null,
    personaMode: input.personaMode ?? pick("personaMode") ?? null,
    transform: input.transform ?? pick("transform") ?? null,
    budget: input.budget ?? 3200,
    env: { ...nested, stateRoot: pick("stateRoot"), hostRoot: pick("hostRoot"), dshHome: pick("dshHome") },
  };
}
