const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("prompt");
const newChatBtn = document.getElementById("new-chat-btn");
const useWebToggle = document.getElementById("use-web");
const sendBtn = document.getElementById("send-btn");

let messages = [];

/* ---------- DOM helpers ---------- */
function addMessage(role, content) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.innerHTML = role === "assistant" ? marked.parse(content) : content;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;

  // Syntax highlight
  chat.querySelectorAll("pre code").forEach(block => hljs.highlightElement(block));
  return msg;
}

function clearChat() {
  chat.innerHTML = "";
  messages = [];
}

/* ---------- Chat logic ---------- */
async function sendMessage(text) {
  addMessage("user", text);
  messages.push({ role: "user", content: text });

  // Disable send during request
  sendBtn.disabled = true;
  input.disabled = true;

  const useWeb = !!useWebToggle.checked;

  let res;
  try {
    res = await fetch("/api/gpt-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, useWeb }), // <-- send toggle to server
    });
  } catch (networkError) {
    console.error("Network error while contacting API:", networkError);
    addMessage("assistant", "There is an issue connecting to ChatGPT, please try again later.");
    sendBtn.disabled = false; input.disabled = false; input.focus();
    return;
  }

  if (!res.ok || !res.body) {
    console.error("API error response:", res.status, res.statusText);
    addMessage("assistant", "There is an issue connecting to ChatGPT, please try again later.");
    sendBtn.disabled = false; input.disabled = false; input.focus();
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
  } finally {
    sendBtn.disabled = false; input.disabled = false; input.focus();
  }
}

/* ---------- Events ---------- */
// Enter = send; Shift+Enter = newline
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (!e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text) {
        input.value = "";
        sendMessage(text);
      }
    }
  }
});

// Fallback submit
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendMessage(text);
});

// New Chat clears current conversation (no persistence)
newChatBtn.addEventListener("click", () => {
  clearChat();
  addMessage("assistant", "🆕 New chat started.");
  input.focus();
});
