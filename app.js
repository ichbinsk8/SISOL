
const form = document.getElementById("formSolicitud");
const tabla = document.getElementById("tablaSolicitudes");

let solicitudes = [];

async function cargarSolicitudes() {
  try {
    const respuesta = await fetch("/api/solicitudes");

    if (!respuesta.ok) {
      throw new Error("Error al consultar solicitudes");
    }

    solicitudes = await respuesta.json();
    actualizarInterfaz();
  } catch (error) {
    console.error(error);
    alert("No se pudieron cargar las solicitudes");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const boton = form.querySelector("button[type='submit']");
  boton.disabled = true;

  const solicitud = {
    titulo: document.getElementById("titulo").value.trim(),
    categoria: document.getElementById("categoria").value,
    descripcion: document.getElementById("descripcion").value.trim()
  };

  try {
    const respuesta = await fetch("/api/solicitudes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(solicitud)
    });

    const resultado = await respuesta.json();

    if (!respuesta.ok) {
      throw new Error(resultado.error);
    }

    alert("Solicitud registrada correctamente");
    form.reset();
    await cargarSolicitudes();

  } catch (error) {
    alert(error.message);
  } finally {
    boton.disabled = false;
  }
});


function actualizarInterfaz() {
  tabla.replaceChildren();

  solicitudes.forEach((solicitud) => {
    const fila = document.createElement("tr");

    // ID, título y categoría
    const datos = [
      `#${String(solicitud.id).padStart(3, "0")}`,
      solicitud.titulo,
      solicitud.categoria
    ];

    datos.forEach((dato) => {
      const celda = document.createElement("td");
      celda.textContent = dato;
      fila.appendChild(celda);
    });

    // Estado con colores
    const celdaEstado = document.createElement("td");
    const etiqueta = document.createElement("span");

    etiqueta.classList.add(
      "badge", "rounded-pill", "px-3", "py-2"
    );

    if (solicitud.estado === "Pendiente") {
      etiqueta.classList.add("bg-warning", "text-dark");
    } else if (solicitud.estado === "En proceso") {
      etiqueta.classList.add("bg-info", "text-dark");
    } else if (solicitud.estado === "Resuelta") {
      etiqueta.classList.add("bg-success", "text-white");
    } else {
      etiqueta.classList.add("bg-secondary");
    }

    etiqueta.textContent = solicitud.estado;
    celdaEstado.appendChild(etiqueta);
    fila.appendChild(celdaEstado);

    // Responsable asignado
    const celdaResponsable = document.createElement("td");
    celdaResponsable.textContent =
      solicitud.responsable || "Sin asignar";

    fila.appendChild(celdaResponsable);


    // Botón Gestionar según el rol del usuario
    const celdaAcciones = document.createElement("td");

    const puedeGestionar =
          usuarioActual?.rol === "administrador" ||
      (
        usuarioActual?.rol === "responsable" &&
        Number(solicitud.id_responsable) === Number(usuarioActual.id) &&
        solicitud.estado === "En proceso"
      );

    if (puedeGestionar) {
      const botonGestionar = document.createElement("button");

      botonGestionar.type = "button";
      botonGestionar.className = "btn btn-outline-primary btn-sm";
      botonGestionar.textContent = "Gestionar";

      botonGestionar.addEventListener("click", () => {
        abrirGestion(solicitud.id);
      });

      celdaAcciones.appendChild(botonGestionar);
    }


    // Botón Historial
    const botonHistorial = document.createElement("button");

    botonHistorial.type = "button";
    botonHistorial.className = "btn btn-outline-secondary btn-sm ms-2";
    botonHistorial.textContent = "Historial";

    botonHistorial.addEventListener("click", () => {
      abrirHistorial(solicitud.id);
    });

    celdaAcciones.appendChild(botonHistorial);


    fila.appendChild(celdaAcciones);


    // Agregar fila completa a la tabla
    tabla.appendChild(fila);
  });

  // Actualizar estadísticas
  document.getElementById("total").textContent =
    solicitudes.length;

  document.getElementById("pendientes").textContent =
    solicitudes.filter(
      s => s.estado === "Pendiente"
    ).length;

  document.getElementById("resueltas").textContent =
    solicitudes.filter(
      s => s.estado === "Resuelta"
    ).length;
}

