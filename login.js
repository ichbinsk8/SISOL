
const formLogin = document.getElementById("formLogin");
const mensajeError = document.getElementById("mensajeError");

formLogin.addEventListener("submit", async (event) => {
  event.preventDefault();

  const correo = document.getElementById("correo").value.trim();
  const password = document.getElementById("password").value;
  const boton = formLogin.querySelector("button[type='submit']");

  boton.disabled = true;
  mensajeError.classList.add("d-none");

  try {
    const respuesta = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ correo, password })
    });

    const resultado = await respuesta.json();

    if (!respuesta.ok) {
      throw new Error(
        resultado.error || "No se pudo iniciar sesión"
      );
    }

    window.location.href = "/";

  } catch (error) {
    mensajeError.textContent = error.message;
    mensajeError.classList.remove("d-none");
  } finally {
    boton.disabled = false;
  }
});
