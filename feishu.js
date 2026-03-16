import "dotenv/config";
import crypto from "crypto";
import express from "express";
import axios from "axios";
import { OpenAI } from "openai";

const app = express();
app.use(express.json());

// 初始化 OpenAI 客户端
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

const FEISHU_CONFIG = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
  encryptKey: process.env.FEISHU_ENCRYPT_KEY,
  botName: "小书包", // 明确机器人名称
};

function decryptFeishuBody(encryptBase64, encryptKey) {
  if (!encryptKey) throw new Error("未配置 FEISHU_ENCRYPT_KEY");
  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const buf = Buffer.from(encryptBase64, "base64");
  const iv = buf.subarray(0, 16);
  const ciphertext = buf.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

app.post("/feishu/webhook", async (req, res) => {
  let body = req.body || {};
  const raw = decryptFeishuBody(body.encrypt, FEISHU_CONFIG.encryptKey);
  body = JSON.parse(raw);
  console.log(body,header,'kkkk');
  const { header, event, challenge } = body;

  // body =  {
  //   0|feishu  |   schema: '2.0',
  //   0|feishu  |   header: {
  //   0|feishu  |     event_id: '3f80c9c774cf6a21bf7ab97ef84dc111',
  //   0|feishu  |     token: 'YXKk6bE44gVGphuPETsViuklSVhWnJZE',
  //   0|feishu  |     create_time: '1773675150355',
  //   0|feishu  |     event_type: 'im.message.receive_v1',
  //   0|feishu  |     tenant_key: '2ef845fabe8f1652',
  //   0|feishu  |     app_id: 'cli_a939426a23789cc6'
  //   0|feishu  |   },
  //   0|feishu  |   event: {
  //   0|feishu  |     message: {
  //   0|feishu  |       chat_id: 'oc_f97f903c40b649491d1981c434a225c9',
  //   0|feishu  |       chat_type: 'p2p',
  //   0|feishu  |       content: '{"text":"@_user_1 11"}',
  //   0|feishu  |       create_time: '1773675150060',
  //   0|feishu  |       mentions: [Array],
  //   0|feishu  |       message_id: 'om_x100b54b6661338a8b1076984f82de45',
  //   0|feishu  |       message_type: 'text',
  //   0|feishu  |       update_time: '1773675150060'
  //   0|feishu  |     },
  //   0|feishu  |     sender: {
  //   0|feishu  |       sender_id: [Object],
  //   0|feishu  |       sender_type: 'user',
  //   0|feishu  |       tenant_key: '2ef845fabe8f1652'
  //   0|feishu  |     }
  //   0|feishu  |   }
  //   0|feishu  | } kkkk

  const isUrlVerification =
    body?.type === "url_verification" ||
    header?.event_type === "url_verification";
  if (isUrlVerification && challenge != null) {
    return res.json({ challenge });
  }

  // 2. 只处理消息事件
  const msgEventType = header?.event_type;
  if (msgEventType !== "im.message.receive_v1") {
    return res.status(200).json({ status: "ignored" });
  }

  // 3. 解析消息核心数据
  const message = event?.message;
  if (!message) {
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

