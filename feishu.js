import "dotenv/config";
import express from "express";
import axios from "axios";
import { OpenAI } from "openai";

const app = express();
app.use(express.json());

// 初始化 OpenAI 客户端
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// 飞书应用配置
const FEISHU_CONFIG = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
  botName: "小书包", // 明确机器人名称
};

// ========== 新增：全局日志，排查请求是否到达 ==========
app.use((req, res, next) => {
  console.log(`\n[${new Date().toLocaleString()}] ${req.method} ${req.path}`);
  console.log("请求体:", JSON.stringify(req.body, null, 2));
  next();
});

app.post("/feishu/webhook", async (req, res) => {
  const { header, event, challenge } = req.body;

  // 1. 飞书 URL 验证（必须通过）
  const isUrlVerification =
    req.body?.type === "url_verification" ||
    header?.event_type === "url_verification";
  if (isUrlVerification && challenge != null) {
    console.log("✅ 飞书验证请求，返回 challenge:", challenge);
    return res.json({ challenge });
  }

  // 2. 只处理消息事件
  const msgEventType = header?.event_type;
  if (msgEventType !== "im.message.receive_v1") {
    console.log("ℹ️ 非消息事件，忽略:", msgEventType);
    return res.status(200).json({ status: "ignored" });
  }

  // 3. 解析消息核心数据
  const message = event?.message;
  if (!message) {
    console.log("⚠️ 无 message 字段");
    return res.status(200).json({ status: "no_message" });
  }

  const { message_id, content, mentions, chat_type, sender } = message;
  let userInput = "";
  try {
    // 解析消息文本
    const contentObj =
      typeof content === "string" ? JSON.parse(content) : content;
    userInput = contentObj.text || "";
    // 剔除 @小书包 标记
    userInput = userInput
      .replace(new RegExp(`@${FEISHU_CONFIG.botName}`, "g"), "")
      .trim();
  } catch (e) {
    console.error("❌ 解析消息失败:", e);
    return res.status(200).json({ status: "parse_error" });
  }

  // 4. 判断是否需要回复
  const isP2p = chat_type === "p2p";
  const isMentioned = mentions?.some((m) => m.name === FEISHU_CONFIG.botName);
  if (!isP2p && !isMentioned) {
    console.log("ℹ️ 群聊未@机器人，忽略");
    return res.status(200).json({ status: "not_mentioned" });
  }

  // 5. 回复消息
  try {
    const reply = `👋 你@我并说：「${userInput || "空内容"}」\n我是小书包，随时为你服务～`;
    await sendFeishuReply(message_id, reply);
    console.log("✅ 回复成功，用户输入:", userInput);
    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("❌ 处理失败:", error);
    res.status(200).json({ status: "error" }); // 必须返回200，避免飞书重试
  }
});

// 飞书回复消息函数
async function sendFeishuReply(messageId, text) {
  // 1. 获取 tenant_access_token
  const tokenRes = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    { app_id: FEISHU_CONFIG.appId, app_secret: FEISHU_CONFIG.appSecret },
  );
  const accessToken = tokenRes.data.tenant_access_token;
  if (!accessToken) throw new Error("获取 access_token 失败");

  // 2. 调用回复接口
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`;
  const res = await axios.post(
    url,
    {
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    },
  );
  return res.data;
}

// ========== 修复：监听 0.0.0.0，允许公网访问 ==========
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 小书包服务运行在 http://0.0.0.0:${PORT}`);
  console.log(`📎 Webhook 地址: https://xxb.dokichat.club/feishu/webhook`);
});
