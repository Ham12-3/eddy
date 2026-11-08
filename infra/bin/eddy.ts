// CDK entry point. `pnpm --filter @eddy/infra synth` only synthesises; nothing is deployed
// without explicit approval (ADR-0014).
import { App } from "aws-cdk-lib";
import { buildEddy } from "../lib/eddy";

const app = new App();
const stage = String(app.node.tryGetContext("eddy:stage") ?? "staging");
// Deliberately not CDK_DEFAULT_ACCOUNT: an account-agnostic synth makes no AWS lookups, so it is the
// same on every machine and in CI. Deploys (M10, with approval) pass -c eddy:account=<id>.
const account = app.node.tryGetContext("eddy:account") as string | undefined;

buildEddy(app, { stage, account });
