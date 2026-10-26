const form = document.querySelector("#login-form");
const submitButton = document.querySelector("#login-submit");
const errorMessage = document.querySelector("#login-error");

function showLoginError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

async function checkSignInSetup() {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) throw new Error("The sign-in service could not be reached.");
    const result = await response.json();
    if (result.authenticated) {
      window.location.replace("/");
      return;
    }
    if (!result.configured) {
      showLoginError("Admin sign-in is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD in the server environment, then restart the server.");
      submitButton.disabled = true;
    }
  } catch (error) {
    showLoginError(error.message);
    submitButton.disabled = true;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  submitButton.disabled = true;
  submitButton.innerHTML = '<span class="login-spinner" aria-hidden="true"></span> Signing in…';

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.elements.email.value,
        password: form.elements.password.value,
        remember: form.elements.remember.checked
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Sign-in failed (${response.status}).`);
    window.location.replace("/");
  } catch (error) {
    showLoginError(error.message);
    submitButton.disabled = false;
    submitButton.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
  }
});

checkSignInSetup();
