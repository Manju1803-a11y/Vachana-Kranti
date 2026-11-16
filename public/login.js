const form = document.querySelector("#login-form");
const submitButton = document.querySelector("#login-submit");
const errorMessage = document.querySelector("#login-error");

let isSubmitting = false;

function showLoginError(message) {
  if (!errorMessage) return;
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function clearLoginError() {
  if (!errorMessage) return;
  errorMessage.textContent = "";
  errorMessage.hidden = true;
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
      if (submitButton) submitButton.disabled = true;
    } else {
      clearLoginError();
      if (submitButton) submitButton.disabled = false;
    }
  } catch (error) {
    showLoginError(error.message);
    if (submitButton) submitButton.disabled = true;
  }
}

if (form) {
  // Clear error when user changes inputs
  const inputs = form.querySelectorAll("input");
  inputs.forEach(input => {
    input.addEventListener("input", () => {
      if (!submitButton.disabled || (errorMessage && errorMessage.textContent.includes("Invalid"))) {
        clearLoginError();
      }
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    clearLoginError();
    const email = (form.elements.email?.value || "").trim();
    const password = form.elements.password?.value || "";

    if (!email || !password) {
      showLoginError("Please enter both email and password.");
      return;
    }

    isSubmitting = true;
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="login-spinner" aria-hidden="true"></span> Signing in…';

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          remember: Boolean(form.elements.remember?.checked)
        })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || `Sign-in failed (${response.status}).`);
      }

      window.location.replace("/");
    } catch (error) {
      showLoginError(error.message);
      isSubmitting = false;
      submitButton.disabled = false;
      submitButton.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
    }
  });
}

checkSignInSetup();
