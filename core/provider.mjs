import { fail } from "./errors.mjs";

const PROVIDERS = new Map();

export function registerProvider(provider) {
  if (!provider || typeof provider !== "object" || typeof provider.id !== "string") {
    fail("provider-invalid", "provider id is required");
  }
  if (PROVIDERS.has(provider.id)) fail("provider-duplicate", `provider already registered: ${provider.id}`);
  PROVIDERS.set(provider.id, provider);
  return provider;
}

export function getProvider(id) {
  const provider = PROVIDERS.get(id);
  if (!provider) fail("provider-unsupported", `provider ${id || "(missing)"} is not registered`, { provider: id || null });
  return provider;
}
