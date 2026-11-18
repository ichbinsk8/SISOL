
const express = require("express");
const mysql = require("mysql2/promise");
require("dotenv").config();

const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());

if (!process.env.SESSION_SECRET) {
  throw new Error("Falta SESSION_SECRET en .env");
}

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  createDatabaseTable: true
});

app.use(session({
  name: "sisol.sid",
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 8
  }
}));


// Conexión a MySQL
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10
});

// Ruta para comprobar la conexión
app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT COUNT(*) AS total FROM categorias"
    );

    res.json({
      mensaje: "Conexión exitosa con MySQL",
      categorias: rows[0].total
    });
  } catch (error) {
    console.error("Error de conexión:", error.message);

    res.status(500).json({
      error: "No se pudo conectar a MySQL"
    });
  }
});


function requiereSesion(req, res, next) {
  if (!req.session?.usuario) {
    return res.status(401).json({
      error: "Debes iniciar sesión para continuar"
    });
  }

  next();
}

function requiereRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.session?.usuario) {
      return res.status(401).json({
        error: "Debes iniciar sesión"
      });
    }

    if (!rolesPermitidos.includes(req.session.usuario.rol)) {
      return res.status(403).json({
        error: "No tienes permisos para realizar esta acción"
      });
    }

    next();
  };
}


// Obtener solicitudes registradas

app.get("/api/solicitudes", requiereSesion, async (req, res) => {
  try {
    const usuario = req.session.usuario;

    let consulta = `
      SELECT
        s.id_solicitud AS id,
        s.titulo,
        s.descripcion,
        c.nombre AS categoria,
        s.estado,
        s.id_responsable,
        COALESCE(u.nombre, 'Sin asignar') AS responsable
      FROM solicitudes s
      JOIN categorias c
        ON s.id_categoria = c.id_categoria
      LEFT JOIN usuarios u
        ON s.id_responsable = u.id_usuario
    `;

    const parametros = [];

    if (usuario.rol === "solicitante") {
      consulta += " WHERE s.id_solicitante = ?";
      parametros.push(usuario.id);

    } else if (usuario.rol === "responsable") {
      consulta += `
        WHERE s.id_responsable = ?
           OR s.id_solicitante = ?
      `;
      parametros.push(usuario.id, usuario.id);

    } else if (usuario.rol !== "administrador") {
      return res.status(403).json({
        error: "Rol no autorizado"
      });
    }

    consulta += `
      ORDER BY s.fecha_creacion DESC,
               s.id_solicitud DESC
    `;

    const [solicitudes] = await db.execute(
      consulta,
      parametros
    );

    res.json(solicitudes);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "No se pudieron consultar las solicitudes"
    });
  }
});


// Registrar una solicitud
app.post("/api/solicitudes", requiereSesion, async (req, res) => {
  try {
    const { titulo, descripcion, categoria } = req.body;

    if (
      typeof titulo !== "string" ||
      typeof descripcion !== "string" ||
      typeof categoria !== "string" ||
      !titulo.trim() ||
      !descripcion.trim() ||
      !categoria.trim() ||
      titulo.trim().length > 150
    ) {
      return res.status(400).json({
        error: "Los datos de la solicitud no son válidos"
      });
    }

    const [categorias] = await db.execute(
      "SELECT id_categoria FROM categorias WHERE nombre = ?",
      [categoria]
    );

    if (categorias.length === 0) {
      return res.status(400).json({
        error: "La categoría seleccionada no existe"
      });
    }

    const [resultado] = await db.execute(`
      INSERT INTO solicitudes
      (titulo, descripcion, id_categoria, id_solicitante)
      VALUES (?, ?, ?, ?)
    `, [
      titulo.trim(),
      descripcion.trim(),
      categorias[0].id_categoria,
      req.session.usuario.id
    ]);

    res.status(201).json({
      mensaje: "Solicitud registrada correctamente",
      id: resultado.insertId
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "No se pudo registrar la solicitud"
    });
  }
});


 // Consultar usuarios responsables
app.get(
  "/api/responsables",
  requiereRol("administrador"),
  async (req, res) => {
  try {
    const [responsables] = await db.query(`
      SELECT id_usuario, nombre
      FROM usuarios
      WHERE rol = 'responsable' AND activo = 1
      ORDER BY nombre
    `);

    res.json(responsables);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "No se pudieron cargar los responsables"
    });
  }
});

// Asignar responsable a una solicitud

