import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

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

    // ---- Outputs -----------------------------------------------------------

    new cdk.CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, "MediaBucketName", { value: mediaBucket.bucketName });
    new cdk.CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
