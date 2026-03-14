const express = require("express");
const axios = require("axios");
const { OpenAI } = require("openai");

const app = express();
app.use(express.json());

// 初始化 OpenAI 客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 飞书应用配置（从飞书开放平台获取）
const FEISHU_CONFIG = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
};

// 1. 飞书事件接收接口
// 若始终没有 [feishu] 收到请求 日志：说明请求没打到本服务，请检查 ① 事件配置请求地址是否为 https://xxb.dokichat.club/feishu/webhook ② 公网转发是否指向运行本文件的进程（如 pm2 feishu）
app.post("/feishu/webhook", async (req, res) => {
  const eventType = req.body?.header?.event_type ?? req.body?.event?.type ?? req.body?.type ?? "(无)";
  console.log("[feishu] 收到请求 event_type/type:", eventType);

  const { header, event } = req.body;

  // 飞书 URL 验证（首次配置必须）
  const isUrlVerification =
    req.body?.type === "url_verification" ||
    header?.event_type === "url_verification";
  const challenge = req.body?.challenge;
  if (isUrlVerification && challenge != null) {
    return res.json({ challenge });
  }

  // 消息事件：兼容两种推送格式
  // 格式A: { header: { event_type: "im.message.receive_v1" }, event: { message } }
  // 格式B: { type: "event_callback", event: { type: "im.message.receive_v1", message } }
  const msgEventType = header?.event_type ?? req.body?.event?.type;
  const isMessageEvent =
    msgEventType === "im.message.receive_v1" ||
    msgEventType === "im.message.receive_v2";
  if (!isMessageEvent) {
    console.log("[feishu] 非消息事件，已忽略:", msgEventType);
    return res.status(200).json({});
  }

  console.log("[feishu] 收到消息事件:", JSON.stringify(req.body, null, 2));

  const eventBody = req.body?.event;
  const message = eventBody?.message;
  if (!message) {
    console.warn("[feishu] 无 event.message，跳过");
    return res.status(200).json({});
  }

  const { message_id, content, mentions, chat_type } = message;
  let userInput = "";
  try {
    userInput = typeof content === "string" ? JSON.parse(content).text : content?.text ?? "";
  } catch (e) {
    console.warn("[feishu] 解析 content 失败:", content);
    return res.status(200).json({});
  }

  // 单聊（p2p）：每条消息都回复；群聊：仅在被 @「小书包」时回复
  const isP2p = chat_type === "p2p";
  const isMentioned = mentions?.some((m) => m.name && m.name.includes("小书包"));
  if (!isP2p && !isMentioned) {
    return res.status(200).json({});
  }

  try {
    // 先随便回复一句话
    const reply = "你好呀，我是小书包～有啥想问的？";

    // 调用飞书 API 回复消息
    await sendFeishuReply(message_id, reply);
    res.status(200).json({});
  } catch (error) {
    console.error("处理失败:", error);
    res.status(500).json({ error: "internal error" });
  }
});

// 飞书「回复消息」接口（群聊/单聊都用此接口，不能把 message_id 当 receive_id 发新消息）
async function sendFeishuReply(messageId, text) {
  const tokenRes = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    { app_id: FEISHU_CONFIG.appId, app_secret: FEISHU_CONFIG.appSecret },
  );
  const accessToken = tokenRes.data.tenant_access_token;

  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`;
  try {
    const res = await axios.post(
      url,
      {
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log("[feishu] 回复成功:", res.data?.data?.message_id ?? res.data);
  } catch (err) {
    console.error("[feishu] 回复失败:", err.response?.data ?? err.message);
    throw err;
  }
}

// 启动服务
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`小书包机器人服务运行在 http://localhost:${PORT}`);
});