app.patch(
  "/api/solicitudes/:id/responsable",
  requiereRol("administrador"),
  async (req, res) => {
  const idSolicitud = Number(req.params.id);
  const idResponsable = Number(req.body?.id_responsable);

  if (
    !Number.isSafeInteger(idSolicitud) ||
    idSolicitud <= 0 ||
    !Number.isSafeInteger(idResponsable) ||
    idResponsable <= 0
  ) {
    return res.status(400).json({
      error: "Identificadores no válidos"
    });
  }

  let conexion;

  try {
    conexion = await db.getConnection();
    await conexion.beginTransaction();

    const [filas] = await conexion.execute(
      `SELECT id_responsable, estado
       FROM solicitudes
       WHERE id_solicitud = ?
       FOR UPDATE`,
      [idSolicitud]
    );

    if (filas.length === 0) {
      await conexion.rollback();
      return res.status(404).json({
        error: "La solicitud no existe"
      });
    }

    const [responsables] = await conexion.execute(
      `SELECT id_usuario, nombre
       FROM usuarios
       WHERE id_usuario = ?
         AND rol = 'responsable'
         AND activo = 1`,
      [idResponsable]
    );

    if (responsables.length === 0) {
      await conexion.rollback();
      return res.status(400).json({
        error: "Responsable no válido"
      });
    }

    const solicitud = filas[0];

    // Una solicitud resuelta no se modifica desde esta ruta
    if (solicitud.estado === "Resuelta") {
      await conexion.rollback();
      return res.status(409).json({
        error: "La solicitud ya está resuelta"
      });
    }

    const cambioResponsable =
      solicitud.id_responsable !== idResponsable;

    const cambioEstado =
      solicitud.estado === "Pendiente";

    if (!cambioResponsable && !cambioEstado) {
      await conexion.rollback();
      return res.json({
        mensaje: "No hay cambios por guardar"
      });
    }

    const nuevoEstado = cambioEstado
      ? "En proceso"
      : solicitud.estado;

    await conexion.execute(
      `UPDATE solicitudes
       SET id_responsable = ?, estado = ?
       WHERE id_solicitud = ?`,
      [idResponsable, nuevoEstado, idSolicitud]
    );

    // Registrar los cambios en el historial
    await conexion.execute(
      `INSERT INTO historial_solicitudes
       (id_solicitud, id_usuario,
        estado_anterior, estado_nuevo, observacion)
       VALUES (?, ?, ?, ?, ?)`,
      [
        idSolicitud,
        req.session.usuario.id,
        solicitud.estado,
        nuevoEstado,
        `Responsable asignado: ${responsables[0].nombre}`
      ]
    );

    await conexion.commit();

    res.json({
      mensaje: "Solicitud actualizada correctamente",
      estado: nuevoEstado,
      responsable: responsables[0].nombre
    });

  } catch (error) {
    if (conexion) await conexion.rollback();
    console.error(error);

    res.status(500).json({
      error: "No se pudo actualizar la solicitud"
    });

  } finally {
    if (conexion) conexion.release();
  }
});


app.patch(
  "/api/solicitudes/:id/resolver",
  requiereRol("administrador", "responsable"),
  async (req, res) => {
  const idSolicitud = Number(req.params.id);
  const observacion = req.body?.observacion;

  if (!Number.isSafeInteger(idSolicitud) || idSolicitud <= 0) {
    return res.status(400).json({
      error: "Identificador de solicitud no válido"
    });
  }

  if (
    typeof observacion !== "string" ||
    !observacion.trim() ||
    observacion.trim().length > 2000
  ) {
    return res.status(400).json({
      error: "Escribe una observación de máximo 2000 caracteres"
    });
  }

  let conexion;

  try {
    conexion = await db.getConnection();
    await conexion.beginTransaction();

    const [filas] = await conexion.execute(
      `SELECT estado, id_responsable
       FROM solicitudes
       WHERE id_solicitud = ?
       FOR UPDATE`,
      [idSolicitud]
    );

    if (filas.length === 0) {
      await conexion.rollback();
      return res.status(404).json({
        error: "La solicitud no existe"
      });
    }

    const solicitud = filas[0];

    // Verificar que el responsable tenga asignada la solicitud
    if (
      req.session.usuario.rol === "responsable" &&
      solicitud.id_responsable !== req.session.usuario.id
    ) {
      await conexion.rollback();

      return res.status(403).json({
        error: "Esta solicitud no está asignada a tu usuario"
      });
    }

    if (
      solicitud.estado !== "En proceso" ||
      solicitud.id_responsable === null
    ) {
      await conexion.rollback();
      return res.status(409).json({
        error: "Solo se pueden resolver solicitudes en proceso y con responsable"
      });
    }

    await conexion.execute(
      `UPDATE solicitudes
       SET estado = 'Resuelta'
       WHERE id_solicitud = ?`,
      [idSolicitud]
    );

    await conexion.execute(
      `INSERT INTO historial_solicitudes
       (id_solicitud, id_usuario,
        estado_anterior, estado_nuevo, observacion)
       VALUES (?, ?, ?, ?, ?)`,
      [
        idSolicitud,
        req.session.usuario.id,
        "En proceso",
        "Resuelta",
        observacion.trim()
      ]
    );

    await conexion.commit();

    res.json({
      mensaje: "Solicitud marcada como resuelta"
    });

  } catch (error) {
    if (conexion) await conexion.rollback();
    console.error(error);

    res.status(500).json({
      error: "No se pudo resolver la solicitud"
    });

  } finally {
    if (conexion) conexion.release();
  }
});


