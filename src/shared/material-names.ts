import { z } from "zod";

export const MaterialNameSchema = z.string().trim().min(1, "请填写名称。").max(120, "名称不能超过 120 个字符。");
