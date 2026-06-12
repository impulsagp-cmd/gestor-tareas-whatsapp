const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = "https://gestor-tareas-whatsapp.onrender.com";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

function limpiarTelefono(telefono) {
    return String(telefono || "").replace(/\D/g, "");
}

function calcularMetricas(tareas) {
    const total = tareas.length;
    const completadas = tareas.filter(t => t.estado === "completada").length;
    const enProceso = tareas.filter(t => t.estado === "en proceso").length;
    const pendientes = tareas.filter(t => t.estado === "pendiente").length;
    const cumplimiento = total === 0 ? 0 : Math.round((completadas / total) * 100);

    return { total, completadas, enProceso, pendientes, cumplimiento };
}

function filtrarPorPeriodo(tareas, periodo) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    return tareas.filter(tarea => {
        if (!tarea.fecha_limite) return periodo === "todo";

        const fecha = new Date(tarea.fecha_limite + "T00:00:00");

        if (periodo === "hoy") {
            return fecha.getTime() === hoy.getTime();
        }

        if (periodo === "semana") {
            const inicioSemana = new Date(hoy);
            const dia = inicioSemana.getDay();
            const diferencia = dia === 0 ? -6 : 1 - dia;
            inicioSemana.setDate(inicioSemana.getDate() + diferencia);

            const finSemana = new Date(inicioSemana);
            finSemana.setDate(finSemana.getDate() + 6);

            return fecha >= inicioSemana && fecha <= finSemana;
        }

        if (periodo === "mes") {
            return fecha.getMonth() === hoy.getMonth() &&
                   fecha.getFullYear() === hoy.getFullYear();
        }

        return true;
    });
}

async function enviarTelegram(chatId, mensaje) {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token || !chatId) {
        return false;
    }

    const respuesta = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: mensaje
            })
        }
    );

    const datos = await respuesta.json();
    return datos.ok === true;
}

async function obtenerUsuariosAsignados(tareaId) {
    const resultado = await pool.query(
        `SELECT usuarios.*
         FROM tarea_usuarios
         INNER JOIN usuarios ON usuarios.id = tarea_usuarios.usuario_id
         WHERE tarea_usuarios.tarea_id = $1`,
        [tareaId]
    );

    return resultado.rows;
}

async function notificarAsignacion(tarea, usuariosAsignados) {
    for (const usuario of usuariosAsignados) {
        const mensaje = `📋 Nueva tarea asignada

Hola ${usuario.nombre}.

Te asignaron una tarea:

📝 ${tarea.titulo}

📖 Contexto:
${tarea.contexto || "Sin descripción"}

⚡ Prioridad:
${tarea.prioridad}

📅 Fecha límite:
${tarea.fecha_limite || "Sin fecha"}

📌 Estado:
${tarea.estado}

👥 Tipo:
${tarea.tipo_asignacion === "equipo" ? "Equipo" : "Individual"}

🔗 Ver tarea:
${APP_URL}/?tarea=${tarea.id}`;

        let enviada = false;

        if (usuario.telegram_chat_id) {
            enviada = await enviarTelegram(usuario.telegram_chat_id, mensaje);
        }

        await pool.query(
            `INSERT INTO notificaciones (usuario_id, telefono, mensaje, estado)
             VALUES ($1, $2, $3, $4)`,
            [
                usuario.id,
                usuario.telegram_chat_id || usuario.telefono || "",
                mensaje,
                enviada ? "enviada" : "pendiente"
            ]
        );
    }
}

/* TELEGRAM */

async function vincularTelegramDesdeMensaje(update) {
    const mensaje = update.message;
    if (!mensaje || !mensaje.chat || !mensaje.text) return;

    const chatId = mensaje.chat.id;
    const texto = mensaje.text.trim();
    const telefono = limpiarTelefono(texto);

    if (!telefono) {
        await enviarTelegram(
            chatId,
            `Hola 👋

Para vincular tu cuenta escribe:

/start TU_NUMERO

Ejemplo:
/start 526621696548`
        );
        return;
    }

    const resultado = await pool.query(
        "SELECT * FROM usuarios WHERE telefono = $1 LIMIT 1",
        [telefono]
    );

    if (resultado.rows.length === 0) {
        await enviarTelegram(
            chatId,
            `No encontré un usuario con el teléfono ${telefono}.

Pide que te registren primero en el gestor.`
        );
        return;
    }

    const usuario = resultado.rows[0];

    await pool.query(
        "UPDATE usuarios SET telegram_chat_id = $1 WHERE id = $2",
        [String(chatId), usuario.id]
    );

    await enviarTelegram(
        chatId,
        `✅ Telegram vinculado correctamente.

Hola ${usuario.nombre}, ya recibirás notificaciones de tus tareas.`
    );
}

