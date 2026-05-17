#!/usr/bin/env node

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_BASE_URL = "https://api.silo-clouds.cn/v1";
const DEFAULT_MODEL = "Z-ai/glm5";

function printHelp() {
  console.log(`
Usage:
  node scripts/silo-chat.mjs
  node scripts/silo-chat.mjs --once "你好"

Environment:
  SILO_API_KEY     required unless you type it when prompted
  SILO_BASE_URL    default: ${DEFAULT_BASE_URL}
  SILO_MODEL       default: ${DEFAULT_MODEL}

Commands in chat:
  /reset           clear conversation history
  /exit            quit
`);
}

function parseArgs(argv) {
  const options = {
    apiKey: process.env.SILO_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.SILO_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    model: process.env.SILO_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    once: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--api-key") {
      options.apiKey = argv[++i] || "";
    } else if (arg === "--base-url") {
      options.baseUrl = argv[++i] || "";
    } else if (arg === "--model") {
      options.model = argv[++i] || "";
    } else if (arg === "--once" || arg === "-m") {
      options.once = argv[++i] || "";
    } else if (!options.once) {
      options.once = arg;
    }
  }

  return options;
}

function chatCompletionsUrl(baseUrl) {
  const cleanUrl = baseUrl.replace(/\/+$/, "");

  if (cleanUrl.endsWith("/chat/completions")) {
    return cleanUrl;
  }

  if (cleanUrl.endsWith("/v1")) {
    return `${cleanUrl}/chat/completions`;
  }

  return `${cleanUrl}/v1/chat/completions`;
}

function extractReply(data) {
  return (
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    JSON.stringify(data, null, 2)
  );
}

async function promptSecret(label) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    const rl = readline.createInterface({ input, output });
    const value = await rl.question(label);
    rl.close();
    return value.trim();
  }

  return new Promise((resolve) => {
    let value = "";

    output.write(label);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    const finish = () => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      output.write("\n");
      resolve(value.trim());
    };

    const onData = (chunk) => {
      const text = chunk.toString("utf8");

      if (text === "\u0003") {
        output.write("\n");
        process.exit(130);
      }

      if (text === "\r" || text === "\n") {
        finish();
        return;
      }

      if (text === "\b" || text === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      value += text;
    };

    input.on("data", onData);
  });
}

async function sendMessage({ apiKey, baseUrl, model, messages }) {
  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 800,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  try {
    return extractReply(JSON.parse(text)).trim();
  } catch {
    return text.trim();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.apiKey) {
    options.apiKey = await promptSecret("API Key: ");
  }

  if (!options.apiKey) {
    throw new Error("Missing API key. Set SILO_API_KEY or type it when prompted.");
  }

  if (options.once) {
    const reply = await sendMessage({
      ...options,
      messages: [{ role: "user", content: options.once }],
    });
    console.log(reply);
    return;
  }

  const rl = readline.createInterface({ input, output });
  const messages = [];

  console.log(`Connected to ${options.baseUrl}`);
  console.log(`Model: ${options.model}`);
  console.log("Type a message. Use /reset to clear history, /exit to quit.");

  while (true) {
    const userText = (await rl.question("\nYou> ")).trim();

    if (!userText) {
      continue;
    }

    if (userText === "/exit" || userText === "/quit" || userText === "/q") {
      break;
    }

    if (userText === "/reset") {
      messages.length = 0;
      console.log("History cleared.");
      continue;
    }

    messages.push({ role: "user", content: userText });

    try {
      const reply = await sendMessage({ ...options, messages });
      messages.push({ role: "assistant", content: reply });
      console.log(`\nAI> ${reply}`);
    } catch (error) {
      messages.pop();
      console.error(`\nRequest failed: ${error.message}`);
    }
  }

  rl.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
