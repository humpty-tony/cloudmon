import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {createServer} from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  cacheDir: `${process.env.TMPDIR}/cloudmon-ar4-presentation-vite`,
  server: {middlewareMode: true}, appType: "custom",
  optimizeDeps: {noDiscovery: true, include: []},
});
try {
  const {eventMeaning, eventServiceLabel, presentEventActor} = await server.ssrLoadModule("/src/api/eventPresentation.ts");
  const event = {eventName: "GetSecretValue", eventSource: "secretsmanager.amazonaws.com"};
  assert.equal(eventMeaning({...event, errorCode: "AccessDenied"}).headline, "Secret read denied");
  assert.equal(eventMeaning(event).headline, "Secret read requested");
  assert.equal(eventMeaning(event).outcome, "No error recorded");
  assert.equal(eventMeaning({...event, errorCode: "InternalFailure"}).headline, "Secret read reported an error");
  assert.equal(eventMeaning({...event, errorMessage: "Recorded failure"}).outcome, "Error recorded");
  assert.equal(eventMeaning({...event, eventSource: "custom.example"}).headline, "GetSecretValue recorded");
  assert.equal(eventServiceLabel(event.eventSource), "Secrets Manager");
  assert.equal(eventServiceLabel("ec2.amazonaws.com.cn"), "EC2");
  assert.equal(eventServiceLabel("ec2.amazonaws.com.attacker.example"), "ec2.amazonaws.com.attacker.example");
  assert.equal(eventServiceLabel("constructor"), "constructor");
  const identity = {type: "AssumedRole", arn: "arn:aws:sts::111122223333:assumed-role/ProdDeploy/runner-04", accountId: "111122223333", principalId: "AROA:runner-04", userName: ""};
  assert.deepEqual(presentEventActor(identity), {name: "ProdDeploy", session: "runner-04", typeLabel: "Assumed role"});
  assert.equal(presentEventActor({...identity, arn: "unrecognized:literal/identity", roleArn: "", sessionName: ""}).name, "unrecognized:literal/identity");
  assert.equal(presentEventActor({...identity, type: "IAMUser", arn: "arn:aws:iam::111122223333:user/team/alex"}).name, "alex");
  assert.equal(presentEventActor({...identity, type: "AWSService", arn: "", principalId: "ec2.amazonaws.com"}).name, "ec2.amazonaws.com");
  console.log("Event presentation passed: recorded outcomes, exact service mapping, literal fallbacks, role/session labels; no success or human attribution inferred.");
} finally {
  await server.close();
}
