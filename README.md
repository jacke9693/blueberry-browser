# Blueberry Browser

> **⚠️ Disclaimer:** I'm not proud of this codebase! It was built in 3 hours. If you have some time left over in the challenge, feel free to refactor and clean things up!

> **🔧 MCP Integration Added:** This browser now supports Model Context Protocol (MCP) to extend the AI assistant with custom tools! See [MCP_GUIDE.md](./MCP_GUIDE.md) for details.

https://github.com/user-attachments/assets/bbf939e2-d87c-4c77-ab7d-828259f6d28d

---

## Overview

You are the **CTO of Blueberry Browser**, a Strawberry competitor. Your mission is to add a feature to Blueberry that makes it superior & more promising than Strawberry.

But your time is limited—Strawberry is about to raise a two billion dollar Series A round from X-Separator, B17Å and Sequoiadendron giganteum Capital.

## 🎯 Task

Your job is to **clone this repo** and add a unique feature. Some ideas are listed below.

It doesn't need to work 100% reliably, or even be completely done. It just has to:

- Show that you are creative and can iterate on novel ideas fast
- Demonstrate good system thinking and code practices
- Prove you are a capable full stack and/or LLM dev

Once you're done, we'll book a call where you'll get to present your work!

If it's cracked, we might just have to acquire Blueberry Browser to stay alive 👀👀👀

### ⏰ Time

**1-2 weeks** is ideal for this challenge. This allows you to work over weekends and during evenings in your own time.

### 📋 Rules

You are allowed to vibe code, but make sure you understand everything so we can ask technical questions.

## 💡 Feature Ideas

### **Browsing History Compiler**

Track the things that the user is doing inside the browser and figure out from a series of browser states what the user is doing, and perhaps how valuable, repetitive tasks can be re-run by an AI agent.

_Tab state series → Prompt for web agent how to reproduce the work_

### **Coding Agent**

Sidebar coding agent that can create a script that can run on the open tabs.

Maybe useful for filling forms or changing the page's style so it can extract data but present it in a nicer format.

### **Tab Completion Model**

Predict next action or what to type, like Cursor's tab completion model.

### **Your Own Idea**

Feel free to implement your own idea!

> Wanted to try transformers.js for a while? This is your chance!

> Have an old cool web agent framework you built? Let's see if you can merge it into the browser!

> Think you can add a completely new innovation to the browser concept with some insane, over-engineered React? Lfg!

Make sure you can realistically showcase a simple version of it in the timeframe. You can double check with us first if uncertain! :)

## 💬 Tips

Feel free to write to us with questions or send updates during the process—it's a good way to get a feel for working together.

It can also be a good way for us to give feedback if things are heading in the right or wrong direction.

---

## 🚀 Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

**Add an OpenAI API key to `.env`** in the root folder.

Strawberry will reimburse LLM costs, so go crazy! _(Please not more than a few hundred dollars though!)_

### MCP Tool Integration (Optional)

The browser now supports **Model Context Protocol (MCP)** to extend the AI assistant with custom tools!

To enable MCP tools:

1. Create a `.mcp-config.json` file in your home directory
2. Configure MCP servers (filesystem, web search, GitHub, etc.)
3. The AI assistant will automatically use these tools

**Quick Example:**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/your/directory"
      ]
    }
  }
}
```

See the [MCP_GUIDE.md](./MCP_GUIDE.md) for complete documentation and examples.

---
