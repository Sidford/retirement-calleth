import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as path from "path";

export interface RetirementCountdownStackProps extends cdk.StackProps {
  /** ISO date (YYYY-MM-DD) of the last working day */
  retirementDate: string;
  /** SES-verified sender address */
  senderEmail: string;
  /** Recipient address (also needs SES verification if account is in sandbox) */
  recipientEmail: string;
  /** Bedrock model id used to generate the daily joke */
  bedrockModelId: string;
  /** ISO date (YYYY-MM-DD) the countdown started, for the progress bar */
  countdownStartDate: string;
  /** ISO date (YYYY-MM-DD) of any known non-working Friday, to anchor the fortnightly on/off pattern */
  nonWorkingFridayAnchor: string;
}

export class RetirementCountdownStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RetirementCountdownStackProps) {
    super(scope, id, props);

    // Stores recent jokes so Bedrock can be told what to avoid repeating
    const jokeHistoryTable = new dynamodb.Table(this, "JokeHistoryTable", {
      partitionKey: { name: "date", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const holidaysTable = new dynamodb.Table(this, "BookedHolidaysTable", {
      partitionKey: { name: "type", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "date", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const countdownFn = new lambda.NodejsFunction(this, "CountdownFunction", {
      entry: path.join(__dirname, "../lambda/handler.ts"),
      handler: "handler",
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        RETIREMENT_DATE: props.retirementDate,
        SENDER_EMAIL: props.senderEmail,
        RECIPIENT_EMAIL: props.recipientEmail,
        BEDROCK_MODEL_ID: props.bedrockModelId,
        COUNTDOWN_START_DATE: props.countdownStartDate,
        NON_WORKING_FRIDAY_ANCHOR: props.nonWorkingFridayAnchor,
        TABLE_NAME: jokeHistoryTable.tableName,
        HOLIDAYS_TABLE_NAME: holidaysTable.tableName,
      },
    });

    jokeHistoryTable.grantReadWriteData(countdownFn);
    holidaysTable.grantReadData(countdownFn);

    // A cross-region inference profile id is prefixed with its geo scope
    // (e.g. "eu."/"us."/"apac."/"global."). Invoking through a profile requires
    // InvokeModel on the profile ARN AND on the underlying foundation model in
    // every region the profile can route to, so wildcard the region and strip
    // the prefix to get the base foundation-model id.
    const isInferenceProfile = /^(eu|us|apac|global)\./.test(props.bedrockModelId);
    const bedrockResources = isInferenceProfile
      ? [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${props.bedrockModelId}`,
          `arn:aws:bedrock:*::foundation-model/${props.bedrockModelId.replace(/^(eu|us|apac|global)\./, "")}`,
        ]
      : [`arn:aws:bedrock:${this.region}::foundation-model/${props.bedrockModelId}`];

    countdownFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: bedrockResources,
      })
    );

    // Grant SendEmail on both the sender and recipient identities. While the
    // account is in the SES sandbox, SES authorizes SendEmail against the
    // recipient identity too, not just the sender — so both must be listed.
    const sesIdentities = Array.from(
      new Set([props.senderEmail, props.recipientEmail])
    ).map(
      (email) => `arn:aws:ses:${this.region}:${this.account}:identity/${email}`
    );

    countdownFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: sesIdentities,
      })
    );

    // Daily trigger — 06:00 UTC. Adjust manually across BST/GMT if exact
    // local time matters year-round; EventBridge cron does not shift for DST.
    const rule = new events.Rule(this, "DailyScheduleRule", {
      schedule: events.Schedule.cron({ minute: "0", hour: "6" }),
    });
    rule.addTarget(new targets.LambdaFunction(countdownFn));

    // Ops alerting — separate from the joke email, tells you if the pipe breaks
    const alertTopic = new sns.Topic(this, "OpsAlertTopic");
    alertTopic.addSubscription(
      new subscriptions.EmailSubscription(props.recipientEmail)
    );

    const errorAlarm = new cloudwatch.Alarm(this, "FunctionErrorAlarm", {
      metric: countdownFn.metricErrors({ period: Duration.days(1) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    errorAlarm.addAlarmAction(new cwActions.SnsAction(alertTopic));

    new cdk.CfnOutput(this, "CountdownFunctionName", {
      value: countdownFn.functionName,
    });

    // Needed by bin/manage-holidays.ts, which runs outside the Lambda and so
    // doesn't get HOLIDAYS_TABLE_NAME injected via the environment block above.
    new cdk.CfnOutput(this, "BookedHolidaysTableName", {
      value: holidaysTable.tableName,
    });
  }
}
