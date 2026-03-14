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
app.post("/feishu/webhook", async (req, res) => {
  const { header, event } = req.body;
  console.log(header, event);
  return res.status(200).send("ok");

  // 飞书 URL 验证（首次配置必须）
  if (header.event_type === "url_verification") {
    return res.json({ challenge: req.body.challenge });
  }

  // 只处理消息事件
  if (header.event_type !== "im.message.receive_v1") {
    return res.status(200).send("ok");
  }

  // 提取消息内容
  const { message_id, content, mentions } = event.message;
  const userInput = JSON.parse(content).text;

  // 只在被 @「小书包」时回复
  const isMentioned = mentions?.some((m) => m.name.includes("小书包"));
  if (!isMentioned) return res.status(200).send("ok");

  try {
    // 2. 调用 OpenAI 生成回复
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "你是「小书包」，一个友好的飞书智能助手，回答简洁有趣。",
        },
        { role: "user", content: userInput },
      ],
    });
    const reply = gptResponse.choices[0].message.content.trim();

    // 3. 调用飞书 API 回复消息
    await sendFeishuReply(message_id, reply);
    res.status(200).send("ok");
  } catch (error) {
    console.error("处理失败:", error);
    res.status(500).send("error");
  }
});

// 飞书发送消息工具函数
async function sendFeishuReply(messageId, text) {
  // 1. 获取 tenant_access_token
  const tokenRes = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    { app_id: FEISHU_CONFIG.appId, app_secret: FEISHU_CONFIG.appSecret },
  );
  const accessToken = tokenRes.data.tenant_access_token;

  // 2. 回复消息
  await axios.post(
    "https://open.feishu.cn/open-apis/im/v1/messages",
    {
      receive_id: messageId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
}

// 启动服务
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`小书包机器人服务运行在 http://localhost:${PORT}`);
});