app.post("/api/login", async (req, res) => {
  const { correo, password } = req.body;

  if (
    typeof correo !== "string" ||
    typeof password !== "string" ||
    !correo.trim() ||
    !password
  ) {
    return res.status(400).json({
      error: "Ingresa tu correo y contraseña"
    });
  }

  try {
    const [usuarios] = await db.execute(
      `SELECT id_usuario, nombre, correo,
              password_hash, rol
       FROM usuarios
       WHERE correo = ? AND activo = 1
       LIMIT 1`,
      [correo.trim()]
    );

    const usuario = usuarios[0];

    if (
      !usuario ||
      !(await bcrypt.compare(password, usuario.password_hash))
    ) {
      return res.status(401).json({
        error: "Correo o contraseña incorrectos"
      });
    }

    req.session.regenerate((error) => {
      if (error) {
        console.error(error);
        return res.status(500).json({
          error: "No se pudo iniciar sesión"
        });
      }

      req.session.usuario = {
        id: usuario.id_usuario,
        nombre: usuario.nombre,
        correo: usuario.correo,
        rol: usuario.rol
      };

      req.session.save((error) => {
        if (error) {
          console.error(error);
          return res.status(500).json({
            error: "No se pudo guardar la sesión"
          });
        }

        res.json({
          mensaje: "Inicio de sesión correcto",
          usuario: req.session.usuario
        });
      });
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Error al iniciar sesión"
    });
  }
});

app.get("/api/sesion", (req, res) => {
  if (!req.session.usuario) {
    return res.status(401).json({
      error: "No hay una sesión activa"
    });
  }

  res.json({
    usuario: req.session.usuario
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        error: "No se pudo cerrar la sesión"
      });
    }

    res.clearCookie("sisol.sid");
    res.json({
      mensaje: "Sesión cerrada correctamente"
    });
  });
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

const archivosPublicos = [
  "styles.css",
  "app.js"
];

// Permitir cargar los archivos del panel
archivosPublicos.forEach((archivo) => {
  app.get(`/${archivo}`, (req, res) => {
    if (!req.session.usuario) {
      return res.status(401).send("No autorizado");
    }

    res.sendFile(path.join(__dirname, archivo));
  });
});

// Mostrar el panel principal solo con sesión
app.get("/", (req, res) => {
  if (!req.session.usuario) {
    return res.redirect("/login");
  }

  res.sendFile(path.join(__dirname, "index.html"));
});


app.get("/login.js", (req, res) => {
  res.sendFile(path.join(__dirname, "login.js"));
});


app.get(
  "/api/solicitudes/:id/historial",
  requiereSesion,
  async (req, res) => {
    try {
      const idSolicitud = Number(req.params.id);
      const usuario = req.session.usuario;

      if (!Number.isInteger(idSolicitud) || idSolicitud <= 0) {
        return res.status(400).json({
          error: "ID de solicitud inválido"
        });
      }

      // Verificar que el usuario tenga acceso a la solicitud
      const [solicitudes] = await db.execute(
        `SELECT id_solicitante, id_responsable
         FROM solicitudes
         WHERE id_solicitud = ?`,
        [idSolicitud]
      );

      if (solicitudes.length === 0) {
        return res.status(404).json({
          error: "Solicitud no encontrada"
        });
      }

      const solicitud = solicitudes[0];

      const tienePermiso =
        usuario.rol === "administrador" ||
        Number(solicitud.id_solicitante) === Number(usuario.id) ||
        (
          usuario.rol === "responsable" &&
          Number(solicitud.id_responsable) === Number(usuario.id)
        );

      if (!tienePermiso) {
        return res.status(403).json({
          error: "No tienes permiso para consultar este historial"
        });
      }

      const [historial] = await db.execute(
        `SELECT
           h.estado_anterior,
           h.estado_nuevo,
           h.observacion,
           h.fecha_cambio,
           u.nombre AS usuario
         FROM historial_solicitudes h
         JOIN usuarios u
           ON h.id_usuario = u.id_usuario
         WHERE h.id_solicitud = ?
         ORDER BY h.fecha_cambio DESC, h.id_historial DESC`,
        [idSolicitud]
      );

      res.json(historial);

    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "No se pudo consultar el historial"
      });
    }
  }
);


app.listen(PORT, () => {
  console.log(`SISOL disponible en http://localhost:${PORT}`);
});
