// Frontend for ChatGPT-like UI with: sidebar, web toggle, citations,
// Enter=send / Shift+Enter=newline, and refreshes sidebar after replies.

const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("prompt");
const newChatBtn = document.getElementById("new-chat-btn");
const useWebToggle = document.getElementById("use-web");
const sendBtn = document.getElementById("send-btn");
const convList = document.getElementById("conv-list");

let messages = [];
let currentConversationId = null;

/* ---------- API base (same-origin in dev/prod; absolute when file://) ---------- */
const PROD_API = "/api";
const ABS_API_FOR_FILE = "https://www.gatewaychurchtx.com/api";
const API_BASE =
  (location.hostname && location.hostname.endsWith("gatewaychurchtx.com"))
    ? PROD_API
    : (location.hostname && location.hostname !== "localhost" && location.hostname !== "127.0.0.1")
      ? ABS_API_FOR_FILE
      : PROD_API;

/* ---------- anon id per browser ---------- */
function getAnonId() {
  const k = "anon_id";
  let id = localStorage.getItem(k);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(k, id); }
  return id;
}
const anonId = getAnonId();

/* ---------- UI helpers ---------- */
function addMessage(role, content) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.innerHTML = role === "assistant" ? marked.parse(content) : content;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
  chat.querySelectorAll("pre code").forEach((b)=>hljs.highlightElement(b));
  return msg;
}
function addSourcesBar(afterEl, sources) {
  if (!sources || !sources.length) return;
  const bar = document.createElement("div");
  bar.className = "sources";
  sources.forEach((s)=>{
    const a = document.createElement("a");
    a.className = "source-pill";
    a.href = s.url; a.target="_blank"; a.rel="noopener noreferrer";
    const favicon = `https://icons.duckduckgo.com/ip3/${(s.site||"").replace(/^https?:\/\//,"")}.ico`;
    a.innerHTML = `<img class="favicon" src="${favicon}" alt="">
                   <span class="source-site">${s.site||"source"}</span>
                   <span class="source-title">· ${s.title||""}</span>`;
    bar.appendChild(a);
  });
  afterEl.insertAdjacentElement("afterend", bar);
  chat.scrollTop = chat.scrollHeight;
}
function clearChat() { chat.innerHTML=""; messages=[]; }

/* ---------- Sidebar (user conversations) ---------- */
function renderConversations(items) {
  convList.innerHTML = "";
  items.forEach((c)=>{
    const li = document.createElement("li");
    li.textContent = c.title || "Untitled chat";
    if (c.id === currentConversationId) li.classList.add("active");
    li.onclick = ()=>{ currentConversationId = c.id; [...convList.children].forEach(n=>n.classList.remove("active")); li.classList.add("active"); loadConversation(c.id); };
    convList.appendChild(li);
  });
}
async function listConversations() {
  const r = await fetch(`${API_BASE}/conversations`, { headers: { "x-anon-id": anonId } });
  if (!r.ok) return [];
  const j = await r.json();
  return j.conversations || [];
}
async function createConversation(title="New chat") {
  const r = await fetch(`${API_BASE}/conversations`, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ title, anonId })
  });
  if (!r.ok) throw new Error("Failed to create conversation");
  return r.json();
}
async function loadConversation(convId) {
  clearChat();
  const r = await fetch(`${API_BASE}/messages?conversationId=${encodeURIComponent(convId)}`, {
    headers:{ "x-anon-id": anonId }
  });
  if (!r.ok) { addMessage("assistant","⚠️ Unable to load conversation."); return; }
  const { messages: msgs } = await r.json();
  msgs.forEach(m=> addMessage(m.role, m.content));
  messages = msgs.map(m=> ({ role:m.role, content:m.content }));
}

/* ---------- Chat send ---------- */
async function sendMessage(text) {
  addMessage("user", text);
  messages.push({ role:"user", content:text });

  sendBtn.disabled = true; input.disabled = true;

  const useWeb = !!useWebToggle.checked;

  let res;
  try {
    res = await fetch(`${API_BASE}/gpt-chat`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "X-Anon-Id": anonId },
      body: JSON.stringify({
        messages,
        useWeb,
        anonId,
        conversationId: currentConversationId || null
      })
    });
  } catch (e) {
    console.error("Network error:", e);
    addMessage("assistant","There is an issue connecting to ChatGPT, please try again later.");
    sendBtn.disabled=false; input.disabled=false; input.focus(); useWebToggle.checked=false;
    return;
  }

  if (!res.ok || !res.body) {
    console.error("API error:", res.status, res.statusText);
    addMessage("assistant","There is an issue connecting to ChatGPT, please try again later.");
    sendBtn.disabled=false; input.disabled=false; input.focus(); useWebToggle.checked=false;
    return;
  }

  // Persist conversation id (created server-side on first send)
  const cid = res.headers.get("X-Conversation-Id");
  if (cid) currentConversationId = cid;

  // Sources (when web was used)
  const webUsed = res.headers.get("X-Web-Used") === "1";
  let webSources = [];
  if (webUsed) {
    const b64 = res.headers.get("X-Web-Sources");
    if (b64) { try { webSources = JSON.parse(atob(b64)); } catch (e) { console.warn("Bad sources header", e); } }
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
    messages.push({ role:"assistant", content:reply });
    if (webUsed) addSourcesBar(aiMsg, webSources);

    // Title generation happens on the server after first reply.
    // Refresh sidebar now so the new title appears like ChatGPT.
    await refreshSidebar();
  } catch (err) {
    console.error("Streaming error:", err);
    addMessage("assistant","There is an issue connecting to ChatGPT, please try again later.");
  } finally {
    sendBtn.disabled=false; input.disabled=false; input.focus(); useWebToggle.checked=false;
  }
}

/* ---------- Events ---------- */
input.addEventListener("keydown", (e)=>{
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendMessage(text);
  }
});
form.addEventListener("submit",(e)=>{
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendMessage(text);
});
newChatBtn.addEventListener("click", async ()=>{
  try {
    const conv = await createConversation("New chat");
    currentConversationId = conv.id;
    clearChat();
    addMessage("assistant","🆕 New chat started.");
    await refreshSidebar();
    input.focus();
  } catch (e) { console.error(e); }
});

/* ---------- Init ---------- */
async function refreshSidebar(){ renderConversations(await listConversations()); }
(async function init(){ await refreshSidebar(); })();
