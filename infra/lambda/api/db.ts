import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

/**
 * Postgres access for Lambda.
 *
 * Uses Neon's HTTP driver rather than node-postgres on purpose. Every warm
 * Lambda holding a TCP connection counts against Postgres's connection limit,
 * and a burst of cold starts exhausts it — the classic serverless/relational
 * failure. The HTTP driver opens no persistent connections at all.
 *
 * The connection string lives in SSM Parameter Store as a SecureString rather
 * than a Lambda environment variable: env vars are visible to anyone with
 * console read access and end up in CloudFormation. Standard parameters are
 * also free, unlike Secrets Manager.
 */

let cached: NeonQueryFunction<false, false> | undefined;

export async function sql(): Promise<NeonQueryFunction<false, false>> {
  // Module scope survives between invocations on a warm Lambda, so the SSM
  // lookup happens once per container rather than once per request.
  if (cached) return cached;

  const name = process.env.DATABASE_URL_PARAM;
  if (!name) throw new Error("DATABASE_URL_PARAM is not set");

  const ssm = new SSMClient({});
  const result = await ssm.send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );
  const url = result.Parameter?.Value;
  if (!url) throw new Error(`SSM parameter ${name} is empty`);

  cached = neon(url);
  return cached;
}
