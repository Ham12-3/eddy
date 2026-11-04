import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { EDDY_REGION, buildEddy } from "../lib/eddy";

const stacks = buildEddy(new App(), { stage: "test" });
const data = Template.fromStack(stacks.data);
const network = Template.fromStack(stacks.network);

describe("Eddy infrastructure", () => {
  it("keeps every stack in London (eu-west-2)", () => {
    for (const stack of Object.values(stacks)) {
      expect(stack.region).toBe(EDDY_REGION);
    }
  });

  it("encrypts and protects the database, with no public access", () => {
    data.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      StorageEncrypted: true,
      DeletionProtection: true,
      PubliclyAccessible: false,
    });
  });

  it("blocks all public access to the asset bucket", () => {
    data.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("expires old object versions so deletions complete within 30 days", () => {
    data.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ NoncurrentVersionExpiration: { NoncurrentDays: 30 } }),
        ]),
      },
    });
  });

  it("strips the default security group's rules", () => {
    network.resourceCountIs("Custom::VpcRestrictDefaultSG", 1);
  });

  it("encrypts every queue and gives job queues a dead-letter queue", () => {
    data.resourceCountIs("AWS::SQS::Queue", 4);
    data.allResourcesProperties("AWS::SQS::Queue", { SqsManagedSseEnabled: true });
    data.resourcePropertiesCountIs(
      "AWS::SQS::Queue",
      { RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }) },
      2,
    );
  });
});
