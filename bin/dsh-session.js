#!/usr/bin/env node
import { sessionMain } from "../scripts/session.mjs";

sessionMain(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${error && error.code ? `[${error.code}] ` : ""}${error?.message || error}\n`);
    process.exit(1);
  });
