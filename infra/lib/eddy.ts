/**
 * Eddy's AWS skeleton (SPEC.md section 5). All personal data stays in eu-west-2 (London).
 * M0 defines the shape; services, Redis, SES and CloudFront are filled in by M10.
 */
import { Duration, RemovalPolicy, Stack, Tags, type App, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

export const EDDY_REGION = "eu-west-2";

export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC },
        { name: "services", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });
  }
}

interface WithVpc extends StackProps {
  vpc: ec2.IVpc;
}

export class DataStack extends Stack {
  readonly database: rds.DatabaseInstance;
  readonly assets: s3.Bucket;
  readonly queues: Record<"tts" | "sceneCheck", sqs.Queue>;

  constructor(scope: Construct, id: string, props: WithVpc) {
    super(scope, id, props);

    this.database = new rds.DatabaseInstance(this, "Postgres", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromGeneratedSecret("eddy"),
      databaseName: "eddy",
      storageEncrypted: true,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      publiclyAccessible: false,
    });

    this.assets = new s3.Bucket(this, "Assets", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      // Deleted objects must really go within the 30-day deletion window (SPEC.md section 6.7).
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(30),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const queue = (name: string) => {
      const deadLetters = new sqs.Queue(this, `${name}DeadLetters`, {
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        enforceSSL: true,
        retentionPeriod: Duration.days(14),
      });
      return new sqs.Queue(this, name, {
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        enforceSSL: true,
        visibilityTimeout: Duration.minutes(5),
        deadLetterQueue: { queue: deadLetters, maxReceiveCount: 3 },
      });
    };
    this.queues = { tts: queue("TtsJobs"), sceneCheck: queue("SceneCheckJobs") };
  }
}

export class ServicesStack extends Stack {
  readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: WithVpc) {
    super(scope, id, props);
    this.cluster = new ecs.Cluster(this, "Cluster", { vpc: props.vpc });
  }
}

export interface EddyOptions {
  stage: string;
  account?: string | undefined;
}

export function buildEddy(app: App, { stage, account }: EddyOptions) {
  const env = { region: EDDY_REGION, ...(account ? { account } : {}) };
  const prefix = `Eddy-${stage}`;

  const network = new NetworkStack(app, `${prefix}-Network`, { env });
  const data = new DataStack(app, `${prefix}-Data`, { env, vpc: network.vpc });
  const services = new ServicesStack(app, `${prefix}-Services`, { env, vpc: network.vpc });

  for (const stack of [network, data, services]) {
    Tags.of(stack).add("Project", "eddy");
    Tags.of(stack).add("Stage", stage);
  }
  return { network, data, services };
}
