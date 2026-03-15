import http from "http";
import * as lark from "@larksuiteoapi/node-sdk";

const eventDispatcher = new lark.EventDispatcher({
  encryptKey: process.env.FEISHU_ENCRYPT_KEY,
}).register({
  "card.action.trigger": async (data) => {
    console.log(data);
    return {
      toast: {
        type: "success",
        content: "卡片交互成功",
        i18n: {
          zh_cn: "卡片交互成功",
          en_us: "card action success",
        },
      },
    };
  },
});

const server = http.createServer();
server.on(
  "request",
  lark.adaptDefault("/webhook/event", eventDispatcher, {
    autoChallenge: true,
  }),
);
server.listen(3000);
