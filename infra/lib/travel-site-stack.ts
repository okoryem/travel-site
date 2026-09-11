import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { join } from "node:path";

/* Egress thresholds, in GB per hour.
 *
 * CloudFront's free tier is 1TB/month — about 1.4 GB/hour if spread evenly, and
 * normal traffic here is far below that. WARN is set where something unusual is
 * clearly happening; KILL where sustained traffic would cost real money.
 *
 * KILL requires two consecutive breaching hours on purpose: a single spike from
 * being linked somewhere is not worth taking the site down for. */
const WARN_GB_PER_HOUR = 5;   // ~3.6 TB/month sustained (~$220)
const KILL_GB_PER_HOUR = 25;  // ~18 TB/month sustained (~$1,500)
const GB = 1024 ** 3;

/**
 * Static travel site: two private S3 buckets behind one CloudFront
 * distribution. Neither bucket is public — CloudFront reaches them via Origin
 * Access Control, so the only way to the objects is through the CDN.
 *
 * See docs/ARCHITECTURE.md.
 */
export class TravelSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---- Buckets -----------------------------------------------------------

    // The Next.js static export (out/). Small, text-heavy, replaced every deploy.
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Site assets are rebuilt from source on every deploy, so they are safe
      // to destroy with the stack.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Graded video and poster frames. Uploaded out-of-band, NOT rebuilt from
    // source — hence RETAIN. Deleting this stack must never delete the media.
    const mediaBucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: true,
    });

    // ---- URL rewriting -----------------------------------------------------

    // CloudFront only applies its default root object at the root, so a request
    // for /clips/hanoi/ would 404 against S3 rather than resolving the folder's
    // index.html. This rewrites directory-style paths to the real object key.
    // It is the standard gotcha when pairing `trailingSlash: true` with S3.
    const rewriteToIndex = new cloudfront.Function(this, "RewriteToIndex", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}
      `),
    });

    // ---- Distribution ------------------------------------------------------

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "travel-site",
      defaultRootObject: "index.html",

      // PRICE_CLASS_100 is North America + Europe only — the cheapest tier.
      // Widen to ALL if the audience turns out to be genuinely global.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,

      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: rewriteToIndex,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },

      additionalBehaviors: {
        // Video and posters. No URL rewriting here — these are real object keys.
        "/media/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },

      // Next.js emits 404.html; map S3's 403-on-missing-key onto it.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: "/404.html" },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: "/404.html" },
      ],
    });

    // ---- CI deploy role ----------------------------------------------------
    /* GitHub Actions authenticates by OIDC rather than a stored access key.
       GitHub presents a signed token asserting which repo and ref is running;
       AWS trusts that and issues credentials for the life of the job. There is
       no secret to leak, which is the same principle as the SSO login used
       locally — applied to the last place still doing it by hand. */

    const githubRepo = this.node.tryGetContext("githubRepo") ?? "okoryem/travel-site";

    const githubOidc = new iam.OpenIdConnectProvider(this, "GitHubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const deployRole = new iam.Role(this, "GitHubDeployRole", {
      roleName: "travel-site-github-deploy",
      description: "Assumed by GitHub Actions to deploy the static site",
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(
        githubOidc.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            /* Scoped to one branch of one repository. A fork, a pull request
               from a fork, or any other repo cannot assume this role even
               though they all present tokens from the same issuer. */
            "token.actions.githubusercontent.com:sub": `repo:${githubRepo}:ref:refs/heads/main`,
          },
        },
      ),
    });

    // Exactly what `npm run deploy` needs, and nothing else.
    siteBucket.grantReadWrite(deployRole);
    siteBucket.grantDelete(deployRole); // `s3 sync --delete` prunes removed files
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        // deploy.sh reads bucket, distribution and API URL from stack outputs.
        actions: ["cloudformation:DescribeStacks"],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/TravelSiteStack/*`,
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/TravelSiteApiStack/*`,
        ],
      }),
    );

    new cdk.CfnOutput(this, "GitHubDeployRoleArn", { value: deployRole.roleArn });

    // ---- Cost guard --------------------------------------------------------
    /* AWS has no hard spending cap, and Budgets alert on billing data that lags
       by hours. CloudFront publishes usage metrics within minutes, so alarming
       on bytes rather than dollars is both faster and actionable. */

    const alerts = new sns.Topic(this, "CostAlerts", {
      displayName: "travel-site cost alerts",
    });

    /* Email comes from CDK context rather than source, so a personal address
       never lands in a public repo:
         npx cdk deploy -c alertEmail=you@example.com */
    const alertEmail = this.node.tryGetContext("alertEmail");
    if (alertEmail) {
      alerts.addSubscription(new subs.EmailSubscription(alertEmail));
    }

    const egressPerHour = new cloudwatch.Metric({
      namespace: "AWS/CloudFront",
      metricName: "BytesDownloaded",
      // CloudFront reports globally and only into us-east-1.
      dimensionsMap: { DistributionId: distribution.distributionId, Region: "Global" },
      statistic: "Sum",
      period: cdk.Duration.hours(1),
    });

    // Warning: notify only. Something is happening, look at it.
    egressPerHour
      .createAlarm(this, "EgressWarning", {
        alarmName: "travel-site-egress-warning",
        alarmDescription: `CloudFront served more than ${WARN_GB_PER_HOUR}GB in an hour.`,
        threshold: WARN_GB_PER_HOUR * GB,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        // No traffic reports no datapoints; that is not a breach.
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      })
      .addAlarmAction(new actions.SnsAction(alerts));

    // Kill: disable the distribution. Two hours sustained, not one spike.
    const killTopic = new sns.Topic(this, "EgressKillTopic", {
      displayName: "travel-site egress kill switch",
    });

    const killSwitch = new NodejsFunction(this, "EgressKillSwitch", {
      entry: join(__dirname, "../lambda/killswitch/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DISTRIBUTION_ID: distribution.distributionId,
        NOTIFY_TOPIC_ARN: alerts.topicArn,
      },
      bundling: { minify: true, externalModules: ["@aws-sdk/*"] },
      logGroup: new logs.LogGroup(this, "EgressKillSwitchLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    /* CloudFront is a global service, so its ARNs are not region-scoped and
       cannot be narrowed to this distribution in the resource field. Scoped as
       tightly as the service allows. */
    killSwitch.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );
    alerts.grantPublish(killSwitch);
    killTopic.addSubscription(new subs.LambdaSubscription(killSwitch));

    egressPerHour
      .createAlarm(this, "EgressKill", {
        alarmName: "travel-site-egress-kill",
        alarmDescription:
          `CloudFront served more than ${KILL_GB_PER_HOUR}GB/hour for two hours. ` +
          `Distribution will be disabled.`,
        threshold: KILL_GB_PER_HOUR * GB,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      })
      .addAlarmAction(new actions.SnsAction(killTopic));

    new cdk.CfnOutput(this, "CostAlertsTopic", { value: alerts.topicArn });

    // ---- Outputs -----------------------------------------------------------

    new cdk.CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, "MediaBucketName", { value: mediaBucket.bucketName });
    new cdk.CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
