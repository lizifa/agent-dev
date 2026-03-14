require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// 配置项：替换成你的信息
const CONFIG = {
  FEISHU_APP_ID: process.env.FEISHU_APP_ID,
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
  BOT_NAME: "小书包", // 你的机器人名称
  TARGET_USER_NAME: "张三", // 你要筛选的指定用户名称（或用户ID）
  // 也可以用用户ID（更精准，避免重名）：TARGET_USER_ID: 'ou_xxxxxx'
};

// 飞书事件接收接口
app.post("/feishu/webhook", async (req, res) => {
  const { header, event, challenge } = req.body;

  // 1. 处理飞书URL验证
  if (header?.event_type === "url_verification") {
    return res.json({ challenge });
  }

  // 2. 只处理消息接收事件
  if (header?.event_type !== "im.message.receive_v1") {
    return res.send("ok");
  }

  try {
    // 3. 解析消息核心数据
    const { message, sender } = event;
    const content = JSON.parse(message.content); // 消息内容JSON
    const rawText = content.text; // 原始消息文本（含@符号）
    const mentions = message.mentions || []; // @列表
    const senderName = sender.sender_id.union_id
      ? sender.sender_id.union_id // 用户唯一ID（推荐）
      : sender.sender_name; // 用户名（易重名）

    // 4. 核心判断：是否是指定用户@了你的机器人
    // 4.1 判断是否@了机器人
    const isAtBot = mentions.some(
      (mention) => mention.name === CONFIG.BOT_NAME,
    );
    // 4.2 判断是否是指定用户发送的
    const isTargetUser = senderName === CONFIG.TARGET_USER_NAME;
    // 若用用户ID判断：isTargetUser = sender.sender_id.user_id === CONFIG.TARGET_USER_ID;

    // 5. 仅处理「指定用户@机器人」的消息
    if (isAtBot && isTargetUser) {
      // 提取纯文本（去掉@机器人的部分，只保留用户真正说的话）
      const pureText = rawText.replace(/@[^ ]+/g, "").trim();
      console.log(`【指定用户@我】${CONFIG.TARGET_USER_NAME}说：${pureText}`);

      // 可选：回复该用户
      await replyToMessage(message.message_id, `收到啦！你说的是：${pureText}`);
    }

    res.send("ok");
  } catch (error) {
    console.error("处理消息失败：", error);
    res.status(200).send("ok"); // 飞书要求必须返回200，否则会重试
  }
});

// 回复消息的工具函数
async function replyToMessage(messageId, replyContent) {
  // 获取飞书token
  const tokenRes = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      app_id: CONFIG.FEISHU_APP_ID,
      app_secret: CONFIG.FEISHU_APP_SECRET,
    },
  );
  const accessToken = tokenRes.data.tenant_access_token;

  // 发送回复
  await axios.post(
    "https://open.feishu.cn/open-apis/im/v1/messages",
    {
      receive_id: messageId,
      msg_type: "text",
      content: JSON.stringify({ text: replyContent }),
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );
}

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务运行在端口 ${PORT}`);
});
