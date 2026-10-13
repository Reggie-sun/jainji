import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { QianchuanUploadSelection, UploadAuthorization } from "../shared/douyin-upload.js";

const changed = () => new Error("网页子账户或本轮上传授权已变化，请刷新计划后重新开始制作。");
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Process-local binding of an explicit browser subaccount to the saved browser anchor. */
export class QianchuanSelectedAccountTargets {
  private readonly targets = new Map<string, { authorization: UploadAuthorization; configured: FrozenQianchuanAccount }>();
  clear(): void { this.targets.clear(); }
  remember(authorization: UploadAuthorization, configured: FrozenQianchuanAccount): void {
    if (this.targets.has(authorization.pageBatchId)) throw changed();
    this.targets.set(authorization.pageBatchId, structuredClone({ authorization, configured }));
  }
  browserAnchor(authorization: UploadAuthorization): FrozenQianchuanAccount | undefined {
    const binding = this.targets.get(authorization.pageBatchId);
    if (!binding) return undefined;
    if (!equal(binding.authorization, authorization)) throw changed();
    return Object.freeze(structuredClone(binding.configured));
  }
  resolve(authorization: UploadAuthorization, selection: QianchuanUploadSelection, configured: FrozenQianchuanAccount): FrozenQianchuanAccount | undefined {
    const binding = this.targets.get(authorization.pageBatchId);
    if (!binding) {
      if (selection.plan?.accountSource === "current-browser") throw changed();
      return undefined;
    }
    if (!equal(binding.authorization, authorization) || !equal(binding.configured, configured) ||
      selection.accountProduct !== configured.product || selection.plan?.accountSource !== "current-browser" ||
      selection.plan.advertiserId !== authorization.target.advertiserId || selection.plan.adId !== authorization.target.adId) throw changed();
    return Object.freeze(structuredClone(binding.authorization.target));
  }
}
export const qianchuanSelectedAccountTargets = new QianchuanSelectedAccountTargets();
