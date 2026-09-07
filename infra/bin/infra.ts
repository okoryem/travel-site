#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TravelSiteStack } from "../lib/travel-site-stack";

const app = new cdk.App();

new TravelSiteStack(app, "TravelSiteStack", {
  // Resolved from the credentials in use at deploy time, so the same code
  // deploys to whatever account/region is configured.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
