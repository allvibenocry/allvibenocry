// Signed in: the session's token, for every request that changes something.
let token = null;
async function session() {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  if (response.status === 401) location.assign("/sign-in");
  token = (await response.json()).result?.token ?? null;
}
document.getElementById("sign-out")?.addEventListener("click", async () => {
  if (!token) await session();
  await fetch("/api/sign-out", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Allvibe-Token": token }, body: "{}" });
  location.assign("/sign-in");
});
session();
