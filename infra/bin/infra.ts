#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TravelSiteStack } from "../lib/travel-site-stack";
import { ApiStack } from "../lib/api-stack";

const app = new cdk.App();

new TravelSiteStack(app, "TravelSiteStack", {
  // Resolved from the credentials in use at deploy time, so the same code
  // deploys to whatever account/region is configured.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

/* Separate stack: the API and the static site have different failure modes and
   deploy cadences, and coupling them means a broken Lambda blocks a content
   deploy. */
new ApiStack(app, "TravelSiteApiStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