async function abrirHistorial(idSolicitud) {
  const contenido = document.getElementById("contenidoHistorial");
  const modalElemento = document.getElementById("modalHistorial");

  const modal = bootstrap.Modal.getOrCreateInstance(modalElemento);

  contenido.textContent = "Cargando historial...";
  modal.show();

  try {
    const respuesta = await fetch(
      `/api/solicitudes/${idSolicitud}/historial`
    );

    if (!respuesta.ok) {
      throw new Error("No se pudo cargar el historial");
    }

    const historial = await respuesta.json();

    contenido.replaceChildren();

    if (historial.length === 0) {
      contenido.textContent =
        "Esta solicitud todavía no tiene movimientos registrados.";
      return;
    }

    historial.forEach((registro) => {
      const tarjeta = document.createElement("div");
      tarjeta.className = "border rounded p-3 mb-3";

      const estado = document.createElement("h6");
      estado.className = "fw-bold";
      estado.textContent =
        `${registro.estado_anterior || "Inicio"} → ${registro.estado_nuevo || "Sin cambio"}`;

      const usuario = document.createElement("p");
      usuario.className = "mb-1";
      usuario.textContent = `Realizado por: ${registro.usuario}`;

      const fecha = document.createElement("p");
      fecha.className = "text-muted small mb-2";
      fecha.textContent =
        `Fecha: ${new Date(registro.fecha_cambio).toLocaleString("es-CO")}`;

      const observacion = document.createElement("p");
      observacion.className = "mb-0";
      observacion.textContent =
        `Observación: ${registro.observacion || "Sin observaciones"}`;

      tarjeta.append(estado, usuario, fecha, observacion);
      contenido.appendChild(tarjeta);
    });

  } catch (error) {
    contenido.textContent = error.message;
  }
}


cargarSolicitudes();

let idSolicitudGestion = null;
let responsablesDisponibles = [];

const modalElemento = document.getElementById("modalGestion");
const modalGestion = new bootstrap.Modal(modalElemento);

async function cargarResponsables() {
  const respuesta = await fetch("/api/responsables");

  if (!respuesta.ok) {
    throw new Error("No se pudieron cargar los responsables");
  }

  responsablesDisponibles = await respuesta.json();
}

async function abrirGestion(idSolicitud) {
    // Mostrar la asignación únicamente al administrador
  const esAdministrador = usuarioActual?.rol === "administrador";

  const contenedorAsignacion =
    document.getElementById("contenedorAsignacion");

  const selectResponsable =
    document.getElementById("selectResponsable");

  contenedorAsignacion.style.display =
    esAdministrador ? "" : "none";

  selectResponsable.required = esAdministrador;

 const btnGuardarAsignacion =
  document.getElementById("btnGuardarAsignacion");

    if (btnGuardarAsignacion) {
      btnGuardarAsignacion.style.display =
        esAdministrador ? "" : "none";
    }

  

  const solicitud = solicitudes.find(s => s.id === idSolicitud);

  if (!solicitud) return;

  idSolicitudGestion = idSolicitud;
  document.getElementById("estadoGestion").textContent =
  solicitud.estado;

  document.getElementById("nombreSolicitud").textContent =
    `Solicitud #${idSolicitud}: ${solicitud.titulo}`;
  
  document.getElementById("descripcionSolicitud").textContent =
  solicitud.descripcion || "Esta solicitud no tiene descripción.";

  const select = document.getElementById("selectResponsable");
  const mensaje = document.getElementById("mensajeGestion");

    const btnResolver = document.getElementById("btnResolverSolicitud");

    btnResolver.classList.toggle(
      "d-none",
      solicitud.estado !== "En proceso"
    );

    document.getElementById("observacionGestion").value = "";


  select.replaceChildren();
  mensaje.textContent = "";

  const opcionInicial = document.createElement("option");
  opcionInicial.value = "";
  opcionInicial.textContent = "Seleccionar responsable...";
  select.appendChild(opcionInicial);

  try {
    if (usuarioActual?.rol === "administrador") {
      await cargarResponsables();
    }

    responsablesDisponibles.forEach((responsable) => {
      const opcion = document.createElement("option");
      opcion.value = responsable.id_usuario;
      opcion.textContent = responsable.nombre;
      select.appendChild(opcion);
    });

    select.value = solicitud.id_responsable ?? "";
    modalGestion.show();

  } catch (error) {
    alert(error.message);
  }
}

