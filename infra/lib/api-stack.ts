import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as logs from "aws-cdk-lib/aws-logs";
import { join } from "node:path";

/** Where the Neon connection string lives. Created out of band — see README. */
export const DB_URL_PARAM = "/travel-site/database-url";

/**
 * Read-only content API: HTTP API -> Lambda -> Postgres.
 *
 * Separate stack from the site so the two deploy independently — a bad API
 * change can't take the static site down with it.
 */
export class ApiStack extends cdk.Stack {
  readonly apiUrl: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /* Referenced, not created. The connection string is a credential and must
       never appear in this repo or in a CloudFormation template. It is written
       to Parameter Store once, by hand, and the Lambda reads it at runtime. */
    const dbUrl = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      "DbUrl",
      { parameterName: DB_URL_PARAM },
    );

    const fn = new NodejsFunction(this, "ApiFunction", {
      entry: join(__dirname, "../lambda/api/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64, // cheaper per ms than x86
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: {
        // The parameter *name*, never the value.
        DATABASE_URL_PARAM: DB_URL_PARAM,
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        /* Leave the AWS SDK to the runtime, which ships it. Bundling pins the
           version but costs ~700KB, and this API is called mostly at build time
           — so almost every request is a cold start, which is precisely when
           package size is paid for. GetParameter is a stable enough call that
           the runtime's copy is not a real risk. */
        externalModules: ["@aws-sdk/*"],
      },
      /* An explicit LogGroup rather than the deprecated logRetention prop, which
         provisions a custom-resource Lambda per function purely to call
         PutRetentionPolicy. A month is plenty and keeps CloudWatch at zero. */
      logGroup: new logs.LogGroup(this, "ApiFunctionLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Least privilege: this one parameter, decrypt only.
    dbUrl.grantRead(fn);

    const api = new apigw.HttpApi(this, "HttpApi", {
      apiName: "travel-site-api",
      description: "Read-only content API for the travel site",
      corsPreflight: {
        // Public read-only data, so any origin may read it.
        allowOrigins: ["*"],
        allowMethods: [apigw.CorsHttpMethod.GET],
        allowHeaders: ["content-type"],
        maxAge: cdk.Duration.days(1),
      },
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", fn);

    // Routes declared explicitly rather than a catch-all proxy: API Gateway
    // rejects anything unlisted before it reaches the Lambda, so unknown paths
    // cost nothing and never run code.
    for (const path of ["/clips", "/clips/{id}", "/countries", "/trips"]) {
      api.addRoutes({ path, methods: [apigw.HttpMethod.GET], integration });
    }

    this.apiUrl = api.apiEndpoint;

    new cdk.CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new cdk.CfnOutput(this, "ApiFunctionName", { value: fn.functionName });
  }
}