app.post("/telegram/webhook", async (req, res) => {
    try {
        await vincularTelegramDesdeMensaje(req.body);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/telegram/configurar-webhook", async (req, res) => {
    try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const webhookUrl = `${APP_URL}/telegram/webhook`;

        const respuesta = await fetch(
            `https://api.telegram.org/bot${token}/setWebhook`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: webhookUrl })
            }
        );

        const datos = await respuesta.json();
        res.json(datos);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/telegram/chatid", async (req, res) => {
    try {
        const token = process.env.TELEGRAM_BOT_TOKEN;

        const respuesta = await fetch(
            `https://api.telegram.org/bot${token}/getUpdates`
        );

        const datos = await respuesta.json();
        res.json(datos);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* USUARIOS */

app.get("/usuarios", async (req, res) => {
    try {
        const resultado = await pool.query(
            "SELECT * FROM usuarios ORDER BY nombre ASC"
        );

        res.json(resultado.rows);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/usuarios", async (req, res) => {
    try {
        const { nombre, telefono, telegramChatId, rol } = req.body;

        const resultado = await pool.query(
            `INSERT INTO usuarios (nombre, telefono, telegram_chat_id, rol)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [
                nombre,
                limpiarTelefono(telefono),
                telegramChatId || "",
                rol || "usuario"
            ]
        );

        res.json(resultado.rows[0]);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/usuarios/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, telefono, telegramChatId, rol } = req.body;

        const resultado = await pool.query(
            `UPDATE usuarios
             SET nombre = $1,
                 telefono = $2,
                 telegram_chat_id = $3,
                 rol = $4
             WHERE id = $5
             RETURNING *`,
            [
                nombre,
                limpiarTelefono(telefono),
                telegramChatId || "",
                rol || "usuario",
                id
            ]
        );

        res.json(resultado.rows[0]);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* TAREAS */

async function consultarTareas(whereSql = "", params = []) {
    const resultado = await pool.query(`
        SELECT 
            tareas.*,
            usuarios.nombre AS usuario_nombre,
            COALESCE(
                json_agg(DISTINCT tarea_usuarios.usuario_id) 
                FILTER (WHERE tarea_usuarios.usuario_id IS NOT NULL),
                '[]'
            ) AS usuarios_asignados_ids,
            COALESCE(
                string_agg(DISTINCT usuarios_asignados.nombre, ', ')
                FILTER (WHERE usuarios_asignados.nombre IS NOT NULL),
                ''
            ) AS usuarios_asignados_nombres
        FROM tareas
        LEFT JOIN usuarios ON tareas.usuario_id = usuarios.id
        LEFT JOIN tarea_usuarios ON tarea_usuarios.tarea_id = tareas.id
        LEFT JOIN usuarios AS usuarios_asignados ON usuarios_asignados.id = tarea_usuarios.usuario_id
        ${whereSql}
        GROUP BY tareas.id, usuarios.nombre
        ORDER BY tareas.id DESC
    `, params);

    return resultado.rows;
}

app.get("/tareas", async (req, res) => {
    try {
        const tareas = await consultarTareas();
        res.json(tareas);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/tareas/usuario/:usuarioId", async (req, res) => {
    try {
        const { usuarioId } = req.params;

        const tareas = await consultarTareas(`
            WHERE tareas.usuario_id = $1
            OR EXISTS (
                SELECT 1
                FROM tarea_usuarios
                WHERE tarea_usuarios.tarea_id = tareas.id
                AND tarea_usuarios.usuario_id = $1
            )
        `, [usuarioId]);

        res.json(tareas);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/tareas", async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const {
            titulo,
            contexto,
            prioridad,
            fechaLimite,
            usuarioId,
            usuarioIds,
            tipoAsignacion
        } = req.body;

        const tipo = tipoAsignacion || "individual";
        let usuariosAsignados = Array.isArray(usuarioIds)
            ? usuarioIds.filter(Boolean)
            : [];

        if (usuarioId && usuariosAsignados.length === 0) {
            usuariosAsignados = [usuarioId];
        }

        const grupoId = crypto.randomUUID();
        const tareasCreadas = [];

        if (tipo === "individual") {
            for (const uid of usuariosAsignados) {
                const resultado = await client.query(
                    `INSERT INTO tareas 
                    (titulo, contexto, prioridad, estado, fecha_limite, usuario_id, tipo_asignacion, grupo_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING *`,
                    [
                        titulo,
                        contexto || "",
                        prioridad || "media",
                        "pendiente",
                        fechaLimite || "",
                        uid || null,
                        "individual",
                        grupoId
                    ]
                );

                const tarea = resultado.rows[0];

                if (uid) {
                    await client.query(
                        `INSERT INTO tarea_usuarios (tarea_id, usuario_id)
                         VALUES ($1, $2)
                         ON CONFLICT DO NOTHING`,
                        [tarea.id, uid]
                    );
                }

                tareasCreadas.push(tarea);
            }
        } else {
            const primerUsuario = usuariosAsignados[0] || null;

            const resultado = await client.query(
                `INSERT INTO tareas 
                (titulo, contexto, prioridad, estado, fecha_limite, usuario_id, tipo_asignacion, grupo_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *`,
                [
                    titulo,
                    contexto || "",
                    prioridad || "media",
                    "pendiente",
                    fechaLimite || "",
                    primerUsuario,
                    "equipo",
                    grupoId
                ]
            );

            const tarea = resultado.rows[0];

            for (const uid of usuariosAsignados) {
                await client.query(
                    `INSERT INTO tarea_usuarios (tarea_id, usuario_id)
                     VALUES ($1, $2)
                     ON CONFLICT DO NOTHING`,
                    [tarea.id, uid]
                );
            }

            tareasCreadas.push(tarea);
        }

        await client.query("COMMIT");

        for (const tarea of tareasCreadas) {
            const usuarios = await obtenerUsuariosAsignados(tarea.id);
            await notificarAsignacion(tarea, usuarios);
        }

        res.json({
            mensaje: "Tareas creadas",
            tareas: tareasCreadas
        });

    } catch (error) {
        await client.query("ROLLBACK");
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

app.put("/tareas/:id", async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { id } = req.params;
        const {
            titulo,
            contexto,
            prioridad,
            estado,
            fechaLimite,
            usuarioId,
            usuarioIds,
            tipoAsignacion
        } = req.body;

        const anteriorAsignados = await client.query(
            "SELECT usuario_id FROM tarea_usuarios WHERE tarea_id = $1",
            [id]
        );

        const anteriores = anteriorAsignados.rows.map(r => String(r.usuario_id));

        let usuariosAsignados = Array.isArray(usuarioIds)
            ? usuarioIds.filter(Boolean).map(String)
            : [];

        if (usuarioId && usuariosAsignados.length === 0) {
            usuariosAsignados = [String(usuarioId)];
        }

        const primerUsuario = usuariosAsignados[0] || usuarioId || null;

        const resultado = await client.query(
            `UPDATE tareas
            SET titulo = $1,
                contexto = $2,
                prioridad = $3,
                estado = $4,
                fecha_limite = $5,
                usuario_id = $6,
                tipo_asignacion = $7
            WHERE id = $8
            RETURNING *`,
            [
                titulo,
                contexto || "",
                prioridad,
                estado,
                fechaLimite || "",
                primerUsuario,
                tipoAsignacion || "individual",
                id
            ]
        );

        await client.query(
            "DELETE FROM tarea_usuarios WHERE tarea_id = $1",
            [id]
        );

        for (const uid of usuariosAsignados) {
            await client.query(
                `INSERT INTO tarea_usuarios (tarea_id, usuario_id)
                 VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [id, uid]
            );
        }

        await client.query("COMMIT");

        const tarea = resultado.rows[0];

        const nuevosUsuarios = usuariosAsignados.filter(uid => !anteriores.includes(String(uid)));

        if (nuevosUsuarios.length > 0) {
            const usuarios = await pool.query(
                `SELECT * FROM usuarios WHERE id = ANY($1::bigint[])`,
                [nuevosUsuarios]
            );

            await notificarAsignacion(tarea, usuarios.rows);
        }

        res.json(tarea);

    } catch (error) {
        await client.query("ROLLBACK");
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

app.delete("/tareas/:id", async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query(
            "DELETE FROM tareas WHERE id = $1",
            [id]
        );

        res.json({ mensaje: "Tarea eliminada" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* DASHBOARD */

app.get("/mi-dashboard/:usuarioId", async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const periodo = req.query.periodo || "hoy";

        const tareas = await consultarTareas(`
            WHERE tareas.usuario_id = $1
            OR EXISTS (
                SELECT 1
                FROM tarea_usuarios
                WHERE tarea_usuarios.tarea_id = tareas.id
                AND tarea_usuarios.usuario_id = $1
            )
        `, [usuarioId]);

        const tareasPeriodo = filtrarPorPeriodo(tareas, periodo);
        const metricas = calcularMetricas(tareasPeriodo);
        const pendientes = tareasPeriodo.filter(t => t.estado === "pendiente");

        res.json({
            periodo,
            metricas,
            pendientes
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/dashboard", async (req, res) => {
    try {
        const periodo = req.query.periodo || "hoy";

        const tareas = await consultarTareas();
        const tareasFiltradas = filtrarPorPeriodo(tareas, periodo);
        const general = calcularMetricas(tareasFiltradas);

        const agrupado = {};

        tareasFiltradas.forEach(tarea => {
            const nombres = tarea.usuarios_asignados_nombres
                ? tarea.usuarios_asignados_nombres.split(", ")
                : [tarea.usuario_nombre || "Sin asignar"];

            nombres.forEach(nombre => {
                if (!agrupado[nombre]) agrupado[nombre] = [];
                agrupado[nombre].push(tarea);
            });
        });

        const usuarios = Object.keys(agrupado).map(nombre => ({
            usuario: nombre,
            ...calcularMetricas(agrupado[nombre])
        }));

        res.json({
            periodo,
            general,
            usuarios
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* RECORDATORIOS */

app.get("/recordatorios/manana", async (req, res) => {
    try {
        const usuarios = await pool.query(
            "SELECT * FROM usuarios WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> ''"
        );

        const hoy = new Date().toISOString().slice(0, 10);
        let enviados = 0;

        for (const usuario of usuarios.rows) {
            const tareas = await consultarTareas(`
                WHERE (
                    tareas.usuario_id = $1
                    OR EXISTS (
                        SELECT 1
                        FROM tarea_usuarios
                        WHERE tarea_usuarios.tarea_id = tareas.id
                        AND tarea_usuarios.usuario_id = $1
                    )
                )
                AND tareas.fecha_limite = $2
                AND tareas.estado <> 'completada'
            `, [usuario.id, hoy]);

            if (tareas.length === 0) continue;

            let mensaje = `☀️ Buenos días ${usuario.nombre}

Estas son tus tareas para hoy:

`;

            tareas.forEach((t, i) => {
                mensaje += `${i + 1}. ${t.titulo} (${t.prioridad})\n`;
                if (t.contexto) mensaje += `   ${t.contexto}\n`;
            });

            await enviarTelegram(usuario.telegram_chat_id, mensaje);
            enviados++;
        }

        res.json({ enviados });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/recordatorios/retrasos", async (req, res) => {
    try {
        const usuarios = await pool.query(
            "SELECT * FROM usuarios WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> ''"
        );

        const hoy = new Date().toISOString().slice(0, 10);
        let enviados = 0;

        for (const usuario of usuarios.rows) {
            const tareas = await consultarTareas(`
                WHERE (
                    tareas.usuario_id = $1
                    OR EXISTS (
                        SELECT 1
                        FROM tarea_usuarios
                        WHERE tarea_usuarios.tarea_id = tareas.id
                        AND tarea_usuarios.usuario_id = $1
                    )
                )
                AND tareas.fecha_limite < $2
                AND tareas.estado <> 'completada'
            `, [usuario.id, hoy]);

            if (tareas.length === 0) continue;

            let mensaje = `⚠️ ${usuario.nombre}, tienes tareas atrasadas:

`;

            tareas.forEach((t, i) => {
                mensaje += `${i + 1}. ${t.titulo} - venció: ${t.fecha_limite}\n`;
                if (t.contexto) mensaje += `   ${t.contexto}\n`;
            });

            await enviarTelegram(usuario.telegram_chat_id, mensaje);
            enviados++;
        }

        res.json({ enviados });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* NOTIFICACIONES */

app.get("/notificaciones/pendientes", async (req, res) => {
    try {
        const resultado = await pool.query(
            "SELECT * FROM notificaciones WHERE estado = 'pendiente' ORDER BY id ASC"
        );

        res.json(resultado.rows);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/notificaciones/:id/enviada", async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query(
            "UPDATE notificaciones SET estado = 'enviada' WHERE id = $1",
            [id]
        );

        res.json({ mensaje: "Notificación marcada como enviada" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* RESPALDOS */

app.get("/respaldo/json", async (req, res) => {
    try {
        const usuarios = await pool.query("SELECT * FROM usuarios ORDER BY id ASC");
        const tareas = await consultarTareas();
        const notificaciones = await pool.query(
            "SELECT * FROM notificaciones ORDER BY id ASC"
        );

        const respaldo = {
            generado_en: new Date().toISOString(),
            usuarios: usuarios.rows,
            tareas,
            notificaciones: notificaciones.rows
        };

        const fecha = new Date().toISOString().slice(0, 10);

        res.setHeader("Content-Type", "application/json");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="respaldo_gestor_${fecha}.json"`
        );

        res.send(JSON.stringify(respaldo, null, 2));

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/respaldo/csv", async (req, res) => {
    try {
        const tareas = await consultarTareas();

        let csv = "id,titulo,contexto,tipo_asignacion,prioridad,estado,fecha_limite,usuarios\n";

        tareas.forEach(t => {
            csv += `"${t.id}","${t.titulo}","${t.contexto || ""}","${t.tipo_asignacion || "individual"}","${t.prioridad}","${t.estado}","${t.fecha_limite || ""}","${t.usuarios_asignados_nombres || t.usuario_nombre || "Sin asignar"}"\n`;
        });

        const fecha = new Date().toISOString().slice(0, 10);

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="tareas_${fecha}.csv"`
        );

        res.send(csv);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});