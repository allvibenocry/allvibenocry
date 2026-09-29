// The setup and sign-in pages (D64): the form goes to the panel as JSON, from
// this page, and on success the panel's home opens. The words of a refusal
// are the engine's own.
const form = document.querySelector("form[data-action]");
const error = document.getElementById("error");

function say(message) {
  error.textContent = message;
  error.hidden = !message;
  if (message) error.focus?.();
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.id === "setup-form") {
    if (!data.setupCode?.trim()) return say("Type the setup code the machine showed.");
    if ((data.password ?? "").length < 12) return say("The password needs 12 characters or more.");
    if (data.password !== data.again) return say("The two passwords are not the same.");
    delete data.again;
  } else if (!data.password) {
    return say("Type your password.");
  }
  say("");
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await fetch(form.dataset.action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(data),
    });
    const answer = await response.json();
    if (answer.ok) {
      location.assign("/");
      return;
    }
    const message = answer.error?.message ?? "That did not work.";
    say(message.charAt(0).toUpperCase() + message.slice(1));
  } catch {
    say("The panel did not answer. Is the machine on?");
  } finally {
    button.disabled = false;
  }
});
error?.setAttribute("tabindex", "-1");
