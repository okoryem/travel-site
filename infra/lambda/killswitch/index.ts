import type { SNSEvent } from "aws-lambda";
import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
} from "@aws-sdk/client-cloudfront";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

/**
 * Disables the CloudFront distribution when egress runs away.
 *
 * AWS has no hard spending cap, and Budgets only email — hours late, because
 * billing data lags. Watching the usage metric instead of the bill cuts that to
 * minutes, and this turns the alarm into an action rather than a notification.
 *
 * Deliberately blunt: it takes the site offline. That is the correct response to
 * runaway egress, and re-enabling is a single console toggle.
 */

const cf = new CloudFrontClient({});
const sns = new SNSClient({});

export const handler = async (event: SNSEvent) => {
  const distributionId = process.env.DISTRIBUTION_ID;
  const notifyTopic = process.env.NOTIFY_TOPIC_ARN;
  if (!distributionId) throw new Error("DISTRIBUTION_ID is not set");

  const trigger = event.Records?.[0]?.Sns?.Subject ?? "egress alarm";

  const current = await cf.send(
    new GetDistributionConfigCommand({ Id: distributionId }),
  );
  if (!current.DistributionConfig || !current.ETag) {
    throw new Error(`could not read config for distribution ${distributionId}`);
  }

  // Already off — an alarm re-firing shouldn't error or re-notify.
  if (!current.DistributionConfig.Enabled) {
    console.log("distribution already disabled; nothing to do");
    return { disabled: false, reason: "already disabled" };
  }

  await cf.send(
    new UpdateDistributionCommand({
      Id: distributionId,
      IfMatch: current.ETag, // optimistic concurrency: fails if changed meanwhile
      DistributionConfig: { ...current.DistributionConfig, Enabled: false },
    }),
  );

  console.warn(`DISABLED distribution ${distributionId} after: ${trigger}`);

  if (notifyTopic) {
    await sns.send(
      new PublishCommand({
        TopicArn: notifyTopic,
        Subject: "Travel site DISABLED — egress kill switch fired",
        Message:
          `CloudFront distribution ${distributionId} has been disabled ` +
          `automatically because egress exceeded the kill threshold.\n\n` +
          `Trigger: ${trigger}\n\n` +
          `The site is now offline. To restore it:\n` +
          `  aws cloudfront get-distribution-config --id ${distributionId}\n` +
          `  ...set Enabled to true, then update-distribution\n\n` +
          `Or toggle Enabled in the CloudFront console. Propagation takes a few ` +
          `minutes.\n\nInvestigate what caused the traffic before re-enabling.`,
      }),
    );
  }

  return { disabled: true, distributionId };
};
