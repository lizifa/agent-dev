import "dotenv/config";
import crypto from "crypto";
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const FEISHU_REPLY_URL = "https://open.feishu.cn/open-apis/im/v1/messages";

const FEISHU_CONFIG = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
  encryptKey: process.env.FEISHU_ENCRYPT_KEY,
  botName: "小书包",
};

function decryptFeishuBody(encryptBase64, encryptKey) {
  if (!encryptKey) throw new Error("未配置 FEISHU_ENCRYPT_KEY");
  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const buf = Buffer.from(encryptBase64, "base64");
  const iv = buf.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([
    decipher.update(buf.subarray(16)),
    decipher.final(),
  ]).toString("utf8");
}

/** 若请求体为加密格式则解密并返回解析后的 body，否则返回原 body */
function parseWebhookBody(body) {
  const raw = body || {};
  const isEncrypted =
    raw.encrypt != null &&
    typeof raw.encrypt === "string" &&
    raw.type == null &&
    raw.challenge == null;
  if (!isEncrypted) return raw;
  if (!FEISHU_CONFIG.encryptKey) {
    console.error("❌ 请求已加密，请配置 FEISHU_ENCRYPT_KEY");
    return null;
  }
  try {
    return JSON.parse(decryptFeishuBody(raw.encrypt, FEISHU_CONFIG.encryptKey));
  } catch (e) {
    console.error("❌ 解密失败:", e.message);
    return null;
  }
}

app.post("/feishu/webhook", async (req, res) => {
  const body = parseWebhookBody(req.body);
  if (!body) return res.status(200).json({});

  const { header, event, challenge } = body;
  const isUrlVerification =
    body.type === "url_verification" || header?.event_type === "url_verification";
  if (isUrlVerification && challenge != null) {
    return res.json({ challenge });
  }

  if (header?.event_type !== "im.message.receive_v1") {
    return res.status(200).json({ status: "ignored" });
  }

  const message = event?.message;
  if (!message) return res.status(200).json({ status: "no_message" });

  const { message_id, content, mentions, chat_type } = message;
  let userInput;
  try {
    const contentObj = typeof content === "string" ? JSON.parse(content) : content;
    userInput = (contentObj?.text || "")
      .replace(new RegExp(`@${FEISHU_CONFIG.botName}`, "g"), "")
      .trim();
  } catch {
    return res.status(200).json({ status: "parse_error" });
  }

  const isP2p = chat_type === "p2p";
  const isMentioned = mentions?.some((m) => m.name === FEISHU_CONFIG.botName);
  if (!isP2p && !isMentioned) {
    return res.status(200).json({ status: "not_mentioned" });
  }

  try {
    const reply = `👋 你@我并说：「${userInput || "空内容"}」\n我是小书包，随时为你服务～`;
    await sendFeishuReply(message_id, reply);
    console.log("✅ 回复成功，用户输入:", userInput);
    return res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("❌ 回复失败:", error);
    return res.status(200).json({ status: "error" });
  }
});

async function sendFeishuReply(messageId, text) {
  const tokenRes = await axios.post(FEISHU_TOKEN_URL, {
    app_id: FEISHU_CONFIG.appId,
    app_secret: FEISHU_CONFIG.appSecret,
  });
  const accessToken = tokenRes.data.tenant_access_token;
  if (!accessToken) throw new Error("获取 access_token 失败");

  const replyBody = {
    msg_type: "text",
    content: JSON.stringify({ text }),
  };
  const replyRes = await axios.post(
    `${FEISHU_REPLY_URL}/${messageId}/reply`,
    replyBody,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    },
  );
  return replyRes.data;
}

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 小书包服务运行在 http://0.0.0.0:${PORT}`);
});

