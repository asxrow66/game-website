const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("prompt");
const newChatBtn = document.getElementById("new-chat-btn");

let messages = [];

/* ---------- Utility ---------- */

// Add message to DOM
function addMessage(role, content) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.innerHTML = role === "assistant" ? marked.parse(content) : content;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;

  // Highlight code blocks (after markdown)
  chat.querySelectorAll("pre code").forEach(block => hljs.highlightElement(block));
  return msg;
}

// Reset chat
function clearChat() {
  chat.innerHTML = "";
  messages = [];
}

/* ---------- Chat logic ---------- */

async function sendMessage(text) {
  addMessage("user", text);
  messages.push({ role: "user", content: text });

  let res;
  try {
    res = await fetch("/api/gpt-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch (networkError) {
    console.error("Network error while contacting API:", networkError);
    addMessage("assistant", "There is an issue connecting to ChatGPT, please try again later.");
    return;
  }

  if (!res.ok || !res.body) {
    console.error("API error response:", res.status, res.statusText);
    addMessage("assistant", "There is an issue connecting to ChatGPT, please try again later.");
    return;
  }

  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let reply = "";
    const aiMsg = addMessage("assistant", "");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      reply += decoder.decode(value);
      aiMsg.innerHTML = marked.parse(reply);
      chat.scrollTop = chat.scrollHeight;
    }

    messages.push({ role: "assistant", content: reply });
    chat.querySelectorAll("pre code").forEach(block => hljs.highlightElement(block));

  } catch (err) {
    console.error("Streaming error:", err);
    addMessage("assistant", "There is an issue connecting to ChatGPT, please try again later.");
  }
}

/* ---------- Input Events ---------- */

// Handle Enter / Shift+Enter
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (!e.shiftKey) {
      e.preventDefault(); // prevent newline
      const text = input.value.trim();
      if (text) {
        input.value = "";
        sendMessage(text);
      }
    }
  }
});

// Fallback form submit handler
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendMessage(text);
});

// New chat button
newChatBtn.addEventListener("click", () => {
  clearChat();
  addMessage("assistant", "🆕 New chat started.");
});