document.getElementById("formGestion")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const boton = document.getElementById("btnGuardarGestion");
    const mensaje = document.getElementById("mensajeGestion");
    const idResponsable =
      Number(document.getElementById("selectResponsable").value);

    if (!idResponsable || !idSolicitudGestion) {
      mensaje.textContent = "Selecciona un responsable";
      return;
    }

    boton.disabled = true;

    try {
      const respuesta = await fetch(
        `/api/solicitudes/${idSolicitudGestion}/responsable`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            id_responsable: idResponsable
          })
        }
      );

      const resultado = await respuesta.json();

      if (!respuesta.ok) {
        throw new Error(resultado.error);
      }

      modalGestion.hide();
      await cargarSolicitudes();

    } catch (error) {
      mensaje.textContent = error.message;
    } finally {
      boton.disabled = false;
    }
  });


document.getElementById("btnResolverSolicitud")
  .addEventListener("click", async () => {

    const observacion = document
      .getElementById("observacionGestion")
      .value.trim();

    if (!observacion) {
      alert("Escribe una observación antes de resolver la solicitud");
      return;
    }

    if (!idSolicitudGestion) return;

    const confirmar = confirm(
      "¿Deseas marcar esta solicitud como resuelta?"
    );

    if (!confirmar) return;

    const boton = document.getElementById("btnResolverSolicitud");
    boton.disabled = true;

    try {
      const respuesta = await fetch(
        `/api/solicitudes/${idSolicitudGestion}/resolver`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ observacion })
        }
      );

      const resultado = await respuesta.json();

      if (!respuesta.ok) {
        throw new Error(
          resultado.error || "No se pudo resolver la solicitud"
        );
      }

      await cargarSolicitudes();
      modalGestion.hide();

      alert("Solicitud resuelta correctamente");

    } catch (error) {
      alert(error.message);
    } finally {
      boton.disabled = false;
    }
  });

document.getElementById("btnCerrarSesion")
  .addEventListener("click", async () => {

    try {
      const respuesta = await fetch("/api/logout", {
        method: "POST"
      });

      if (!respuesta.ok) {
        throw new Error("No se pudo cerrar la sesión");
      }

      window.location.replace("/login");

    } catch (error) {
      alert(error.message);
    }
  });


let usuarioActual = null;

async function cargarUsuarioActual() {
  const respuesta = await fetch("/api/sesion");

  if (!respuesta.ok) {
    window.location.replace("/login");
    throw new Error("No hay una sesión activa");
  }

  const resultado = await respuesta.json();

  usuarioActual = resultado.usuario;

  document.getElementById("nombreUsuario").textContent =
    usuarioActual.nombre;

  document.getElementById("rolUsuario").textContent =
    usuarioActual.rol;
}

async function iniciarSISOL() {
  try {
    await cargarUsuarioActual();
    await cargarSolicitudes();
  } catch (error) {
    console.error("Error al iniciar SISOL:", error);
  }
}

iniciarSISOL();



