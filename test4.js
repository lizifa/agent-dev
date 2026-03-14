import * as lark from "@larksuiteoapi/node-sdk";

// 1. 初始化飞书客户端（用于调用发消息 API）
const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  domain: "https://open.feishu.cn",
});

// 2. 机器人配置
const BOT_NAME = "小书包"; // 和飞书机器人名称一致

// 3. 事件分发器（处理 @ 消息）
const eventDispatcher = new lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data) => {
    try {
      const { message } = data;
      const {
        message_id,
        chat_id,
        content,
        mentions,
        chat_type,
        message_type,
        sender,
      } = message;

      // 打印日志，方便排查
      console.log(`\n[收到消息]
发送人：${sender?.sender_name || "未知"}
聊天类型：${chat_type === "p2p" ? "单聊" : "群聊"}
是否@我：${mentions?.some((m) => m.name === BOT_NAME)}
内容：${content}
`);

      // 只处理文本消息
      if (message_type !== "text") {
        console.log("→ 非文本消息，忽略");
        return;
      }

      // 解析用户输入（剔除 @小书包 标记）
      let userInput = "";
      try {
        const contentObj = JSON.parse(content);
        userInput = contentObj.text || "";
        userInput = userInput
          .replace(new RegExp(`@${BOT_NAME}`, "g"), "")
          .trim();
      } catch (e) {
        console.error("→ 解析消息失败", e);
        return;
      }

      // 判断是否需要回复
      const isP2p = chat_type === "p2p";
      const isMentioned = mentions?.some((m) => m.name === BOT_NAME);
      if (!isP2p && !isMentioned) {
        console.log("→ 群聊未@我，忽略");
        return;
      }

      // 回复消息
      const replyText = `👋 你@我并说：「${userInput || "空内容"}」\n我是小书包，随时为你服务～`;
      if (isP2p) {
        // 单聊：直接发消息
        await client.im.v1.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chat_id,
            content: JSON.stringify({ text: replyText }),
            msg_type: "text",
          },
        });
      } else {
        // 群聊：回复原消息
        await client.im.v1.message.reply({
          path: { message_id },
          data: {
            content: JSON.stringify({ text: replyText }),
            msg_type: "text",
          },
        });
      }

      console.log("✅ 回复成功！");
    } catch (error) {
      console.error("❌ 处理消息失败", error);
    }
  },
});

// 4. 启动长连接（核心！和飞书「长连接订阅」对应）
const wsClient = new lark.WSClient({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  domain: "https://open.feishu.cn",
});

wsClient.start({
  eventDispatcher,
  onStart: () => {
    console.log("\n🚀 飞书长连接已启动！等待事件推送...");
    console.log("✅ 现在在飞书群里 @小书包 发消息，就能收到并回复了！");
  },
  onError: (err) => {
    console.error("\n❌ 长连接错误：", err);
  },
});
