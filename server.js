const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// USUARIOS
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
        const { nombre } = req.body;

        const resultado = await pool.query(
            "INSERT INTO usuarios (nombre) VALUES ($1) RETURNING *",
            [nombre]
        );

        res.json(resultado.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// TAREAS
app.get("/tareas", async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT 
                tareas.*,
                usuarios.nombre AS usuario_nombre
            FROM tareas
            LEFT JOIN usuarios ON tareas.usuario_id = usuarios.id
            ORDER BY tareas.id DESC
        `);

        res.json(resultado.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/tareas", async (req, res) => {
    try {
        const { titulo, prioridad, fechaLimite, usuarioId } = req.body;

        const resultado = await pool.query(
            `INSERT INTO tareas 
            (titulo, prioridad, estado, fecha_limite, usuario_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [
                titulo,
                prioridad || "media",
                "pendiente",
                fechaLimite || "",
                usuarioId || null
            ]
        );

        res.json(resultado.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/tareas/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo, prioridad, estado, fechaLimite, usuarioId } = req.body;

        const resultado = await pool.query(
            `UPDATE tareas
            SET titulo = $1,
                prioridad = $2,
                estado = $3,
                fecha_limite = $4,
                usuario_id = $5
            WHERE id = $6
            RETURNING *`,
            [
                titulo,
                prioridad,
                estado,
                fechaLimite || "",
                usuarioId || null,
                id
            ]
        );

        res.json(resultado.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
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

app.get("/cumplimiento", async (req, res) => {
    try {
        const resultado = await pool.query("SELECT * FROM tareas");
        const tareas = resultado.rows;

        const total = tareas.length;
        const completadas = tareas.filter(t => t.estado === "completada").length;
        const enProceso = tareas.filter(t => t.estado === "en proceso").length;
        const pendientes = tareas.filter(t => t.estado === "pendiente").length;

        const cumplimiento =
            total === 0 ? 0 : Math.round((completadas / total) * 100);

        res.json({
            total,
            completadas,
            enProceso,
            pendientes,
            cumplimiento
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});