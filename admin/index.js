async function deleteConversation(conversationId) {
  const secret = document.querySelector("#admin-secret")?.value?.trim();
  if (!secret) { alert("Enter ADMIN_SECRET"); return; }

  const res = await fetch("/api/admin/delete-conversation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": secret
    },
    body: JSON.stringify({ conversationId })
  });

  const text = await res.text().catch(()=>"");
  if (!res.ok) {
    console.error("Delete failed:", res.status, text);
    alert("Delete failed: " + (text || res.status));
    return false;
  }
  console.log("Deleted:", text);
  return true;
}
