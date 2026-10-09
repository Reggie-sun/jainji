import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("diagnostic CLI cannot navigate a protected account without the application egress guard", async () => {
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {openAccountPage} from './scripts/qianchuan-account-config.mjs';
    let invoked = false;
    await assert.rejects(openAccountPage({product:'蝴蝶贴',advertiserId:'123',adId:'456',cdpEndpoint:'http://127.0.0.1:9222',egress:{group:'one',sshHost:'shop-one',localPort:19381,expectedIp:'203.0.113.11'}}, async () => {invoked = true;}), /固定出口/);
    assert.equal(invoked, false);
    console.log('egress CLI guard PASS');
  `], { timeout: 10000 });
  expect(result.stdout).toContain("egress CLI guard PASS");
});
